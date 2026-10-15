import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyPlan, recover, revision } from "../src/writer";
import { ImportMeta, Plan } from "../src/types";
import { MemoryGraph } from "./helpers";
const plan: Plan = {
  nodes: [
    {
      key: "a",
      text: "Alpha",
      children: [{ key: "a/b", text: "Beta", children: [] }],
    },
    { key: "c", text: "Gamma", children: [] },
  ],
  identities: [],
  rows: 2,
  warnings: [],
};
const setup = (): MemoryGraph => {
  const graph = new MemoryGraph();
  graph.put("root", "Import");
  return graph;
};
test("awaits all writes and updates matching owned UIDs in place", async () => {
  const graph = setup();
  const first = await applyPlan({
    graph,
    rootUid: "root",
    plan,
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  assert.equal(first.status, "complete");
  assert.equal(first.changes.length, 3);
  const meta: ImportMeta = {
    version: 1,
    rootUid: "root",
    name: "Test",
    endpointMode: "prefix",
    compatibility: false,
    owned: first.owned,
    label: "Import",
    ownershipVerified: true,
  };
  graph.refs.add(first.owned[0].uid);
  const renamed = structuredClone(plan);
  renamed.nodes[0].text = "Renamed";
  const second = await applyPlan({
    graph,
    rootUid: "root",
    plan: renamed,
    meta,
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  assert.equal(second.changes.length, 1);
  assert.equal(second.changes[0].uid, first.owned[0].uid);
  assert.equal(graph.read(first.owned[0].uid)?.text, "Renamed");
});
test("refresh retains user edits, notes and obsolete owned blocks", async () => {
  const graph = setup();
  const first = await applyPlan({
    graph,
    rootUid: "root",
    plan,
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  const meta: ImportMeta = {
    version: 1,
    rootUid: "root",
    name: "Test",
    endpointMode: "prefix",
    compatibility: false,
    owned: first.owned,
    label: "Import",
  };
  const a = first.owned[0];
  await graph.update({ uid: a.uid, text: "User edit" });
  graph.put("note", "User note", a.uid);
  const next = structuredClone(plan);
  next.nodes = [next.nodes[0]];
  const result = await applyPlan({
    graph,
    rootUid: "root",
    plan: next,
    meta,
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  assert.equal(graph.read(a.uid)?.text, "User edit");
  assert.equal(graph.read("note")?.text, "User note");
  assert.ok(result.retained.includes(a.uid));
  assert.ok(graph.read(first.owned[2].uid));
});
test("destination revision mismatch prevents every write", async () => {
  const graph = setup();
  const before = revision(graph, "root");
  graph.put("note", "External note", "root");
  const outcome = await applyPlan({
    graph,
    rootUid: "root",
    plan,
    signal: new AbortController().signal,
    expectedRevision: before,
  });
  assert.equal(outcome.status, "failed");
  assert.equal(graph.writes, 0);
});
test("first, middle and final output failures return honest journals", async () => {
  for (const failAt of [1, 2, 3]) {
    const graph = setup();
    graph.failAt = failAt;
    const result = await applyPlan({
      graph,
      rootUid: "root",
      plan,
      signal: new AbortController().signal,
      expectedRevision: revision(graph, "root"),
    });
    assert.equal(result.status, failAt === 1 ? "failed" : "partial");
    assert.equal(result.changes.length, failAt - 1);
    assert.match(result.error || "", /Injected/);
  }
});
test("stop prevents subsequent writes without pretending rollback", async () => {
  const graph = setup();
  const controller = new AbortController();
  const outcome = await applyPlan({
    graph,
    rootUid: "root",
    plan,
    signal: controller.signal,
    expectedRevision: revision(graph, "root"),
    onProgress: () => controller.abort(),
  });
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.changes.length, 1);
  assert.match(outcome.error || "", /Stopped/);
});
test("bounded recovery retains edited and referenced created blocks", async () => {
  const graph = setup();
  const outcome = await applyPlan({
    graph,
    rootUid: "root",
    plan,
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  graph.refs.add(outcome.changes[2].uid);
  await graph.update({ uid: outcome.changes[1].uid, text: "User changed" });
  const recovered = await recover({ graph, journal: outcome });
  assert.equal(recovered.recovered.length, 0);
  assert.equal(recovered.retained.length, 3);
  assert.equal(graph.read(outcome.changes[1].uid)?.text, "User changed");
});

test("refresh inserts new sorted siblings and Table header without moving existing nodes", async () => {
  const graph = setup();
  const initial: Plan = {
    nodes: [
      { key: "b", text: "Beta", children: [] },
      { key: "g", text: "Gamma", children: [] },
    ],
    rows: 2,
    identities: [],
    warnings: [],
  };
  const first = await applyPlan({
    graph,
    rootUid: "root",
    plan: initial,
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  graph.put("note", "User note", "root");
  const meta: ImportMeta = {
    version: 1,
    rootUid: "root",
    name: "Test",
    endpointMode: "prefix",
    compatibility: false,
    owned: first.owned,
    label: "Import",
  };
  const updated: Plan = {
    ...initial,
    nodes: [
      { key: "header:x", text: "x", children: [] },
      { key: "a", text: "Alpha", children: [] },
      initial.nodes[0],
      { key: "d", text: "Delta", children: [] },
      initial.nodes[1],
    ],
  };
  const outcome = await applyPlan({
    graph,
    rootUid: "root",
    plan: updated,
    meta,
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  assert.equal(outcome.status, "complete");
  assert.deepEqual(
    graph.read("root")!.children.map((n) => n.text),
    ["x", "Alpha", "Beta", "Delta", "Gamma", "User note"],
  );
  assert.deepEqual(
    graph
      .read("root")!
      .children.filter((n) => ["Beta", "Gamma", "User note"].includes(n.text))
      .map((n) => n.uid),
    [first.owned[0].uid, first.owned[1].uid, "note"],
  );
  assert.ok(outcome.changes.every((c) => c.kind === "create"));
});
