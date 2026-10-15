import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  process.env.PLAYWRIGHT_PACKAGE_ROOT
    ? path.join(process.env.PLAYWRIGHT_PACKAGE_ROOT, "package.json")
    : import.meta.url,
);
const { chromium } = require("playwright");
const receiptPath = process.argv[2];
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const out = path.join(path.dirname(receiptPath), "matrix");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.connectOverCDP(receipt.cdpUrl);
const context = browser.contexts()[0];
const page = context
  .pages()
  .find((p) => p.url().startsWith(receipt.graphUrl.split("/page/")[0]));
page.setDefaultTimeout(15000);
const checks = [],
  errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
const sourceFixture = JSON.parse(
  fs.readFileSync(path.join(path.dirname(receiptPath), "fixture.json"), "utf8"),
);
const uidOf = (tree) => tree?.[":block/uid"];
const childrenOf = (tree) => tree?.[":block/children"] || [];
const textOf = (tree) => tree?.[":block/string"] || "";
const read = async (uid) =>
  page.evaluate(
    (uid) =>
      window.roamAlphaAPI.pull(
        "[:block/uid :block/string :node/title {:block/children ...}]",
        [":block/uid", uid],
      ),
    uid,
  );
const open = async (args = {}) => {
  await page.evaluate(
    async (args) => {
      window.roamjsSparql.close();
      await window.roamjsSparql.open(args);
    },
    {
      destination: sourceFixture.pageUid,
      blockUid: sourceFixture.sourceUid,
      sourceUid: sourceFixture.sourceUid,
      mode: "Custom Query",
      ...args,
    },
  );
  await page.getByTestId("sparql-workbench").waitFor();
  await page.waitForTimeout(300);
};
const settings = async () => {
  if (!(await page.getByLabel("Import label", { exact: true }).isVisible()))
    await page
      .getByRole("button", { name: "Query settings", exact: true })
      .click();
};
const status = (text) => page.getByRole("status").filter({ hasText: text });
const check = async (name, run) => {
  try {
    const detail = await run();
    checks.push({ name, status: "passed", detail });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, status: "failed", error: error.message });
    await page.screenshot({
      path: path.join(out, `failure-${checks.length}.png`),
    });
    console.log(`FAIL ${name}: ${error.message}`);
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(out, "checks.json"),
      JSON.stringify(
        {
          identity: receipt.identity,
          graph: receipt.graphUrl,
          checks,
          errors,
          requests,
        },
        null,
        2,
      ),
    );
  }
};
const payload = {
  head: { vars: ["property", "propertyLabel", "value", "valueLabel"] },
  results: {
    bindings: [
      {
        property: { type: "uri", value: "http://www.wikidata.org/entity/P31" },
        propertyLabel: { type: "literal", value: "instance of" },
        value: { type: "uri", value: "http://www.wikidata.org/entity/Q5" },
        valueLabel: { type: "literal", value: "human" },
      },
    ],
  },
};
let responseMode = "ready";
let delay = 0;
await page.route("https://query.wikidata.org/**", async (route) => {
  requests.push(route.request().url());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  if (responseMode === "http-error")
    return route.fulfill({ status: 503, body: "fixture unavailable" });
  if (responseMode === "empty")
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ head: payload.head, results: { bindings: [] } }),
    });
  await route.fulfill({
    contentType: "application/sparql-results+json",
    body: JSON.stringify(payload),
  });
});
await page.route("https://www.wikidata.org/w/api.php**", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      search: [
        {
          id: route.request().url().includes("type=property") ? "P31" : "Q7259",
          label: "Fixture Ada Lovelace",
          description: "Deterministic search fixture",
        },
      ],
    }),
  }),
);
try {
  const toast = page
    .locator(".bp3-toast")
    .filter({ hasText: "permission to load" });
  if (await toast.count())
    await toast.getByRole("button", { name: "Close", exact: true }).click();
  await check(
    "native source editing persists and latest text is sent",
    async () => {
      await open();
      const editor = page.locator(".sparql-native-source .cm-content");
      await editor.click();
      await editor.press("Meta+a");
      await page.keyboard.insertText(
        'SELECT ?property ?propertyLabel ?value ?valueLabel WHERE { VALUES (?property ?propertyLabel ?value ?valueLabel) { (wd:P31 "instance of" wd:Q5 "latest human") } }',
      );
      await page.getByLabel("Destination UID", { exact: true }).click();
      await page.waitForFunction(
        (uid) =>
          window.roamAlphaAPI
            .pull("[:block/string]", [":block/uid", uid])
            ?.[":block/string"]?.includes("latest human"),
        sourceFixture.sourceUid,
      );
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await status("Preview ready").waitFor();
      assert.ok(decodeURIComponent(requests.at(-1)).includes("latest human"));
      return { sourceUid: sourceFixture.sourceUid, latestSent: true };
    },
  );
  await check("Parent import uses preview once and saves query", async () => {
    await settings();
    await page
      .getByLabel("Import label", { exact: true })
      .fill("Matrix Parent");
    await page.getByLabel("Library name", { exact: true }).fill("Matrix query");
    await page
      .locator("label")
      .filter({ hasText: /^Save query for refresh$/ })
      .click();
    const start = requests.length;
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await status("Preview ready").waitFor();
    await page
      .getByRole("button", { name: "Import previewed results", exact: true })
      .click();
    await status("Import complete").waitFor();
    assert.equal(requests.length - start, 1);
    const tree = await read(sourceFixture.pageUid);
    const root = childrenOf(tree).find(
      (node) => textOf(node) === "Matrix Parent",
    );
    assert.ok(root);
    assert.equal(textOf(childrenOf(root)[0]), "instance of::");
    assert.equal(textOf(childrenOf(childrenOf(root)[0])[0]), "[[human]]");
    sourceFixture.savedRoot = uidOf(root);
    sourceFixture.ownedChild = uidOf(childrenOf(root)[0]);
    fs.writeFileSync(
      path.join(out, "fixture.json"),
      JSON.stringify(sourceFixture, null, 2),
    );
    await page.screenshot({ path: path.join(out, "parent-import.png") });
    return { rootUid: sourceFixture.savedRoot, requestCount: 1 };
  });
  await check("saved refresh retains root and owned UIDs", async () => {
    await open({ savedRoot: sourceFixture.savedRoot });
    await page
      .getByRole("button", { name: "Refresh saved import", exact: true })
      .click();
    await status("Import complete").waitFor();
    const root = await read(sourceFixture.savedRoot);
    assert.equal(uidOf(childrenOf(root)[0]), sourceFixture.ownedChild);
    return {
      rootUid: sourceFixture.savedRoot,
      childUid: sourceFixture.ownedChild,
    };
  });
  await check(
    "network failure leaves saved output tree unchanged",
    async () => {
      const before = await read(sourceFixture.savedRoot);
      responseMode = "http-error";
      await page
        .getByRole("button", { name: "Refresh saved import", exact: true })
        .click();
      await status("HTTP 503").waitFor();
      responseMode = "ready";
      assert.deepEqual(await read(sourceFixture.savedRoot), before);
      return "503 fixture, zero graph changes";
    },
  );
  await check("user-edited refresh child is retained visibly", async () => {
    await page.evaluate(
      async (uid) =>
        window.roamAlphaAPI.updateBlock({
          block: { uid, string: "User-edited property" },
        }),
      sourceFixture.ownedChild,
    );
    await page
      .getByRole("button", { name: "Refresh saved import", exact: true })
      .click();
    await status("retained").waitFor();
    assert.equal(
      textOf(await read(sourceFixture.ownedChild)),
      "User-edited property",
    );
    await page.screenshot({
      path: path.join(out, "edited-refresh-retained.png"),
    });
    return "Edited descendant retained and reported";
  });
  for (const format of ["Line", "Table"])
    await check(`${format} format and explicit destination`, async () => {
      await open();
      await settings();
      await page
        .getByLabel("Output format", { exact: true })
        .selectOption(format);
      await page
        .getByLabel("Import label", { exact: true })
        .fill(`Matrix ${format}`);
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await status("Import complete").waitFor();
      const tree = await read(sourceFixture.pageUid);
      const root = childrenOf(tree).find((node) =>
        textOf(node).startsWith(`Matrix ${format}`),
      );
      assert.ok(root);
      if (format === "Line")
        assert.equal(textOf(childrenOf(root)[0]), "instance of:: [[human]]");
      else {
        assert.ok(textOf(root).includes("{{[[table]]}}"));
        assert.equal(textOf(childrenOf(root)[0]), "property");
      }
      return { uid: uidOf(root), format };
    });
  await check(
    "empty result is successful and unsupported query has no writes",
    async () => {
      await open();
      responseMode = "empty";
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await status("0 result rows").waitFor();
      assert.ok(
        await page
          .getByLabel("SPARQL result preview")
          .getByText("No results found", { exact: true })
          .isVisible(),
      );
      responseMode = "ready";
      const before = await read(sourceFixture.pageUid);
      await page.evaluate(
        async (uid) =>
          window.roamAlphaAPI.updateBlock({
            block: { uid, string: "```sparql\nASK {}\n```" },
          }),
        sourceFixture.sourceUid,
      );
      const count = requests.length;
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await status("Only SELECT").waitFor();
      assert.equal(requests.length, count);
      const after = await read(sourceFixture.pageUid);
      assert.equal(childrenOf(after).length, childrenOf(before).length);
      await page.evaluate(
        async (uid) =>
          window.roamAlphaAPI.updateBlock({
            block: { uid, string: "```sparql\nSELECT ?x {}\n```" },
          }),
        sourceFixture.sourceUid,
      );
      return "Empty success; ASK rejected before network";
    },
  );
  await check(
    "Current Page, properties, qualifiers and property entity lookup",
    async () => {
      await open({ mode: "Current Page", sourceUid: undefined });
      await page
        .getByLabel("Entity search", { exact: true })
        .fill("Ada & proof #1");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page
        .locator("label")
        .filter({ hasText: /^Fixture Ada Lovelace/ })
        .click();
      await page
        .locator("label")
        .filter({ hasText: /^All properties$/ })
        .click();
      await page
        .getByLabel("Selected properties", { exact: true })
        .fill("P31, P569");
      await page
        .locator("label")
        .filter({ hasText: /^Import qualifiers$/ })
        .click();
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await status("Preview ready").waitFor();
      const sent = decodeURIComponent(requests.at(-1));
      assert.ok(sent.includes("VALUES ?property { wd:P31 wd:P569 }"));
      assert.ok(sent.includes("?qualifierProperty"));
      await page
        .getByLabel("Entity kind", { exact: true })
        .selectOption("property");
      await page.getByLabel("Entity search", { exact: true }).fill("P31");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page
        .locator("label")
        .filter({ hasText: /^P31 \(P31\)/ })
        .click();
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await status("Preview ready").waitFor();
      assert.ok(decodeURIComponent(requests.at(-1)).includes("(wd:P31)"));
      return "Item property filter and separate P entity detail query";
    },
  );
  await check("Current Block works on an empty block's parent", async () => {
    const empty = await page.evaluate(async (parentUid) => {
      const uid = window.roamAlphaAPI.util.generateUID();
      await window.roamAlphaAPI.createBlock({
        location: { "parent-uid": parentUid, order: "last" },
        block: { uid, string: "" },
      });
      return uid;
    }, sourceFixture.pageUid);
    await open({ mode: "Current Block", blockUid: empty });
    assert.equal(
      await page.getByLabel("Destination UID", { exact: true }).inputValue(),
      sourceFixture.pageUid,
    );
    await page.getByLabel("Entity search", { exact: true }).fill("Q7259");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .locator("label")
      .filter({ hasText: /^Q7259 \(Q7259\)/ })
      .click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await status("Import complete").waitFor();
    return { emptyUid: empty, destination: sourceFixture.pageUid };
  });
  await check(
    "workspace mounts, native editor remains graph-backed and narrow layout stacks",
    async () => {
      await page
        .getByRole("button", { name: "Workspace", exact: true })
        .click();
      await page.locator(".sparql-workspace-mount").waitFor();
      await page
        .getByRole("button", { name: "Matrix query", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Source block UID", { exact: true }).inputValue(),
        sourceFixture.sourceUid,
      );
      await page.screenshot({ path: path.join(out, "workspace-desktop.png") });
      await page.setViewportSize({ width: 540, height: 850 });
      await page.screenshot({ path: path.join(out, "workspace-narrow.png") });
      const columns = await page
        .locator(".sparql-layout")
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
      assert.ok(!columns.includes(" "));
      await page.setViewportSize({ width: 1440, height: 1000 });
      return { columns, surface: "workspace" };
    },
  );
  await check(
    "block reference source resolution and endpoint metadata",
    async () => {
      const reference = await page.evaluate(async (fixture) => {
        const api = window.roamAlphaAPI;
        const uid = api.util.generateUID();
        await api.createBlock({
          location: { "parent-uid": fixture.pageUid, order: "last" },
          block: { uid, string: `((${fixture.sourceUid}))` },
        });
        for (const string of [
          "sparql endpoint:: https://query.wikidata.org/sparql",
          "sparql endpoint mode:: standard",
          "sparql format:: Table",
        ])
          await api.createBlock({
            location: { "parent-uid": fixture.sourceUid, order: "last" },
            block: { uid: api.util.generateUID(), string },
          });
        return uid;
      }, sourceFixture);
      await open({ sourceUid: reference });
      await settings();
      assert.equal(
        await page.getByLabel("Source block UID", { exact: true }).inputValue(),
        sourceFixture.sourceUid,
      );
      assert.equal(
        await page.getByLabel("Endpoint mode", { exact: true }).inputValue(),
        "standard",
      );
      assert.equal(
        await page.getByLabel("Output format", { exact: true }).inputValue(),
        "Table",
      );
      return { reference, sourceUid: sourceFixture.sourceUid };
    },
  );
  await check("Escape closes native dialog", async () => {
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "SPARQL Import" })
      .waitFor({ state: "hidden" });
    return "Dialog closed";
  });
  console.log(JSON.stringify({ checks: checks.length, errors }, null, 2));
} finally {
  await page.unroute("https://query.wikidata.org/**");
  await page.unroute("https://www.wikidata.org/w/api.php**");
  await browser.close();
}
