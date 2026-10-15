import { Graph, ImportMeta, Journal, Node, Owned, Plan } from "~/types";

export const revision = (graph: Graph, uid: string): string =>
  JSON.stringify(graph.read(uid));

export const applyPlan = async ({
  graph,
  rootUid,
  plan,
  meta,
  signal,
  expectedRevision,
  onProgress,
}: {
  graph: Graph;
  rootUid: string;
  plan: Plan;
  meta?: ImportMeta;
  signal: AbortSignal;
  expectedRevision: string;
  onProgress?: (count: number) => void;
}): Promise<Journal> => {
  const journal: Journal = {
    changes: [],
    status: "complete",
    retained: [],
    owned: [],
  };
  const previous = new Map(
    (meta?.owned || []).map((owned) => [owned.key, owned]),
  );
  const seen = new Set<string>();
  const check = (): void => {
    if (signal.aborted)
      throw new Error(
        "Stopped. Completed graph writes remain; review the operation journal.",
      );
  };
  try {
    check();
    if (!graph.read(rootUid))
      throw new Error("Import destination was deleted.");
    if (revision(graph, rootUid) !== expectedRevision)
      throw new Error(
        "Destination changed since preview. Preview again before importing.",
      );
    const write = async (nodes: Node[], parentUid: string): Promise<void> => {
      let precedingUid: string | undefined;
      for (const [index, node] of nodes.entries()) {
        check();
        const old = previous.get(node.key);
        const current = old && graph.read(old.uid);
        seen.add(node.key);
        if (
          old &&
          (!current ||
            current.text !== old.text ||
            graph.parent(old.uid) !== parentUid)
        ) {
          journal.retained.push(old.uid);
          journal.owned.push(old);
          continue;
        }
        const uid = old?.uid || graph.uid();
        if (current && current.text !== node.text) {
          await graph.update({ uid, text: node.text });
          journal.changes.push({
            kind: "update",
            uid,
            parentUid,
            before: current.text,
            after: node.text,
          });
        } else if (!current) {
          const siblings = graph.read(parentUid)?.children || [];
          const following = nodes
            .slice(index + 1)
            .map((next) => previous.get(next.key))
            .find((next) => {
              const candidate = next && graph.read(next.uid);
              return (
                next &&
                candidate?.text === next.text &&
                graph.parent(next.uid) === parentUid
              );
            });
          const followingIndex = following
            ? siblings.findIndex((sibling) => sibling.uid === following.uid)
            : -1;
          const precedingIndex = siblings.findIndex(
            (sibling) => sibling.uid === precedingUid,
          );
          const order = node.key.startsWith("header:")
            ? 0
            : followingIndex >= 0
              ? followingIndex
              : precedingIndex >= 0
                ? precedingIndex + 1
                : siblings.length;
          await graph.create({ uid, parentUid, text: node.text, order });
          journal.changes.push({
            kind: "create",
            uid,
            parentUid,
            after: node.text,
          });
        }
        precedingUid = uid;
        journal.owned.push({ uid, parentUid, key: node.key, text: node.text });
        onProgress?.(journal.changes.length);
        await write(node.children, uid);
      }
    };
    await write(plan.nodes, rootUid);
    (meta?.owned || [])
      .filter((owned) => !seen.has(owned.key))
      .forEach((owned) => {
        journal.retained.push(owned.uid);
        journal.owned.push(owned);
      });
  } catch (error) {
    journal.status = journal.changes.length ? "partial" : "failed";
    journal.error = error instanceof Error ? error.message : String(error);
  }
  return journal;
};

export const recover = async ({
  graph,
  journal,
}: {
  graph: Graph;
  journal: Journal;
}): Promise<{ recovered: string[]; retained: string[] }> => {
  const result: { recovered: string[]; retained: string[] } = {
    recovered: [],
    retained: [],
  };
  for (const change of journal.changes.slice().reverse()) {
    const current = graph.read(change.uid);
    if (!current) continue;
    if (
      current.text !== change.after ||
      graph.parent(change.uid) !== change.parentUid
    ) {
      result.retained.push(change.uid);
      continue;
    }
    if (change.kind === "update") {
      await graph.update({ uid: change.uid, text: change.before || "" });
      result.recovered.push(change.uid);
    } else if (!current.children.length && !graph.referenced(change.uid)) {
      await graph.remove(change.uid);
      result.recovered.push(change.uid);
    } else result.retained.push(change.uid);
  }
  return result;
};

export const writeIdentities = async ({
  graph,
  identities,
  signal,
}: {
  graph: Graph;
  identities: Plan["identities"];
  signal: AbortSignal;
}): Promise<void> => {
  for (const identity of identities) {
    if (signal.aborted)
      throw new Error("Stopped before identity links finished.");
    const pageUid = await graph.ensurePage(identity.title);
    if (signal.aborted)
      throw new Error("Stopped before identity links finished.");
    if (
      !graph
        .read(pageUid)
        ?.children.some((node) => node.text === `same as:: ${identity.uri}`)
    )
      await graph.create({
        uid: graph.uid(),
        parentUid: pageUid,
        text: `same as:: ${identity.uri}`,
      });
  }
};
