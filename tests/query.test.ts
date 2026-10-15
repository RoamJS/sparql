import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertSelect,
  codeFromBlock,
  endpointUrl,
  entityQuery,
  fetchResult,
  normalizeResult,
} from "../src/query";
import { Query } from "../src/types";
const result = {
  head: { vars: ["item"] },
  results: {
    bindings: [
      { item: { type: "uri", value: "http://www.wikidata.org/entity/Q1" } },
    ],
  },
};
const query: Query = {
  query: "SELECT ?item WHERE { ?item ?p ?v } LIMIT 1",
  source: "https://example.test/sparql?query=",
  endpointMode: "prefix",
  outputFormat: "Parent",
};
test("legacy prefix preserves existing parameters and encodes the entire query", () => {
  assert.equal(
    endpointUrl(query),
    query.source + encodeURIComponent(query.query),
  );
});
test("standard endpoint retains unrelated parameters and replaces query", () => {
  const url = new URL(
    endpointUrl({
      ...query,
      endpointMode: "standard",
      source: "https://example.test/?token=public&query=old",
    }),
  );
  assert.equal(url.searchParams.get("token"), "public");
  assert.equal(url.searchParams.get("query"), query.query);
  assert.equal(url.searchParams.get("format"), "json");
});
test("normalizes direct, string and legacy wrapped JSON without conflating empty bindings", () => {
  for (const payload of [
    result,
    JSON.stringify(result),
    { data: JSON.stringify(result) },
  ])
    assert.deepEqual(normalizeResult(payload), result);
  assert.equal(
    normalizeResult({ head: { vars: [] }, results: { bindings: [] } }).results
      .bindings.length,
    0,
  );
});
test("rejects malformed, HTML, boolean, missing bindings and bad cells", () => {
  for (const payload of [
    "<html>error</html>",
    { boolean: true },
    {},
    { head: { vars: [] }, results: { bindings: [null] } },
    {
      head: { vars: ["x"] },
      results: { bindings: [{ x: { type: "uri", value: 2 } }] },
    },
  ])
    assert.throws(() => normalizeResult(payload));
});
test("only SELECT is sent, allowing PREFIX comments and fragment IRIs", () => {
  assert.doesNotThrow(() =>
    assertSelect(
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n# comment\nSELECT ?x { BIND("#literal" AS ?x) }',
    ),
  );
  for (const text of [
    "ASK {}",
    "DELETE WHERE {?a ?b ?c}",
    "CONSTRUCT {?a ?b ?c} WHERE {}",
    "INSERT DATA {}",
    "DESCRIBE ?a WHERE {}",
    "# SELECT fake\nLOAD <http://bad>",
  ])
    assert.throws(() => assertSelect(text));
});
test("rejects credentialed and non-http endpoints before network", () => {
  for (const source of [
    "file:///etc/passwd",
    "https://user:pass@example.test",
    "example.test",
  ])
    assert.throws(() => endpointUrl({ ...query, source }));
});
test("extracts native fenced queries without eval", () => {
  assert.equal(codeFromBlock("```sparql\nSELECT * {}\n```"), "SELECT * {}");
  assert.equal(codeFromBlock("```js\nthrow Error()\n```"), "");
});
test("entity selection filters property IDs and separately supports P entity detail queries", () => {
  assert.match(
    entityQuery({
      id: "Q7259",
      limit: 20,
      qualifiers: true,
      properties: ["P31", "P569"],
    }),
    /VALUES \?property \{ wd:P31 wd:P569 \}/,
  );
  assert.match(
    entityQuery({ id: "P31", limit: 5, qualifiers: false }),
    /\(wd:P31\)/,
  );
  assert.throws(() =>
    entityQuery({ id: "Q1) }", limit: 10, qualifiers: false }),
  );
  assert.throws(() => entityQuery({ id: "Q1", limit: NaN, qualifiers: false }));
  assert.throws(() =>
    entityQuery({ id: "Q1", limit: 1, qualifiers: false, properties: ["Q2"] }),
  );
});
test("HTTP 429 and malformed response produce useful errors", async () => {
  const controller = new AbortController();
  await assert.rejects(
    fetchResult({
      query,
      signal: controller.signal,
      fetcher: async () => new Response("", { status: 429 }),
    }),
    /rate limit/,
  );
  await assert.rejects(
    fetchResult({
      query,
      signal: controller.signal,
      fetcher: async () => new Response("oops"),
    }),
    /malformed JSON/,
  );
});
test("timeout and abort terminate pending requests", async () => {
  const pending: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      ),
    );
  await assert.rejects(
    fetchResult({
      query,
      signal: new AbortController().signal,
      fetcher: pending,
      timeout: 5,
    }),
    /timed out/,
  );
  const controller = new AbortController();
  const run = fetchResult({
    query,
    signal: controller.signal,
    fetcher: pending,
  });
  controller.abort();
  await assert.rejects(run, /cancelled/);
});
