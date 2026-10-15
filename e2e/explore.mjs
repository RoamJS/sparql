import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(
  process.env.PLAYWRIGHT_PACKAGE_ROOT
    ? path.join(process.env.PLAYWRIGHT_PACKAGE_ROOT, "package.json")
    : import.meta.url,
);
const { chromium } = require("playwright");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (receipt.status !== "ready") throw new Error("Session is not ready");
const browser = await chromium.connectOverCDP(receipt.cdpUrl);
const context = browser.contexts()[0];
const page = context
  .pages()
  .find((page) => page.url().startsWith(receipt.graphUrl.split("/page/")[0]));
if (!page) throw new Error("Reserved graph page missing");
const out = path.dirname(process.argv[2]);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const action = process.argv[3] || "inspect";
try {
  if (action === "inspect") {
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          url: location.href,
          state: window.roamjsSparql?.state,
          loaded: [...window.roamjs.loaded],
          article: document.querySelector(".roam-article")?.className,
          configExists: !!window.roamAlphaAPI.pull("[:block/uid]", [
            ":node/title",
            "roam/js/sparql",
          ]),
        })),
        null,
        2,
      ),
    );
  }
  if (action === "setup") {
    const fixture = await page.evaluate(async () => {
      const api = window.roamAlphaAPI;
      const uid = api.util.generateUID();
      const sourceUid = api.util.generateUID();
      await api.createPage({
        page: { uid, title: `SPARQL verification ${new Date().toISOString()}` },
      });
      await api.createBlock({
        location: { "parent-uid": uid, order: "last" },
        block: {
          uid: sourceUid,
          string:
            '```sparql\nSELECT ?property ?propertyLabel ?value ?valueLabel WHERE { VALUES (?property ?propertyLabel ?value ?valueLabel) { (wd:P31 "instance of" wd:Q5 "human") } }\n```',
        },
      });
      await api.ui.mainWindow.openPage({ page: { uid } });
      return {
        pageUid: uid,
        sourceUid,
        created: [uid, sourceUid],
        createdAt: new Date().toISOString(),
      };
    });
    fs.writeFileSync(
      path.join(out, "fixture.json"),
      JSON.stringify(fixture, null, 2),
    );
    await page.evaluate(
      async (fixture) =>
        window.roamjsSparql.open({
          destination: fixture.pageUid,
          blockUid: fixture.sourceUid,
          sourceUid: fixture.sourceUid,
          mode: "Custom Query",
        }),
      fixture,
    );
    await page.getByTestId("sparql-workbench").waitFor();
    await page.screenshot({ path: path.join(out, "dialog-initial.png") });
    console.log(
      JSON.stringify(
        {
          fixture,
          dialog: await page.getByTestId("sparql-workbench").innerText(),
          errors,
        },
        null,
        2,
      ),
    );
  }
  if (action === "fixture-import") {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(out, "fixture.json"), "utf8"),
    );
    const payload = {
      head: { vars: ["property", "propertyLabel", "value", "valueLabel"] },
      results: {
        bindings: [
          {
            property: {
              type: "uri",
              value: "http://www.wikidata.org/entity/P31",
            },
            propertyLabel: { type: "literal", value: "instance of" },
            value: { type: "uri", value: "http://www.wikidata.org/entity/Q5" },
            valueLabel: { type: "literal", value: "human" },
          },
        ],
      },
    };
    let requests = 0;
    await page.route("https://query.wikidata.org/**", async (route) => {
      requests++;
      await route.fulfill({
        contentType: "application/sparql-results+json",
        body: JSON.stringify(payload),
      });
    });
    if (!(await page.getByLabel("Library name", { exact: true }).isVisible()))
      await page
        .getByRole("button", { name: "Query settings", exact: true })
        .click();
    if (!(await page.getByLabel("Save query for refresh").isChecked()))
      await page
        .locator("label")
        .filter({ hasText: /^Save query for refresh$/ })
        .click();
    await page
      .getByLabel("Library name", { exact: true })
      .fill("Fixture person details");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Preview ready" })
      .waitFor();
    await page.screenshot({
      path: path.join(out, "dialog-preview-fixture.png"),
    });
    await page
      .getByRole("button", { name: "Import previewed results", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Import complete" })
      .waitFor();
    const persisted = await page.evaluate(
      (fixture) =>
        window.roamAlphaAPI.pull(
          "[:block/uid :block/string {:block/children ...}]",
          [":block/uid", fixture.pageUid],
        ),
      fixture,
    );
    await page.screenshot({
      path: path.join(out, "dialog-imported-fixture.png"),
    });
    fs.writeFileSync(
      path.join(out, "fixture-import.json"),
      JSON.stringify(
        {
          requests,
          persisted,
          errors,
          network:
            "Deterministic Playwright fixture at Wikidata endpoint; real Roam graph writes",
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ requests, persisted, errors }, null, 2));
  }
} finally {
  await browser.close();
}
