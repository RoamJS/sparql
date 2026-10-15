import { strict as assert } from "node:assert";
import { test, after } from "node:test";
import { createRequire } from "node:module";
import { MemoryGraph } from "./helpers";
import { QueryService } from "../src/service";
import { readSaved, saveRecord } from "../src/storage";
import { codeFromBlock } from "../src/query";
import type { Query } from "../src/types";

const require = createRequire(`${process.cwd()}/package.json`);
const { JSDOM } = require("jsdom");
const originalMessageChannel = globalThis.MessageChannel;
delete (globalThis as unknown as { MessageChannel?: unknown }).MessageChannel;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://roam.test/",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis)) {
    try {
      Object.defineProperty(globalThis, key, {
        value: dom.window[key],
        writable: true,
        configurable: true,
      });
    } catch {
      /* Read-only host globals are not needed by these UI regressions. */
    }
  }
}
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame = (
  callback,
): number => setTimeout(callback, 0) as unknown as number;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame =
  clearTimeout;
const React = require("react");
const {
  render,
  fireEvent,
  act,
  waitFor,
  cleanup,
} = require("@testing-library/react");
const { Workbench } = require("./src/components/Workbench.tsx");
dom.window.roamAlphaAPI = {
  graph: { name: "workbench-regression" },
  ui: {
    components: {
      renderBlock: async (): Promise<void> => {},
      unmountNode: async (): Promise<void> => {},
    },
    mainWindow: { openBlock: async (): Promise<void> => {} },
  },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (): Promise<Response> =>
  Response.json({
    head: { vars: ["x"] },
    results: { bindings: [{ x: { type: "literal", value: "Result" } }] },
  });
const query: Query = {
  query: "SELECT ?x {}",
  source: "https://example.test/?query=",
  endpointMode: "prefix",
  outputFormat: "Parent",
};
const seed = async (): Promise<MemoryGraph> => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  graph.put("root", "Saved", "page");
  await saveRecord({ graph, rootUid: "root", query });
  return graph;
};
const launch = { destination: "page", blockUid: "root", savedRoot: "root" };
const mount = (
  graph: MemoryGraph,
  currentLaunch:
    | typeof launch
    | {
        destination: string;
        blockUid: string;
        sourceUid?: string;
        mode?: string;
      },
  service = new QueryService(graph, () => ""),
): ReturnType<typeof render> =>
  render(
    React.createElement(Workbench, {
      graph,
      service,
      launch: currentLaunch,
      onWorkspace: (): void => {},
    }),
  );
after((): void => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  dom.window.close();
});

test("Save definition can immediately refresh with its new format", async () => {
  const graph = await seed();
  const ui = mount(graph, launch);
  try {
    fireEvent.click(
      ui.getByRole("button", { name: "Query settings", exact: true }),
    );
    fireEvent.change(ui.getByLabelText("Output format", { exact: true }), {
      target: { value: "Table" },
    });
    await act(
      async (): Promise<void> =>
        fireEvent.click(
          ui.getByRole("button", { name: "Save definition", exact: true }),
        ),
    );
    assert.equal(readSaved(graph)[0].outputFormat, "Table");
    await act(
      async (): Promise<void> =>
        fireEvent.click(
          ui.getByRole("button", { name: "Refresh saved import", exact: true }),
        ),
    );
    assert.match(
      ui.getByRole("status").textContent || "",
      /Legacy import preserved/,
    );
    assert.doesNotMatch(
      ui.getByRole("status").textContent || "",
      /draft differs/,
    );
  } finally {
    cleanup();
    localStorage.clear();
  }
});

for (const fromLibrary of [false, true])
  test(`Save a copy preserves an unlinked legacy SELECT (${fromLibrary ? "library" : "saved-root"} launch)`, async () => {
    const graph = await seed();
    graph.put("custom", "customQuery", graph.page("roam/js/sparql")!.uid);
    graph.put("unrelated", "```sparql\nSELECT ?wrong {}\n```", "custom");
    const ui = mount(
      graph,
      fromLibrary ? { destination: "page", blockUid: "root" } : launch,
    );
    try {
      if (fromLibrary) {
        fireEvent.click(
          ui.getByRole("button", { name: "Saved queries", exact: true }),
        );
        fireEvent.click(ui.getByRole("button", { name: "Saved", exact: true }));
      }
      fireEvent.click(
        ui.getByRole("button", { name: "Query settings", exact: true }),
      );
      await act(
        async (): Promise<void> =>
          fireEvent.click(
            ui.getByRole("button", { name: "Save a copy", exact: true }),
          ),
      );
      const sourceUid = ui.getByLabelText("Source block UID", {
        exact: true,
      }).value;
      assert.ok(sourceUid);
      assert.notEqual(sourceUid, "unrelated");
      assert.equal(
        codeFromBlock(graph.read(sourceUid)?.text || ""),
        query.query,
      );
      await act(
        async (): Promise<void> =>
          fireEvent.click(
            ui.getByRole("button", { name: "Preview", exact: true }),
          ),
      );
      assert.match(ui.getByRole("status").textContent || "", /Preview ready/);
      assert.equal(readSaved(graph).length, 1);
    } finally {
      cleanup();
      localStorage.clear();
    }
  });

test("closing during an awaited write persists its partial recovery journal", async () => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  graph.put("source", "```sparql\nSELECT ?x {}\n```", "page");
  const create = graph.create;
  let release: (() => void) | undefined;
  let started = false;
  graph.create = async (args): Promise<void> => {
    if (args.parentUid === "page") {
      started = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await create(args);
  };
  const ui = mount(graph, {
    destination: "page",
    blockUid: "source",
    sourceUid: "source",
    mode: "Custom Query",
  });
  try {
    fireEvent.click(ui.getByRole("button", { name: "Import", exact: true }));
    await waitFor((): void => assert.ok(started));
    ui.unmount();
    release!();
    const key = "roamjs:sparql:v1:workbench-regression:journal";
    await waitFor((): void => assert.ok(localStorage.getItem(key)));
    const journal = JSON.parse(localStorage.getItem(key)!);
    assert.equal(journal.status, "partial");
    assert.equal(journal.changes.length, 1);
    assert.equal(graph.writes, 1);
    const reopened = mount(graph, {
      destination: "page",
      blockUid: "source",
      sourceUid: "source",
      mode: "Custom Query",
    });
    assert.ok(
      reopened.getByText(/Operation journal · partial · 1 output writes/),
    );
  } finally {
    cleanup();
    localStorage.clear();
  }
});

test("successful import clears an obsolete persisted partial recovery journal", async () => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  graph.put("source", "```sparql\nSELECT ?x {}\n```", "page");
  const key = "roamjs:sparql:v1:workbench-regression:journal";
  localStorage.setItem(
    key,
    JSON.stringify({ status: "partial", changes: [], owned: [], retained: [] }),
  );
  const currentLaunch = {
    destination: "page",
    blockUid: "source",
    sourceUid: "source",
    mode: "Custom Query",
  };
  const ui = mount(graph, currentLaunch);
  try {
    await act(
      async (): Promise<void> =>
        fireEvent.click(
          ui.getByRole("button", { name: "Import", exact: true }),
        ),
    );
    await waitFor((): void =>
      assert.match(ui.getByRole("status").textContent || "", /Import complete/),
    );
    assert.equal(localStorage.getItem(key), null);
    ui.unmount();
    const reopened = mount(graph, currentLaunch);
    assert.equal(reopened.queryByText(/Operation journal · partial/), null);
  } finally {
    cleanup();
    localStorage.clear();
  }
});

test("switching native source unmounts the captured old host root and mounts a fresh anchor", async () => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  graph.put("one", "```sparql\nSELECT ?one {}\n```", "page");
  graph.put("two", "```sparql\nSELECT ?two {}\n```", "page");
  const components = dom.window.roamAlphaAPI.ui.components;
  const previous = { ...components };
  const ReactDOM = require("react-dom");
  const unmounted: HTMLElement[] = [];
  components.renderBlock = async ({
    uid,
    el,
  }: {
    uid: string;
    el: HTMLElement;
  }): Promise<void> => {
    ReactDOM.render(React.createElement("span", null, uid), el);
  };
  components.unmountNode = async ({
    el,
  }: {
    el: HTMLElement;
  }): Promise<void> => {
    unmounted.push(el);
    ReactDOM.unmountComponentAtNode(el);
  };
  const ui = mount(graph, {
    destination: "page",
    blockUid: "one",
    sourceUid: "one",
    mode: "Custom Query",
  });
  try {
    const first = ui.getByLabelText("Native SPARQL source editor");
    assert.equal(first.textContent, "one");
    fireEvent.change(ui.getByLabelText("Source block UID", { exact: true }), {
      target: { value: "two" },
    });
    await waitFor((): void =>
      assert.equal(
        ui.getByLabelText("Native SPARQL source editor").textContent,
        "two",
      ),
    );
    assert.notEqual(ui.getByLabelText("Native SPARQL source editor"), first);
    assert.ok(unmounted.includes(first));
    assert.equal(first.textContent, "");
  } finally {
    cleanup();
    Object.assign(components, previous);
    localStorage.clear();
  }
});

test("own refresh timestamps do not look like an external saved-definition edit", async () => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  const update = graph.update;
  graph.update = async (args): Promise<void> => {
    await update(args);
    graph.nodes.get(args.uid)!.edited = graph.writes;
  };
  const service = new QueryService(graph, () => "Date");
  const first = await service.import({
    preview: await service.preview({
      query,
      destination: "page",
      signature: "timestamp",
      label: "Saved",
      name: "Saved",
      save: true,
    }),
    currentSignature: "timestamp",
  });
  const saved = readSaved(graph)[0];
  const before = JSON.stringify(graph.read(saved.recordUid));
  const ui = mount(
    graph,
    {
      destination: first.rootUid,
      blockUid: first.rootUid,
      savedRoot: first.rootUid,
    },
    service,
  );
  try {
    await act(
      async (): Promise<void> =>
        fireEvent.click(
          ui.getByRole("button", { name: "Refresh saved import", exact: true }),
        ),
    );
    assert.match(ui.getByRole("status").textContent || "", /Import complete/);
    assert.notEqual(JSON.stringify(graph.read(saved.recordUid)), before);
    fireEvent.click(
      ui.getByRole("button", { name: "Query settings", exact: true }),
    );
    fireEvent.change(ui.getByLabelText("Output format", { exact: true }), {
      target: { value: "Table" },
    });
    await act(
      async (): Promise<void> =>
        fireEvent.click(
          ui.getByRole("button", { name: "Save definition", exact: true }),
        ),
    );
    assert.match(ui.getByRole("status").textContent || "", /Definition saved/);
    assert.equal(readSaved(graph)[0].outputFormat, "Table");
  } finally {
    cleanup();
    localStorage.clear();
  }
});
