import { strict as assert } from "node:assert";
import { test } from "node:test";
import { planOutput } from "../src/format";
import { applyPlan, recover, revision } from "../src/writer";
import { ImportMeta, Plan, Result } from "../src/types";
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
test("a colliding legacy Line row keeps its referenced UID through migration and refresh", async () => {
  const graph = setup();
  graph.put("old-line", "User edit", "root");
  graph.refs.add("old-line");
  const result: Result = {
    head: { vars: ["a", "b"] },
    results: {
      bindings: [
        {
          a: { type: "literal", value: "x::|b:literal:y" },
          b: { type: "literal", value: "z" },
        },
        {
          a: { type: "literal", value: "x" },
          b: { type: "literal", value: "y::|b:literal:z" },
        },
      ],
    },
  };
  const meta: ImportMeta = {
    version: 1,
    rootUid: "root",
    name: "Test",
    endpointMode: "prefix",
    compatibility: false,
    label: "Import",
    ownershipVerified: true,
    owned: [
      {
        uid: "old-line",
        parentUid: "root",
        text: "x::|b:literal:y z",
        key: "a:literal:x::|b:literal:y::|b:literal:z::",
      },
    ],
  };
  const run = (
    previous: ImportMeta,
  ): Promise<Awaited<ReturnType<typeof applyPlan>>> =>
    applyPlan({
      graph,
      rootUid: "root",
      plan: planOutput({ result, format: "Line", dateTitle: () => "" }),
      meta: previous,
      signal: new AbortController().signal,
      expectedRevision: revision(graph, "root"),
    });
  const first = await run(meta);
  assert.equal(first.status, "complete");
  assert.deepEqual(first.retained, ["old-line"]);
  assert.equal(first.changes.length, 1);
  assert.equal(first.changes[0].after, "x y::|b:literal:z");
  assert.ok(first.owned.every((owned) => owned.keyVersion === 2));
  assert.equal(new Set(first.owned.map((owned) => owned.uid)).size, 2);
  result.results.bindings.reverse();
  const again = await run({ ...meta, owned: first.owned });
  assert.equal(again.changes.length, 0);
  assert.deepEqual(again.owned, first.owned);
  assert.equal(graph.read("old-line")?.text, "User edit");
  assert.equal(graph.read("root")?.children.length, 2);
});

test("nested ownership migration matches a legacy key within its saved parent", async () => {
  const graph = setup();
  graph.put("one", "one", "root");
  graph.put("two", "one/two", "root");
  graph.put("item-a", "two/three", "one");
  graph.put("item-b", "three", "two");
  graph.refs.add("item-a");
  graph.refs.add("item-b");
  const result: Result = {
    head: { vars: ["group", "item"] },
    results: {
      bindings: [
        {
          group: { type: "literal", value: "one" },
          item: { type: "literal", value: "two/three" },
        },
        {
          group: { type: "literal", value: "one/two" },
          item: { type: "literal", value: "three" },
        },
      ],
    },
  };
  const meta: ImportMeta = {
    version: 1,
    rootUid: "root",
    name: "Test",
    endpointMode: "prefix",
    compatibility: true,
    label: "Import",
    ownershipVerified: true,
    owned: [
      { uid: "one", parentUid: "root", key: "/one", text: "one" },
      { uid: "two", parentUid: "root", key: "/one/two", text: "one/two" },
      {
        uid: "item-a",
        parentUid: "one",
        key: "/one/two/three",
        text: "two/three",
      },
      { uid: "item-b", parentUid: "two", key: "/one/two/three", text: "three" },
    ],
  };
  const run = (previous: ImportMeta): ReturnType<typeof applyPlan> =>
    applyPlan({
      graph,
      rootUid: "root",
      plan: planOutput({
        result,
        format: "Parent",
        compatibility: true,
        dateTitle: () => "",
      }),
      meta: previous,
      signal: new AbortController().signal,
      expectedRevision: revision(graph, "root"),
    });
  const first = await run(meta);
  assert.equal(first.status, "complete");
  assert.equal(first.changes.length, 0);
  assert.deepEqual(first.owned.map((owned) => owned.uid).sort(), [
    "item-a",
    "item-b",
    "one",
    "two",
  ]);
  assert.ok(first.owned.every((owned) => owned.keyVersion === 2));
  result.results.bindings.reverse();
  const again = await run({ ...meta, owned: first.owned });
  assert.deepEqual(again.owned, first.owned);
  assert.equal(again.changes.length, 0);
});

test("an unambiguous legacy Line refresh can update a paired label in place", async () => {
  const graph = setup();
  graph.put("old-line", "[[Old label]]", "root");
  const output = planOutput({
    result: {
      head: { vars: ["x", "xLabel"] },
      results: {
        bindings: [
          {
            x: { type: "uri", value: "https://example.test/entity" },
            xLabel: { type: "literal", value: "New label" },
          },
        ],
      },
    },
    format: "Line",
    dateTitle: () => "",
  });
  const applied = await applyPlan({
    graph,
    rootUid: "root",
    plan: output,
    meta: {
      version: 1,
      rootUid: "root",
      name: "Test",
      endpointMode: "prefix",
      compatibility: false,
      label: "Import",
      ownershipVerified: true,
      owned: [
        {
          uid: "old-line",
          parentUid: "root",
          text: "[[Old label]]",
          key: "x:uri:https://example.test/entity::",
        },
      ],
    },
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  assert.equal(applied.status, "complete");
  assert.deepEqual(
    applied.changes.map(({ kind, uid }) => [kind, uid]),
    [["update", "old-line"]],
  );
  assert.equal(graph.read("old-line")?.text, "[[New label]]");
});
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

test("10,000 new siblings use bounded shallow reads and preserve ordering", async () => {
  const graph = setup();
  const expectedRevision = revision(graph, "root");
  const read = graph.read;
  let recursiveReads = 0;
  let shallowReads = 0;
  graph.read = (uid, options) => {
    options?.shallow ? shallowReads++ : recursiveReads++;
    return read(uid, options);
  };
  const nodes = Array.from({ length: 10000 }, (_, i) => ({
    key: String(i),
    text: String(i),
    children: [],
  }));
  const result = await applyPlan({
    graph,
    rootUid: "root",
    plan: { nodes, rows: nodes.length, identities: [], warnings: [] },
    signal: new AbortController().signal,
    expectedRevision,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.changes.length, 10000);
  assert.equal(recursiveReads, 2);
  assert.equal(shallowReads, 1);
  assert.deepEqual(
    graph.nodes.get("root")!.children.map((node) => node.text),
    nodes.map((node) => node.text),
  );
});

test("inserting before many retained siblings reads each owned block shallowly", async () => {
  const graph = setup();
  graph.put("b", "Beta", "root");
  graph.put("g", "Gamma", "root");
  const meta: ImportMeta = {
    version: 1,
    rootUid: "root",
    name: "Test",
    endpointMode: "prefix",
    compatibility: false,
    label: "Import",
    owned: [
      { key: "b", uid: "b", parentUid: "root", text: "Beta" },
      { key: "g", uid: "g", parentUid: "root", text: "Gamma" },
    ],
  };
  const nodes = Array.from({ length: 5000 }, (_, i) => ({
    key: `a${i}`,
    text: `Alpha ${i}`,
    children: [],
  }));
  nodes.push(
    { key: "b", text: "Beta", children: [] },
    { key: "g", text: "Gamma", children: [] },
  );
  const result = await applyPlan({
    graph,
    rootUid: "root",
    plan: { nodes, rows: nodes.length, identities: [], warnings: [] },
    meta,
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(
    graph.nodes.get("root")!.children.map((n) => n.text),
    nodes.map((n) => n.text),
  );
  assert.equal(graph.nodes.get("root")!.children.at(-2)!.uid, "b");
});

test("refresh preserves an owned block edited while earlier writes await", async () => {
  const graph = setup();
  graph.put("b", "Beta", "root");
  graph.beforeWrite = () => {
    graph.nodes.get("b")!.text = "Edited during import";
  };
  const result = await applyPlan({
    graph,
    rootUid: "root",
    plan: {
      nodes: [
        { key: "a", text: "Alpha", children: [] },
        { key: "b", text: "New Beta", children: [] },
      ],
      rows: 2,
      identities: [],
      warnings: [],
    },
    meta: {
      version: 1,
      rootUid: "root",
      name: "Test",
      endpointMode: "prefix",
      compatibility: false,
      label: "Import",
      owned: [{ key: "b", uid: "b", parentUid: "root", text: "Beta" }],
    },
    signal: new AbortController().signal,
    expectedRevision: revision(graph, "root"),
  });
  assert.equal(result.status, "complete");
  assert.equal(graph.read("b")!.text, "Edited during import");
  assert.deepEqual(result.retained, ["b"]);
});
