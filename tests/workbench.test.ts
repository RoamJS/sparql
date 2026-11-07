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

test("moving the complete importer to the sidebar preserves draft, preview and native editor; closing cleans up", async () => {
  const previousHost = dom.window.roamAlphaAPI;
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  graph.nodes.get("page")!.title = "Destination";
  graph.put("source", "```sparql\nSELECT ?x {}\n```", "page");
  let currentUid = "page";
  const commands = new Map<string, () => Promise<void>>();
  const windows: { type: string; "window-id": string; "page-uid": string }[] =
    [];
  let mounts = 0,
    unmounts = 0;
  const article = document.createElement("div");
  article.className = "roam-article";
  document.body.appendChild(article);
  const toPull = (node: ReturnType<MemoryGraph["read"]>): unknown =>
    node && {
      ":block/uid": node.uid,
      ":block/string": node.text,
      ":node/title": node.title,
      ":block/children": node.children.map(toPull),
    };
  dom.window.roamAlphaAPI = {
    graph: { name: "sidebar-regression" },
    pull: (_pattern: string, [attribute, value]: string[]) =>
      toPull(
        attribute === ":node/title" ? graph.page(value) : graph.read(value),
      ),
    q: (_query: string, uid: string) => graph.parent(uid),
    createPage: async ({
      page,
    }: {
      page: { uid: string; title: string };
    }): Promise<void> => {
      graph.put(page.uid, page.title);
      graph.nodes.get(page.uid)!.title = page.title;
    },
    createBlock: async ({
      location,
      block,
    }: {
      location: { "parent-uid": string; order: number };
      block: { uid: string; string: string };
    }): Promise<void> => {
      await graph.create({
        uid: block.uid,
        parentUid: location["parent-uid"],
        text: block.string,
        order: location.order,
      });
    },
    updateBlock: async ({
      block,
    }: {
      block: { uid: string; string: string };
    }): Promise<void> => graph.update({ uid: block.uid, text: block.string }),
    util: {
      generateUID: graph.uid,
      dateToPageTitle: () => "date",
      dateToPageUid: () => "date",
    },
    ui: {
      getFocusedBlock: () => null,
      setBlockFocusAndSelection: () => {},
      mainWindow: {
        getOpenPageOrBlockUid: async () => currentUid,
        openPage: async ({ page }: { page: { uid: string } }) => {
          currentUid = page.uid;
          article.innerHTML = '<h1 class="rm-title-display"></h1>';
        },
        openBlock: async () => {},
      },
      rightSidebar: {
        open: async () => {},
        getWindows: () => windows,
        expandWindow: async () => {},
        addWindow: async ({
          window,
        }: {
          window: { type: string; "block-uid": string };
        }) => {
          if (windows.some((w) => w["page-uid"] === window["block-uid"]))
            return;
          const id = `outline-${window["block-uid"]}`;
          windows.push({
            type: window.type,
            "window-id": id,
            "page-uid": window["block-uid"],
          });
          const anchor = document.createElement("div");
          anchor.id = `sidebar-window-${id}`;
          anchor.innerHTML =
            '<div class="rm-sidebar-outline-wrapper"><div class="rm-sidebar-outline"></div></div>';
          document.body.appendChild(anchor);
        },
      },
      components: {
        renderBlock: async () => {
          mounts++;
        },
        unmountNode: async () => {
          unmounts++;
        },
      },
      blockContextMenu: { addCommand: () => {}, removeCommand: () => {} },
      blockRefContextMenu: { addCommand: () => {}, removeCommand: () => {} },
    },
  };
  dom.window.roamjs = { loaded: new Set() };
  const modulePath = require.resolve("roamjs-components/util/runExtension");
  const priorModule = require.cache[modulePath];
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: { __esModule: true, default: (run: unknown) => run },
  };
  const runExtension = require("./src/extension.tsx").default;
  let runtime: { unload: () => void } | undefined;
  try {
    runtime = await runExtension({
      extensionAPI: {
        settings: { panel: { create: () => {} } },
        ui: {
          commandPalette: {
            addCommand: ({
              label,
              callback,
            }: {
              label: string;
              callback: () => Promise<void>;
            }) => commands.set(label, callback),
            removeCommand: ({ label }: { label: string }) =>
              commands.delete(label),
          },
        },
      },
    });
    await act(async () =>
      dom.window.roamjsSparql.open({
        destination: "page",
        blockUid: "source",
        sourceUid: "source",
        mode: "Custom Query",
      }),
    );
    const { getByRole, getByLabelText } =
      require("@testing-library/react").screen;
    fireEvent.click(
      getByRole("button", { name: "Query settings", exact: true }),
    );
    fireEvent.change(getByLabelText("Import label", { exact: true }), {
      target: { value: "Retained draft" },
    });
    await act(async () =>
      fireEvent.click(getByRole("button", { name: "Preview", exact: true })),
    );
    await waitFor(() =>
      assert.match(getByRole("status").textContent, /Preview ready/),
    );
    const native = document.querySelector(".sparql-native-source");
    await act(async () =>
      fireEvent.click(
        getByRole("button", { name: "Open in sidebar", exact: true }),
      ),
    );
    await waitFor(() =>
      assert.ok(document.querySelector(".sparql-sidebar-mount")),
    );
    assert.equal(
      document.querySelectorAll('[data-testid="sparql-workbench"]').length,
      1,
    );
    assert.equal(
      getByLabelText("Import label", { exact: true }).value,
      "Retained draft",
    );
    assert.match(getByRole("status").textContent, /Preview ready/);
    assert.ok(
      document.querySelector(".sparql-native-source") === native,
      "native editor root identity retained",
    );
    assert.equal(currentUid, "page");
    assert.equal(mounts, 1);
    assert.equal(unmounts, 0);
    await act(async () =>
      fireEvent.click(getByRole("button", { name: "Workspace", exact: true })),
    );
    await waitFor(() =>
      assert.ok(document.querySelector(".sparql-workspace-mount")),
    );
    assert.ok(
      document.querySelector(".sparql-native-source") === native,
      "native editor root identity retained",
    );
    assert.equal(
      getByLabelText("Import label", { exact: true }).value,
      "Retained draft",
    );
    await act(async () =>
      fireEvent.click(
        getByRole("button", { name: "Open in sidebar", exact: true }),
      ),
    );
    await waitFor(() =>
      assert.ok(document.querySelector(".sparql-sidebar-mount")),
    );
    currentUid = "page";
    windows.splice(0);
    await waitFor(
      () =>
        assert.ok(!document.querySelector('[data-testid="sparql-workbench"]')),
      { timeout: 1500 },
    );
    assert.equal(unmounts, 1);
    runtime.unload();
    runtime = undefined;
    assert.equal(commands.size, 0);
  } finally {
    runtime?.unload();
    require.cache[modulePath] = priorModule;
    dom.window.roamAlphaAPI = previousHost;
    document
      .querySelectorAll('[id^="sidebar-window-"]')
      .forEach((el) => el.remove());
    article.remove();
    cleanup();
    localStorage.clear();
  }
});

test("persisted native-source watch marks preview stale and removes only its own callback on close", async () => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  graph.put("source", "```sparql\nSELECT ?x {}\n```", "page");
  const previousHost = dom.window.roamAlphaAPI;
  let callback: (() => void) | undefined;
  const removed: unknown[][] = [];
  dom.window.roamAlphaAPI = {
    ...previousHost,
    data: {
      addPullWatch: async (
        _pattern: string,
        _entity: string,
        changed: () => void,
      ) => {
        callback = changed;
      },
      removePullWatch: async (...args: unknown[]) => {
        removed.push(args);
      },
    },
  };
  const ui = mount(graph, {
    destination: "page",
    blockUid: "source",
    sourceUid: "source",
    mode: "Custom Query",
  });
  try {
    await act(async () =>
      fireEvent.click(ui.getByRole("button", { name: "Preview", exact: true })),
    );
    await waitFor(() =>
      assert.ok(
        ui.getByRole("button", {
          name: "Import previewed results",
          exact: true,
        }),
      ),
    );
    await graph.update({
      uid: "source",
      text: "```sparql\nSELECT ?changed {}\n```",
    });
    await act(async () => callback!());
    assert.match(
      ui.getByLabelText("SPARQL result preview").textContent,
      /Preview is stale/,
    );
    assert.ok(ui.getByRole("button", { name: "Import", exact: true }));
    ui.unmount();
    assert.equal(removed.length, 1);
    assert.equal(removed[0][0], "[:block/string]");
    assert.equal(removed[0][1], '[:block/uid "source"]');
    assert.equal(removed[0][2], callback);
  } finally {
    cleanup();
    localStorage.clear();
    dom.window.roamAlphaAPI = previousHost;
  }
});

test("explicit Preview recaptures a changed destination revision and previewed import does not refetch", async () => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  graph.put("source", "```sparql\nSELECT ?x {}\n```", "page");
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (): Promise<Response> => {
    requests++;
    return Response.json({
      head: { vars: ["x"] },
      results: { bindings: [{ x: { type: "literal", value: "Result" } }] },
    });
  };
  const ui = mount(graph, {
    destination: "page",
    blockUid: "source",
    sourceUid: "source",
    mode: "Custom Query",
  });
  try {
    await act(async () =>
      fireEvent.click(ui.getByRole("button", { name: "Preview", exact: true })),
    );
    graph.put("user-note", "External note added after preview", "page");
    await act(async () =>
      fireEvent.click(
        ui.getByRole("button", {
          name: "Import previewed results",
          exact: true,
        }),
      ),
    );
    assert.match(
      ui.getByRole("status").textContent,
      /Destination changed since preview/,
    );
    assert.equal(requests, 1);
    assert.equal(graph.writes, 0);
    await act(async () =>
      fireEvent.click(ui.getByRole("button", { name: "Preview", exact: true })),
    );
    assert.equal(requests, 2);
    assert.match(ui.getByRole("status").textContent, /Preview ready/);
    await act(async () =>
      fireEvent.click(
        ui.getByRole("button", {
          name: "Import previewed results",
          exact: true,
        }),
      ),
    );
    assert.equal(requests, 2);
    assert.match(ui.getByRole("status").textContent, /Import complete/);
    assert.equal(
      graph.read("user-note")!.text,
      "External note added after preview",
    );
  } finally {
    cleanup();
    localStorage.clear();
    globalThis.fetch = previousFetch;
  }
});

test("recovery disables overlapping UI actions until its graph write finishes", async () => {
  const graph = new MemoryGraph();
  graph.put("page", "Destination");
  graph.put("source", "```sparql\nSELECT ?x {}\n```", "page");
  graph.put("output", "After", "page");
  localStorage.setItem(
    "roamjs:sparql:v1:workbench-regression:journal",
    JSON.stringify({
      status: "partial",
      owned: [],
      retained: [],
      changes: [
        {
          kind: "update",
          uid: "output",
          parentUid: "page",
          before: "Before",
          after: "After",
        },
      ],
    }),
  );
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const update = graph.update;
  graph.update = async (args) => {
    await held;
    await update(args);
  };
  const service = new QueryService(graph, () => "");
  const ui = mount(
    graph,
    {
      destination: "page",
      blockUid: "source",
      sourceUid: "source",
      mode: "Custom Query",
    },
    service,
  );
  try {
    fireEvent.click(ui.getByText(/Operation journal/));
    await act(async () =>
      fireEvent.click(
        ui.getByRole("button", {
          name: "Recover unchanged output writes",
          exact: true,
        }),
      ),
    );
    assert.equal(service.busy(), true);
    assert.equal(
      ui.getByRole("button", {
        name: "Recover unchanged output writes",
        exact: true,
      }).disabled,
      true,
    );
    assert.equal(
      ui.queryByRole("button", { name: "Import", exact: true }),
      null,
    );
    assert.ok(ui.getByRole("button", { name: "Stop", exact: true }));
    await act(async () => release());
    await waitFor(() =>
      assert.match(
        ui.getByRole("status").textContent,
        /Recovered 1 output writes/,
      ),
    );
    assert.equal(service.busy(), false);
    assert.equal(graph.read("output")!.text, "Before");
    assert.ok(ui.getByRole("button", { name: "Import", exact: true }));
  } finally {
    release();
    cleanup();
    localStorage.clear();
  }
});

test("Stop preserves the previous definition and reload lets the user repair it", async () => {
  const graph = await seed();
  const service = new QueryService(graph, () => "");
  const saved = readSaved(graph)[0];
  const record = graph.read(saved.recordUid)!;
  const update = graph.update;
  const changedEndpoint = "https://snapshot.test/?query=";
  let release = (): void => {};
  let started = (): void => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  graph.update = async (args) => {
    if (args.uid === record.children[1].uid && args.text === changedEndpoint) {
      started();
      await hold;
    }
    await update(args);
  };
  const ui = mount(graph, launch, service);
  const button = (name: string): HTMLElement =>
    ui.getByRole("button", { name, exact: true });
  try {
    fireEvent.click(button("Query settings"));
    const endpoint = ui.getByLabelText("SPARQL endpoint", { exact: true });
    const format = ui.getByLabelText("Output format", { exact: true });
    fireEvent.change(endpoint, { target: { value: changedEndpoint } });
    fireEvent.change(format, { target: { value: "Line" } });
    await act(async () => fireEvent.click(button("Save definition")));
    await entered;
    assert.ok(button("Save definition").matches(":disabled"));
    assert.ok(button("Save a copy").matches(":disabled"));
    assert.ok(format.matches(":disabled"));
    await assert.rejects(
      service.copyDefinition({ query, name: "Conflicting" }),
      /already running/,
    );
    fireEvent.click(button("Stop"));
    assert.equal(service.busy(), true);
    await act(async () => release());
    await waitFor(() =>
      assert.match(
        ui.getByRole("status").textContent,
        /Definition save did not finish/,
      ),
    );
    assert.equal(
      graph.read(saved.recordUid)!.children[1].text,
      changedEndpoint,
    );
    assert.equal(graph.read(saved.recordUid)!.children[2].text, "Parent");
    assert.equal(readSaved(graph)[0].source, query.source);
    assert.match(readSaved(graph)[0].error!, /interrupted/);
    fireEvent.click(button("Reload saved definition"));
    assert.equal(endpoint.value, query.source);
    await act(async () => fireEvent.click(button("Refresh saved import")));
    assert.match(
      ui.getByRole("status").textContent,
      /repair the record before refreshing/,
    );
    fireEvent.change(endpoint, { target: { value: changedEndpoint } });
    fireEvent.change(format, { target: { value: "Line" } });
    await act(async () => fireEvent.click(button("Save definition")));
    await waitFor(() =>
      assert.match(ui.getByRole("status").textContent, /Definition saved/),
    );
    assert.equal(readSaved(graph)[0].error, undefined);
    assert.equal(readSaved(graph)[0].source, changedEndpoint);
    assert.equal(readSaved(graph)[0].outputFormat, "Line");
    assert.deepEqual(
      graph.read(saved.recordUid)!.children.map((field) => field.uid),
      record.children.map((field) => field.uid),
    );
  } finally {
    release();
    cleanup();
    localStorage.clear();
  }
});

test("closing an awaited Save a copy stops later writes and leaves the original definition", async () => {
  const graph = await seed();
  const service = new QueryService(graph, () => "");
  const saved = readSaved(graph)[0];
  const create = graph.create;
  let release = (): void => {};
  let started = (): void => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  graph.create = async (args) => {
    if (args.text.startsWith("sparql endpoint::")) {
      started();
      await hold;
    }
    await create(args);
  };
  const ui = mount(graph, launch, service);
  try {
    fireEvent.click(
      ui.getByRole("button", { name: "Query settings", exact: true }),
    );
    await act(async () =>
      fireEvent.click(
        ui.getByRole("button", { name: "Save a copy", exact: true }),
      ),
    );
    await entered;
    const writes = graph.writes;
    ui.unmount();
    assert.equal(service.busy(), true);
    await act(async () => release());
    await waitFor(() => assert.equal(service.busy(), false));
    assert.equal(graph.writes, writes + 1);
    assert.deepEqual(readSaved(graph), [saved]);
    assert.ok(
      [...graph.nodes.values()].some((node) =>
        node.text.startsWith("sparql endpoint::"),
      ),
    );
    assert.ok(
      ![...graph.nodes.values()].some((node) =>
        node.text.startsWith("sparql endpoint mode::"),
      ),
    );
  } finally {
    release();
    cleanup();
    localStorage.clear();
  }
});
