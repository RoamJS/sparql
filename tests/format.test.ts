import { strict as assert } from "node:assert";
import { test } from "node:test";
import { labelText, planOutput } from "../src/format";
import { Result } from "../src/types";
const result: Result = {
  head: { vars: ["property", "propertyLabel", "value", "valueLabel"] },
  results: {
    bindings: [
      {
        property: { type: "uri", value: "http://www.wikidata.org/entity/P31" },
        propertyLabel: { type: "literal", value: "instance of" },
        value: { type: "uri", value: "http://www.wikidata.org/entity/Q5" },
        valueLabel: { type: "literal", value: "human" },
      },
      {
        property: { type: "uri", value: "http://www.wikidata.org/entity/P31" },
        propertyLabel: { type: "literal", value: "instance of" },
        value: { type: "uri", value: "http://www.wikidata.org/entity/Q6" },
        valueLabel: { type: "literal", value: "person" },
      },
    ],
  },
};
const dateTitle = (): string => "December 10th, 1815";
test("Parent golden tree preserves variable order, property attributes and grouped values", () => {
  const plan = planOutput({
    result,
    format: "Parent",
    dateTitle,
    compatibility: true,
  });
  assert.deepEqual(
    plan.nodes.map((n) => ({
      text: n.text,
      children: n.children.map((c) => c.text),
    })),
    [{ text: "instance of::", children: ["[[human]]", "[[person]]"] }],
  );
  assert.equal(plan.identities.length, 3);
});
test("Line and Table golden structures", () => {
  assert.deepEqual(
    planOutput({
      result,
      format: "Line",
      dateTitle,
      compatibility: true,
    }).nodes.map((n) => n.text),
    ["instance of:: [[human]]", "instance of:: [[person]]"],
  );
  const table = planOutput({ result, format: "Table", dateTitle });
  assert.equal(table.nodes[0].text, "property");
  assert.equal(table.nodes[0].children[0].text, "value");
});
test("typed formatter distinguishes equal labels; compatibility keeps legacy grouping", () => {
  const duplicate = structuredClone(result);
  duplicate.results.bindings[1].valueLabel.value = "human";
  assert.equal(
    planOutput({ result: duplicate, format: "Parent", dateTitle }).nodes[0]
      .children.length,
    2,
  );
  assert.equal(
    planOutput({
      result: duplicate,
      format: "Parent",
      dateTitle,
      compatibility: true,
    }).nodes[0].children.length,
    1,
  );
});
test("optional bindings, missing paired variables and blank nodes do not crash", () => {
  const optional: Result = {
    head: { vars: ["x", "xLabel", "y"] },
    results: {
      bindings: [
        { xLabel: { type: "literal", value: "unpaired" } },
        { y: { type: "bnode", value: "b1" } },
      ],
    },
  };
  assert.doesNotThrow(() =>
    planOutput({ result: optional, format: "Parent", dateTitle }),
  );
});
test("repeated URLs format consistently; images, integer literals and typed dates are stable", () => {
  const cells: Result = {
    head: { vars: ["x"] },
    results: {
      bindings: [
        "https://example.test/a",
        "https://example.test/b",
        "https://example.test/photo.png",
        "123",
        "2000-01-01",
      ].map((value) => ({ x: { type: "literal", value } })),
    },
  };
  const plan = planOutput({ result: cells, format: "Parent", dateTitle });
  const texts = plan.nodes.map((n) => n.text);
  assert.ok(texts.includes("[https://example.test/a](https://example.test/a)"));
  assert.ok(texts.includes("[https://example.test/b](https://example.test/b)"));
  assert.ok(texts.includes("![](https://example.test/photo.png)"));
  assert.ok(texts.includes("2000-01-01"));
  cells.results.bindings[4].x.datatype =
    "http://www.w3.org/2001/XMLSchema#date";
  assert.ok(
    planOutput({ result: cells, format: "Parent", dateTitle }).nodes.some(
      (n) => n.text === "[[December 10th, 1815]]",
    ),
  );
});
test("legacy date parsing remains explicit and empty results are successful", () => {
  const literal: Result = {
    head: { vars: ["x"] },
    results: { bindings: [{ x: { type: "literal", value: "2000-01-01" } }] },
  };
  assert.equal(
    planOutput({
      result: literal,
      format: "Parent",
      compatibility: true,
      dateTitle,
    }).nodes[0].text,
    "[[December 10th, 1815]]",
  );
  assert.equal(
    planOutput({
      result: { head: { vars: ["x"] }, results: { bindings: [] } },
      format: "Parent",
      dateTitle,
    }).nodes[0].text,
    "No results found",
  );
});
test("labels retain date placeholder and table macro", () => {
  const date = new Date("2026-10-15T12:00:00Z");
  assert.equal(
    labelText({ label: "Run {date}", format: "Table", date }),
    `Run ${date.toLocaleString()} {{[[table]]}}`,
  );
});
