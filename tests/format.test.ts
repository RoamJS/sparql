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

test("unpaired Label columns remain ordinary output in every format", () => {
  const unpaired: Result = {
    head: { vars: ["displayLabel"] },
    results: {
      bindings: [{ displayLabel: { type: "literal", value: "Ada" } }],
    },
  };
  for (const format of ["Parent", "Line", "Table"] as const) {
    const plan = planOutput({ result: unpaired, format, dateTitle });
    assert.equal(plan.rows, 1);
    assert.equal(plan.nodes.at(-1)!.text, "Ada");
    assert.deepEqual(plan.identities, []);
    if (format === "Table") assert.equal(plan.nodes[0].text, "displayLabel");
  }
  const mixed: Result = {
    head: { vars: ["x", "xLabel", "displayLabel"] },
    results: {
      bindings: [
        {
          x: { type: "uri", value: "entity1" },
          xLabel: { type: "literal", value: "Paired" },
          displayLabel: { type: "literal", value: "Standalone" },
        },
      ],
    },
  };
  const table = planOutput({ result: mixed, format: "Table", dateTitle });
  assert.equal(table.nodes[0].text, "x");
  assert.equal(table.nodes[0].children[0].text, "displayLabel");
  assert.equal(table.nodes[1].children[0].text, "Standalone");
});

test("calendar dates and midnight UTC Wikidata dates retain their calendar day across timezones", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of [
      "America/Regina",
      "America/Los_Angeles",
      "UTC",
      "Pacific/Auckland",
    ]) {
      process.env.TZ = timezone;
      for (const compatibility of [false, true]) {
        const dates: Result = {
          head: { vars: ["birth"] },
          results: {
            bindings: ["1815-12-10", "1815-12-10T00:00:00Z"].map((value) => ({
              birth: {
                type: "literal",
                datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
                value,
              },
            })),
          },
        };
        const plan = planOutput({
          result: dates,
          format: "Parent",
          compatibility,
          dateTitle: (date) =>
            `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
        });
        assert.ok(
          plan.nodes.every((n) => n.text === "[[1815-12-10]]"),
          timezone,
        );
      }
      const instant: Result = {
        head: { vars: ["time"] },
        results: {
          bindings: [
            {
              time: {
                type: "literal",
                datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
                value: "2026-11-06T01:00:00Z",
              },
            },
          ],
        },
      };
      assert.equal(
        planOutput({
          result: instant,
          format: "Parent",
          dateTitle: (date) => String(date.getDate()),
        }).nodes[0].text,
        `[[${new Date("2026-11-06T01:00:00Z").getDate()}]]`,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("Table preserves unbound and empty cell positions while Parent keeps filtering", () => {
  for (const compatibility of [false, true]) {
    const optional: Result = {
      head: { vars: ["a", "b", "c"] },
      results: { bindings: [{ b: { type: "literal", value: "42" } }] },
    };
    const table = planOutput({
      result: optional,
      format: "Table",
      dateTitle,
      compatibility,
    });
    assert.equal(table.nodes[0].text, "a");
    assert.equal(table.nodes[0].children[0].text, "b");
    assert.equal(table.nodes[0].children[0].children[0].text, "c");
    assert.equal(table.nodes[1].text, "");
    assert.equal(table.nodes[1].children[0].text, "42");
    assert.equal(table.nodes[1].children[0].children[0].text, "");
    optional.results.bindings = [
      {
        a: { type: "literal", value: "" },
        b: { type: "literal", value: "Later column" },
        c: { type: "literal", value: "" },
      },
    ];
    const empty = planOutput({
      result: optional,
      format: "Table",
      dateTitle,
      compatibility,
    });
    assert.equal(empty.nodes[1].text, "");
    assert.equal(empty.nodes[1].children[0].text, "Later column");
    assert.equal(empty.nodes[1].children[0].children[0].text, "");
    for (const middle of [undefined, { type: "literal" as const, value: "" }]) {
      const row = {
        a: { type: "literal" as const, value: "Leading" },
        c: { type: "literal" as const, value: "Trailing" },
        ...(middle ? { b: middle } : {}),
      };
      const middleTable = planOutput({
        result: { ...optional, results: { bindings: [row] } },
        format: "Table",
        dateTitle,
        compatibility,
      });
      assert.equal(middleTable.nodes[1].text, "Leading");
      assert.equal(middleTable.nodes[1].children[0].text, "");
      assert.equal(
        middleTable.nodes[1].children[0].children[0].text,
        "Trailing",
      );
    }
    const parent = planOutput({
      result: optional,
      format: "Parent",
      dateTitle,
      compatibility,
    });
    assert.equal(parent.nodes[0].text, "Later column");
    assert.deepEqual(parent.nodes[0].children, []);
  }
});
