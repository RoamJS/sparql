import { strict as assert } from "node:assert";
import { test } from "node:test";
import { adoptLegacy, QueryService } from "../src/service";
import { readSaved, saveRecord } from "../src/storage";
import { Query } from "../src/types";
import { MemoryGraph } from "./helpers";
const query: Query = {
  query: "SELECT ?x {}",
  source: "https://example.test/?query=",
  endpointMode: "prefix",
  outputFormat: "Parent",
};
const result = {
  head: { vars: ["x"] },
  results: { bindings: [{ x: { type: "literal", value: "Result" } }] },
};
const setup = (): { graph: MemoryGraph; service: QueryService } => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  return { graph, service: new QueryService(graph, () => "Date") };
};
test("adopts legacy outputs only when the whole validated tree matches, preserving UIDs", () => {
  const { graph } = setup();
  graph.put("old", "Import", "page");
  graph.put("result", "Result", "old");
  const plan = {
    nodes: [{ key: "x", text: "Result", children: [] }],
    identities: [],
    warnings: [],
    rows: 1,
  };
  const args = {
    graph,
    rootUid: "old",
    plan,
    query,
    label: "Import",
    name: "Legacy",
  };
  assert.equal(adoptLegacy(args)?.owned[0].uid, "result");
  graph.put("note", "User note", "old");
  assert.equal(adoptLegacy(args), undefined);
  assert.equal(graph.writes, 0);
});
test("endpoint failure creates no label, identity, configuration or output debris", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("offline", { status: 503 });
  try {
    const { graph, service } = setup();
    await assert.rejects(
      service.preview({
        query,
        destination: "page",
        signature: "a",
        label: "Import",
        name: "",
        save: true,
      }),
      /503/,
    );
    assert.equal(graph.writes, 0);
    assert.equal(graph.nodes.size, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("saved refresh refuses an unsaved draft or a different destination before any request", async () => {
  const { graph, service } = setup();
  graph.put("root", "Saved", "page");
  await saveRecord({ graph, rootUid: "root", query });
  const saved = readSaved(graph)[0];
  const args = {
    query,
    destination: "root",
    saved,
    signature: "a",
    label: "Import",
    name: "",
    save: true,
  };
  const writes = graph.writes;
  await assert.rejects(
    service.preview({ ...args, query: { ...query, outputFormat: "Table" } }),
    /draft differs/,
  );
  await assert.rejects(
    service.preview({ ...args, destination: "page" }),
    /retains its output root/,
  );
  assert.equal(graph.writes, writes);
});
test("preview/import uses exactly one request, saves legacy fields and prevents stale writes", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json(result);
  };
  try {
    const { graph, service } = setup();
    const preview = await service.preview({
      query,
      destination: "page",
      signature: "a",
      label: "Import",
      name: "Example",
      save: true,
    });
    assert.equal(graph.writes, 0);
    await assert.rejects(
      service.import({ preview, currentSignature: "b" }),
      /stale/,
    );
    assert.equal(graph.writes, 0);
    const run = await service.import({ preview, currentSignature: "a" });
    assert.equal(run.journal.status, "complete");
    assert.equal(requests, 1);
    assert.equal(readSaved(graph)[0].query, query.query);
    assert.equal(readSaved(graph)[0].rootUid, run.rootUid);
  } finally {
    globalThis.fetch = original;
  }
});
test("legacy refresh rereads changed definition and offers adjacent import while preserving descendants", async () => {
  const original = globalThis.fetch;
  let url = "";
  globalThis.fetch = async (input) => {
    url = String(input);
    return Response.json(result);
  };
  try {
    const { graph, service } = setup();
    graph.put("old", "Legacy root", "page");
    graph.put("kept", "User content", "old");
    await saveRecord({ graph, rootUid: "old", query });
    const saved = readSaved(graph)[0];
    await graph.update({
      uid: graph.read(saved.recordUid)!.children[0].uid,
      text: "SELECT ?latest {}",
    });
    const preview = await service.preview({
      query,
      destination: "old",
      saved,
      signature: "legacy",
      label: "Import",
      name: "Legacy",
      save: true,
    });
    assert.ok(url.includes(encodeURIComponent("SELECT ?latest {}")));
    assert.equal(preview.legacyCopy, true);
    const applied = await service.import({
      preview,
      currentSignature: "legacy",
    });
    assert.equal(applied.journal.status, "complete");
    assert.notEqual(applied.rootUid, "old");
    assert.equal(graph.read("kept")?.text, "User content");
    assert.equal(graph.read("old")?.children[0].uid, "kept");
  } finally {
    globalThis.fetch = original;
  }
});
test("one active request per controller and cancellation leave graph unchanged", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) =>
      options?.signal?.addEventListener("abort", () =>
        reject(new DOMException("abort", "AbortError")),
      ),
    );
  try {
    const { graph, service } = setup();
    const args = {
      query,
      destination: "page",
      signature: "a",
      label: "Import",
      name: "",
      save: false,
    };
    const first = service.preview(args);
    await assert.rejects(service.preview(args), /already running/);
    service.cancel();
    await assert.rejects(first, /cancelled/);
    assert.equal(graph.writes, 0);
    assert.equal(service.busy(), false);
  } finally {
    globalThis.fetch = original;
  }
});
