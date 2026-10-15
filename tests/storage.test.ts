import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  readDefaults,
  readSaved,
  resolveSource,
  saveRecord,
  sourceQuery,
} from "../src/storage";
import { MemoryGraph } from "./helpers";
const fixture = (): MemoryGraph => {
  const graph = new MemoryGraph();
  graph.put("config", "roam/js/sparql");
  graph.nodes.get("config")!.title = "roam/js/sparql";
  graph.put("import", "import", "config");
  graph.put("label", "default label", "import");
  graph.put("labelv", "Details {date}", "label");
  graph.put("limit", "default limit", "import");
  graph.put("limitv", "25", "limit");
  graph.put("qual", "qualifiers", "import");
  graph.put("custom", "customQuery", "config");
  graph.put("code", "```sparql\nSELECT ?x {}\n```", "custom");
  graph.put("queries", "queries", "config");
  graph.put("root", "Old output");
  graph.put("record", "root", "queries");
  graph.put("q", "SELECT ?x {}", "record");
  graph.put("s", "https://example.test/?q=", "record");
  graph.put("f", "Table", "record");
  graph.put("unknown", "unknown child", "record");
  return graph;
};
test("reads legacy defaults, ordered query children and UIDs without rewriting", () => {
  const graph = fixture();
  assert.deepEqual(readDefaults(graph), {
    label: "Details {date}",
    limit: 25,
    qualifiers: true,
    customUid: "code",
  });
  const [saved] = readSaved(graph);
  assert.equal(saved.rootUid, "root");
  assert.equal(saved.recordUid, "record");
  assert.equal(saved.outputFormat, "Table");
  assert.equal(saved.compatibility, true);
  assert.equal(saved.endpointMode, "prefix");
  assert.equal(graph.writes, 0);
});
test("legacy configuration keys retain flexible CSS tag suffixes", () => {
  const graph = fixture();
  graph.nodes.get("label")!.text = " default label #.my-setting ";
  graph.nodes.get("queries")!.text = "queries #.saved-queries";
  assert.equal(readDefaults(graph).label, "Details {date}");
  assert.equal(readSaved(graph).length, 1);
});
test("editing a record preserves positional UIDs and unknown children", async () => {
  const graph = fixture();
  await saveRecord({
    graph,
    rootUid: "root",
    query: {
      query: "SELECT ?new {}",
      source: "https://other.test/?q=",
      outputFormat: "Line",
      endpointMode: "prefix",
    },
  });
  assert.deepEqual(
    graph.read("record")?.children.map((node) => node.uid),
    ["q", "s", "f", "unknown"],
  );
  assert.equal(graph.read("q")?.text, "SELECT ?new {}");
});
test("deleted destinations and malformed records remain visible errors", () => {
  const graph = fixture();
  graph.nodes.delete("root");
  assert.match(readSaved(graph)[0].error || "", /deleted/);
  graph.nodes.get("f")!.text = "Unsupported";
  assert.match(readSaved(graph)[0].error || "", /Malformed/);
});
test("resolves source, containing parent, references, cycles and deleted references", () => {
  const graph = fixture();
  graph.put("ref", "((code))");
  graph.put("empty", "", "custom");
  assert.equal(resolveSource({ graph, uid: "ref" }).uid, "code");
  assert.equal(resolveSource({ graph, uid: "empty" }).uid, "code");
  graph.put("a", "((b))");
  graph.put("b", "((a))");
  assert.throws(() => resolveSource({ graph, uid: "a" }), /cycle/);
  graph.put("missing", "((deleted))");
  assert.throws(() => resolveSource({ graph, uid: "missing" }), /deleted/);
});
test("per-query endpoint metadata is independent of legacy positions", () => {
  const graph = fixture();
  graph.put(
    "endpoint",
    "sparql endpoint:: https://example.test/sparql?x=1",
    "code",
  );
  graph.put("mode", "sparql endpoint mode:: standard", "code");
  graph.put("format", "sparql format:: Line", "code");
  const query = sourceQuery({ graph, uid: "code" });
  assert.equal(query.endpointMode, "standard");
  assert.equal(query.outputFormat, "Line");
  assert.equal(query.sourceUid, "code");
  assert.equal(query.query, "SELECT ?x {}");
});

test("saved record persistence honors cancellation between every awaited write", async () => {
  for (const stopAt of [1, 2, 3, 4, 5, 6]) {
    const graph = new MemoryGraph();
    graph.put("root", "Output");
    const controller = new AbortController();
    graph.beforeWrite = (): void => {
      if (graph.writes + 1 === stopAt) controller.abort();
    };
    await assert.rejects(
      saveRecord({
        graph,
        rootUid: "root",
        query: {
          query: "SELECT ?x {}",
          source: "https://example.test/?q=",
          endpointMode: "prefix",
          outputFormat: "Parent",
        },
        signal: controller.signal,
      }),
      /Stopped/,
    );
    assert.equal(graph.writes, stopAt);
  }
});
