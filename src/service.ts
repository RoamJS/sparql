import { labelText, planOutput } from "~/format";
import { fetchResult } from "~/query";
import { readMeta, readSaved, saveMeta, saveRecord } from "~/storage";
import {
  Graph,
  ImportMeta,
  Journal,
  Node,
  Owned,
  Plan,
  Query,
  Saved,
  Tree,
} from "~/types";
import { applyPlan, revision, writeIdentities } from "~/writer";

export type Preview = {
  plan: Plan;
  query: Query;
  destination: string;
  destinationRevision: string;
  signature: string;
  rootUid?: string;
  adopted?: ImportMeta;
  legacyCopy: boolean;
  label: string;
  name: string;
  save: boolean;
};
export const adoptLegacy = ({
  graph,
  rootUid,
  plan,
  query,
  label,
  name,
}: {
  graph: Graph;
  rootUid: string;
  plan: Plan;
  query: Query;
  label: string;
  name: string;
}): ImportMeta | undefined => {
  const owned: Owned[] = [];
  const match = (
    actual: Tree[],
    expected: Node[],
    parentUid: string,
  ): boolean =>
    actual.length === expected.length &&
    expected.every((node, index) => {
      const current = actual[index];
      if (
        current.text !== node.text ||
        !match(current.children, node.children, current.uid)
      )
        return false;
      owned.push({
        uid: current.uid,
        parentUid,
        key: node.key,
        text: node.text,
      });
      return true;
    });
  const root = graph.read(rootUid);
  if (!root || !match(root.children, plan.nodes, rootUid)) return undefined;
  return {
    version: 1,
    rootUid,
    owned,
    name,
    label,
    renderedLabel: root.text,
    endpointMode: query.endpointMode,
    compatibility: true,
    ownershipVerified: true,
    sourceUid: query.sourceUid,
  };
};
export class QueryService {
  private active?: AbortController;
  constructor(
    private graph: Graph,
    private dateTitle: (date: Date) => string,
  ) {}
  cancel = (): void => this.active?.abort();
  busy = (): boolean => !!this.active;
  preview = async ({
    query,
    destination,
    saved,
    signature,
    label,
    name,
    save,
  }: {
    query: Query;
    destination: string;
    saved?: Saved;
    signature: string;
    label: string;
    name: string;
    save: boolean;
  }): Promise<Preview> => {
    if (this.active)
      throw new Error(
        "An operation is already running. Wait or stop it first.",
      );
    const controller = new AbortController();
    this.active = controller;
    try {
      if (!this.graph.read(destination))
        throw new Error(
          "Destination does not exist. Choose a page or block UID.",
        );
      if (saved && destination !== saved.rootUid)
        throw new Error(
          "Saved refresh retains its output root. Save a copy to choose another destination.",
        );
      if (
        saved &&
        ["query", "source", "outputFormat", "endpointMode"].some(
          (key) => query[key as keyof Query] !== saved[key as keyof Query],
        )
      )
        throw new Error(
          "The query draft differs from the saved definition. Save definition, save a copy, or reload it before refreshing.",
        );
      const destinationRevision = revision(this.graph, destination);
      const currentSaved =
        saved &&
        readSaved(this.graph).find(
          (record) => record.recordUid === saved.recordUid,
        );
      if (saved && (!currentSaved || currentSaved.error))
        throw new Error(
          currentSaved?.error || "Saved query was deleted. Reload the library.",
        );
      // Refresh resolves the graph record at run time; an edited draft must be saved first.
      const current = currentSaved || query;
      const result = await fetchResult({
        query: current,
        signal: controller.signal,
      });
      if (controller.signal.aborted)
        throw new Error("Request cancelled. No graph writes started.");
      const plan = planOutput({
        result,
        format: current.outputFormat,
        compatibility: current.compatibility,
        dateTitle: this.dateTitle,
      });
      const rootUid = saved?.rootUid;
      const unknownOwnership =
        !!rootUid && !readMeta(this.graph, rootUid)?.ownershipVerified;
      const adopted = unknownOwnership
        ? adoptLegacy({
            graph: this.graph,
            rootUid: rootUid!,
            plan,
            query: current,
            label,
            name,
          })
        : undefined;
      const legacyCopy = unknownOwnership && !adopted;
      if (adopted)
        plan.warnings.push(
          "Legacy output exactly matches this validated result tree. It can be adopted in place; existing output UIDs are preserved.",
        );
      if (legacyCopy)
        plan.warnings.push(
          "This legacy import has no ownership record. Existing descendants and UIDs will be retained; import creates an adjacent copy.",
        );
      return {
        plan,
        query: current,
        destination,
        destinationRevision,
        signature,
        rootUid,
        adopted,
        legacyCopy,
        label,
        name,
        save,
      };
    } finally {
      if (this.active === controller) this.active = undefined;
    }
  };
  import = async ({
    preview,
    currentSignature,
    onProgress,
  }: {
    preview: Preview;
    currentSignature: string;
    onProgress?: (count: number) => void;
  }): Promise<{ rootUid: string; journal: Journal }> => {
    if (this.active)
      throw new Error(
        "An operation is already running. Wait or stop it first.",
      );
    if (preview.signature !== currentSignature)
      throw new Error(
        "Preview is stale. Preview the current query and destination again.",
      );
    if (
      revision(this.graph, preview.destination) !== preview.destinationRevision
    )
      throw new Error("Destination changed since preview. Preview again.");
    const controller = new AbortController();
    this.active = controller;
    const journal: Journal = {
      status: "complete",
      changes: [],
      owned: [],
      retained: [],
    };
    let rootUid = preview.rootUid || "";
    try {
      let meta: ImportMeta | undefined;
      if (rootUid && !preview.legacyCopy)
        meta = preview.adopted || readMeta(this.graph, rootUid);
      if (!rootUid || preview.legacyCopy) {
        const parentUid = preview.legacyCopy
          ? this.graph.parent(rootUid)
          : preview.destination;
        if (!parentUid || !this.graph.read(parentUid))
          throw new Error("Import parent is unavailable.");
        rootUid = this.graph.uid();
        const text = labelText({
          label: preview.label,
          format: preview.query.outputFormat,
        });
        await this.graph.create({ uid: rootUid, parentUid, text });
        journal.changes.push({
          kind: "create",
          uid: rootUid,
          parentUid,
          after: text,
        });
      }
      const written = await applyPlan({
        graph: this.graph,
        rootUid,
        plan: preview.plan,
        meta,
        signal: controller.signal,
        expectedRevision: revision(this.graph, rootUid),
        onProgress,
      });
      journal.changes.push(...written.changes);
      journal.owned = written.owned;
      journal.retained = written.retained;
      if (written.status !== "complete") throw new Error(written.error);
      const root = this.graph.read(rootUid);
      let renderedLabel = meta?.renderedLabel || root?.text;
      const nextLabel = labelText({
        label: preview.label,
        format: preview.query.outputFormat,
      });
      if (
        meta?.renderedLabel &&
        root?.text === meta.renderedLabel &&
        root.text !== nextLabel
      ) {
        if (controller.signal.aborted)
          throw new Error("Stopped before updating the import label.");
        await this.graph.update({ uid: rootUid, text: nextLabel });
        journal.changes.push({
          kind: "update",
          uid: rootUid,
          parentUid: this.graph.parent(rootUid) || "",
          before: root.text,
          after: nextLabel,
        });
        renderedLabel = nextLabel;
      } else if (meta?.renderedLabel && root?.text !== meta.renderedLabel)
        journal.retained.push(rootUid);
      if (controller.signal.aborted)
        throw new Error(
          "Stopped before identity links and saved records finished.",
        );
      await writeIdentities({
        graph: this.graph,
        identities: preview.plan.identities,
        signal: controller.signal,
      });
      for (const uri of preview.plan.destinationLinks || []) {
        if (controller.signal.aborted)
          throw new Error(
            "Stopped before destination identity links finished.",
          );
        const text = `same as:: ${uri}`;
        if (
          !this.graph
            .read(preview.destination)
            ?.children.some((node) => node.text === text)
        ) {
          const uid = this.graph.uid();
          await this.graph.create({
            uid,
            parentUid: preview.destination,
            text,
          });
          journal.changes.push({
            kind: "create",
            uid,
            parentUid: preview.destination,
            after: text,
          });
        }
      }
      if (controller.signal.aborted)
        throw new Error("Stopped before saved records finished.");
      await saveMeta({
        graph: this.graph,
        meta: {
          version: 1,
          rootUid,
          name: preview.name || preview.label,
          sourceUid: preview.query.sourceUid,
          endpointMode: preview.query.endpointMode,
          compatibility: preview.query.compatibility || false,
          ownershipVerified: true,
          owned: journal.owned,
          label: preview.label,
          renderedLabel,
          lastRun: new Date().toISOString(),
        },
      });
      if (preview.save || preview.rootUid)
        await saveRecord({ graph: this.graph, rootUid, query: preview.query });
    } catch (error) {
      journal.status = journal.changes.length ? "partial" : "failed";
      journal.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.active === controller) this.active = undefined;
    }
    return { rootUid, journal };
  };
}
