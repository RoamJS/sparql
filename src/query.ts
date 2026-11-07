import { EndpointMode, Query, Result } from "~/types";

export const WIKIDATA_SOURCE =
  "https://query.wikidata.org/bigdata/namespace/wdq/sparql?format=json&query=";
export const codeFromBlock = (text: string): string => {
  const code = text
    .trim()
    .replace(/^```(?:sparql|javascript)\s*\n?/i, "")
    .replace(/\n?```$/, "")
    .replace(/^`|`$/g, "")
    .trim();
  return /^(?:SELECT|PREFIX|BASE)\b/i.test(code) ||
    text.trim().startsWith("```sparql")
    ? code
    : "";
};

export const assertSelect = (query: string): void => {
  const withoutComments = query
    .replace(/<[^>]*>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*/g, (token) =>
      token.startsWith("#") ? "" : token,
    )
    .trim();
  const body = withoutComments.replace(
    /^(?:(?:PREFIX\s+[\w-]*:\s*<[^>]+>|BASE\s*<[^>]+>)\s*)*/i,
    "",
  );
  if (!/^SELECT\b/i.test(body))
    throw new Error(
      "Only SELECT queries can be imported. ASK, CONSTRUCT, DESCRIBE and SPARQL Update are unsupported.",
    );
  if (
    /\b(?:INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD)\s+(?:DATA|WHERE|GRAPH|SILENT|DEFAULT|NAMED|ALL|<)/i.test(
      body.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^>]*>/g, ""),
    )
  )
    throw new Error("SPARQL Update cannot be sent by this importer.");
};

export const endpointUrl = ({
  source,
  query,
  endpointMode,
}: Pick<Query, "source" | "query" | "endpointMode">): string => {
  assertSelect(query);
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error("Enter a full HTTP(S) endpoint URL.");
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password)
    throw new Error("Use an HTTP(S) endpoint without embedded credentials.");
  if (endpointMode === "prefix") return `${source}${encodeURIComponent(query)}`;
  parsed.searchParams.set("query", query);
  parsed.searchParams.set("format", "json");
  return parsed.href;
};

export const normalizeResult = (payload: unknown): Result => {
  let value = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error(
        "Endpoint returned malformed JSON. Check the endpoint and its result format.",
      );
    }
  }
  if (value && typeof value === "object" && "data" in value)
    return normalizeResult((value as { data: unknown }).data);
  if (!value || typeof value !== "object")
    throw new Error("Endpoint did not return a SPARQL JSON result.");
  const result = value as Partial<Result> & { boolean?: boolean };
  if ("boolean" in result)
    throw new Error("ASK boolean results cannot be imported; use SELECT.");
  if (
    !Array.isArray(result.head?.vars) ||
    result.head.vars.some((v) => typeof v !== "string") ||
    !Array.isArray(result.results?.bindings)
  )
    throw new Error("Expected SPARQL SELECT head.vars and results.bindings.");
  for (const row of result.results.bindings) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("Invalid SPARQL result row.");
    for (const cell of Object.values(row))
      if (
        !cell ||
        typeof cell.value !== "string" ||
        !["uri", "literal", "typed-literal", "bnode"].includes(cell.type)
      )
        throw new Error("Invalid SPARQL result binding.");
  }
  return result as Result;
};

export const fetchResult = async ({
  query,
  signal,
  fetcher = fetch,
  timeout = 30000,
}: {
  query: Query;
  signal: AbortSignal;
  fetcher?: typeof fetch;
  timeout?: number;
}): Promise<Result> => {
  const url = endpointUrl(query);
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: "application/sparql-results+json, application/json" },
      credentials: "omit",
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Endpoint rate limit (429). Wait and retry; existing results are retained."
          : `Endpoint HTTP ${response.status}. Check the query and endpoint.`,
      );
    const text = await response.text();
    if (controller.signal.aborted)
      throw new DOMException("Aborted", "AbortError");
    return normalizeResult(text);
  } catch (error) {
    if (timedOut)
      throw new Error(
        "Endpoint timed out. Reduce the row limit or retry; existing results are retained.",
      );
    if (signal.aborted)
      throw new Error("Request cancelled. No graph writes started.");
    if (error instanceof TypeError)
      throw new Error(
        "Could not reach endpoint. Check connectivity, HTTPS and browser CORS access; no proxy is configured.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
};

export const entityQuery = ({
  id,
  limit,
  qualifiers,
  properties = [],
}: {
  id: string;
  limit: number;
  qualifiers: boolean;
  properties?: string[];
}): string => {
  if (!/^[QP]\d+$/.test(id))
    throw new Error("Choose a Wikidata Q item or P property identifier.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error("Row limit must be an integer from 1 to 10000.");
  if (properties.some((p) => !/^P\d+$/.test(p)))
    throw new Error(
      "Selected properties must be P identifiers, for example P31, P569.",
    );
  return `SELECT ?property ?propertyLabel ?value ?valueLabel ${qualifiers ? "?qualifierProperty ?qualifierPropertyLabel ?qualifierValue ?qualifierValueLabel " : ""}{
  VALUES (?id) {(wd:${id})}
  ${properties.length ? `VALUES ?property { ${properties.map((p) => `wd:${p}`).join(" ")} }` : ""}
  ?id ?p ?statement .
  ?statement ?ps ?value .
  ?property wikibase:claim ?p .
  ?property wikibase:statementProperty ?ps .
  ${qualifiers ? "OPTIONAL { ?statement ?pq ?qualifierValue . ?qualifierProperty wikibase:qualifier ?pq . }" : ""}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
ORDER BY ?property ?statement ?value
LIMIT ${limit}`;
};

export type Entity = { id: string; label: string; description?: string };
export const searchEntities = async ({
  text,
  type,
  signal,
}: {
  text: string;
  type: "item" | "property";
  signal: AbortSignal;
}): Promise<Entity[]> => {
  if (/^[QP]\d+$/i.test(text.trim()))
    return [
      {
        id: text.trim().toUpperCase(),
        label: text.trim().toUpperCase(),
        description: "Direct Wikidata identifier",
      },
    ];
  const url = new URL("https://www.wikidata.org/w/api.php");
  Object.entries({
    origin: "*",
    action: "wbsearchentities",
    format: "json",
    limit: "8",
    language: "en",
    uselang: "en",
    search: text,
    type,
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`Entity search HTTP ${response.status}`);
  const payload = (await response.json()) as { search?: Entity[] };
  if (!Array.isArray(payload.search))
    throw new Error("Entity search returned an invalid response.");
  return payload.search;
};
