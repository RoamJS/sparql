import { codeFromBlock, WIKIDATA_SOURCE } from "~/query";
import { Graph, ImportMeta, OutputFormat, Query, Saved, Tree } from "~/types";

export const CONFIG = "roam/js/sparql";
export const WORKSPACE = `${CONFIG}/workspace`;
const keyMatches = (text: string, key: string): boolean =>
  text
    .replace(/\s*#\.[\w\d-]*\s*$/, "")
    .replace(/\[\[|\]\]/g, "")
    .replace(/::$/, "")
    .trim()
    .toLowerCase() === key.toLowerCase();
export const child = (tree: Tree | undefined, key: string): Tree | undefined =>
  tree?.children.find((node) => keyMatches(node.text, key));
const value = (tree: Tree | undefined, key: string): string | undefined =>
  child(tree, key)?.children[0]?.text;
export const readDefaults = (
  graph: Graph,
): { label: string; limit: number; qualifiers: boolean; customUid: string } => {
  const config = graph.page(CONFIG);
  const settings = child(config, "import");
  const limit = Number(value(settings, "default limit"));
  return {
    label: value(settings, "default label") || "SPARQL Import",
    limit: Number.isInteger(limit) && limit > 0 ? limit : 10,
    qualifiers: !!child(settings, "qualifiers"),
    customUid: child(config, "customQuery")?.children[0]?.uid || "",
  };
};

export const readMeta = (
  graph: Graph,
  rootUid: string,
): ImportMeta | undefined => {
  const node = child(graph.page(CONFIG), "standalone/v1")?.children.find(
    (record) => record.text.startsWith(`${rootUid} `),
  );
  if (!node) return undefined;
  try {
    const meta = JSON.parse(node.text.slice(rootUid.length + 1)) as ImportMeta;
    return meta.version === 1 &&
      meta.rootUid === rootUid &&
      Array.isArray(meta.owned)
      ? meta
      : undefined;
  } catch {
    return undefined;
  }
};

export const readSaved = (graph: Graph): Saved[] =>
  (child(graph.page(CONFIG), "queries")?.children || []).map((record) => {
    const [query, source, format] = record.children;
    const meta = readMeta(graph, record.text);
    const outputFormat = format?.text as OutputFormat;
    return {
      recordUid: record.uid,
      rootUid: record.text,
      name:
        meta?.name ||
        graph.read(record.text)?.text ||
        `Missing output (${record.text})`,
      query: query?.text || "",
      source: source?.text || "",
      outputFormat,
      endpointMode: meta?.endpointMode || "prefix",
      sourceUid: meta?.sourceUid,
      compatibility: meta?.compatibility ?? true,
      error:
        !query?.text ||
        !source?.text ||
        !["Parent", "Line", "Table"].includes(outputFormat)
          ? "Malformed legacy saved record; edit its first three children (query, endpoint, format)."
          : !graph.read(record.text)
            ? "Saved import destination was deleted."
            : undefined,
    };
  });

export const ensureChild = async ({
  graph,
  parentUid,
  text,
}: {
  graph: Graph;
  parentUid: string;
  text: string;
}): Promise<string> => {
  const existing = child(graph.read(parentUid), text);
  if (existing) return existing.uid;
  const uid = graph.uid();
  await graph.create({ uid, parentUid, text });
  return uid;
};
export const ensureCustom = async (graph: Graph): Promise<string> => {
  const configUid = await graph.ensurePage(CONFIG);
  const parentUid = await ensureChild({
    graph,
    parentUid: configUid,
    text: "customQuery",
  });
  const first = graph.read(parentUid)?.children[0];
  if (first) return first.uid;
  const uid = graph.uid();
  await graph.create({
    uid,
    parentUid,
    text: '```sparql\nSELECT ?item ?itemLabel WHERE { VALUES ?item { wd:Q7259 } SERVICE wikibase:label { bd:serviceParam wikibase:language "en" } }\n```',
  });
  return uid;
};
export const copyQuerySource = async ({
  graph,
  query,
  name,
}: {
  graph: Graph;
  query: Query;
  name: string;
}): Promise<string> => {
  const configUid = await graph.ensurePage(CONFIG);
  const sourcesUid = await ensureChild({
    graph,
    parentUid: configUid,
    text: "standalone/sources",
  });
  const parentUid = graph.uid();
  await graph.create({ uid: parentUid, parentUid: sourcesUid, text: name });
  const uid = graph.uid();
  await graph.create({
    uid,
    parentUid,
    text: `\`\`\`sparql\n${query.query}\n\`\`\``,
  });
  for (const text of [
    `sparql endpoint:: ${query.source}`,
    `sparql endpoint mode:: ${query.endpointMode}`,
    `sparql format:: ${query.outputFormat}`,
  ])
    await graph.create({ uid: graph.uid(), parentUid: uid, text });
  return uid;
};
export const saveMeta = async ({
  graph,
  meta,
}: {
  graph: Graph;
  meta: ImportMeta;
}): Promise<void> => {
  const configUid = await graph.ensurePage(CONFIG);
  const parentUid = await ensureChild({
    graph,
    parentUid: configUid,
    text: "standalone/v1",
  });
  const existing = graph
    .read(parentUid)
    ?.children.find((node) => node.text.startsWith(`${meta.rootUid} `));
  const text = `${meta.rootUid} ${JSON.stringify(meta)}`;
  if (existing) await graph.update({ uid: existing.uid, text });
  else await graph.create({ uid: graph.uid(), parentUid, text });
};
export const saveRecord = async ({
  graph,
  rootUid,
  query,
}: {
  graph: Graph;
  rootUid: string;
  query: Query;
}): Promise<void> => {
  const configUid = await graph.ensurePage(CONFIG);
  const parentUid = await ensureChild({
    graph,
    parentUid: configUid,
    text: "queries",
  });
  const existing = graph
    .read(parentUid)
    ?.children.find((record) => record.text === rootUid);
  const recordUid = existing?.uid || graph.uid();
  if (!existing)
    await graph.create({ uid: recordUid, parentUid, text: rootUid });
  const values = [query.query, query.source, query.outputFormat];
  for (let index = 0; index < values.length; index++) {
    const field = existing?.children[index];
    if (field) await graph.update({ uid: field.uid, text: values[index] });
    else
      await graph.create({
        uid: graph.uid(),
        parentUid: recordUid,
        text: values[index],
      });
  }
};

export const resolveSource = ({
  graph,
  uid,
}: {
  graph: Graph;
  uid: string;
}): Tree => {
  const visited = new Set<string>();
  const walk = (current: string, depth: number): Tree | undefined => {
    if (depth > 30 || visited.has(current))
      throw new Error(
        `Query reference cycle or excessive nesting at ((${current})).`,
      );
    visited.add(current);
    const tree = graph.read(current);
    if (!tree)
      throw new Error(
        `Query source ((${current})) was deleted or is unavailable.`,
      );
    if (codeFromBlock(tree.text)) return tree;
    const ref = tree.text.trim().match(/^\(\(([^()]+)\)\)$/);
    if (ref) return walk(ref[1], depth + 1);
    for (const candidate of tree.children) {
      if (
        codeFromBlock(candidate.text) ||
        /^\(\([^()]+\)\)$/.test(candidate.text.trim())
      ) {
        const found = walk(candidate.uid, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  const direct = walk(uid, 0);
  if (direct) return direct;
  const parent = graph.parent(uid);
  const found = parent && walk(parent, 0);
  if (found) return found;
  throw new Error(
    `No SPARQL source found at ((${uid})), its children, reference or parent.`,
  );
};

export const sourceQuery = ({
  graph,
  uid,
}: {
  graph: Graph;
  uid: string;
}): Query => {
  const source = resolveSource({ graph, uid });
  const parent = graph.parent(source.uid);
  const metadata = [
    ...source.children,
    ...(parent ? graph.read(parent)?.children || [] : []),
  ];
  const field = (name: string): string | undefined =>
    metadata
      .find((node) => node.text.toLowerCase().startsWith(`sparql ${name}::`))
      ?.text.slice(`sparql ${name}::`.length)
      .trim();
  const format = field("format") || "Parent";
  const mode = field("endpoint mode") || "prefix";
  if (!["Parent", "Line", "Table"].includes(format))
    throw new Error("sparql format:: must be Parent, Line or Table.");
  if (!["prefix", "standard"].includes(mode))
    throw new Error("sparql endpoint mode:: must be prefix or standard.");
  return {
    query: codeFromBlock(source.text),
    source: field("endpoint") || WIKIDATA_SOURCE,
    endpointMode: mode as Query["endpointMode"],
    outputFormat: format as OutputFormat,
    sourceUid: source.uid,
    compatibility: false,
  };
};
