import React from "react";
import ReactDOM from "react-dom";
import { Button, Dialog } from "@blueprintjs/core";
import getUids from "roamjs-components/dom/getUids";
import runExtension from "roamjs-components/util/runExtension";
import { Launch, Workbench } from "~/components/Workbench";
import { COEXISTENCE_WARNING, developerPresent } from "~/lifecycle";
import { host, roamGraph } from "~/roam";
import { QueryService } from "~/service";
import { readSaved, resolveSource, WORKSPACE } from "~/storage";
import { CSS } from "~/styles";

type RuntimeWindow = {
  roamjs?: { loaded?: Set<string> };
  roamjsSparql?: {
    state: string;
    open: (launch?: Partial<Launch>) => Promise<void>;
    close: () => void;
    ready: boolean;
  };
};
export default runExtension(async ({ extensionAPI }) => {
  const api = host();
  const graph = roamGraph();
  const service = new QueryService(graph, api.util.dateToPageTitle);
  const runtime = window as unknown as RuntimeWindow;
  let disposed = false;
  let blocked = developerPresent(runtime.roamjs?.loaded || [])
    ? COEXISTENCE_WARNING
    : "";
  let dialogMount: HTMLDivElement | undefined;
  let workspaceMount: HTMLDivElement | undefined;
  let workspaceLaunch: Launch | undefined;
  let dialogLaunch: Launch | undefined;
  let priorFocus: ReturnType<typeof api.ui.getFocusedBlock>;
  const legacyLabels: string[] = [];
  const menuLabel = "SPARQL: Open query from block";
  const mounts = new Set<HTMLElement>();
  const refreshMounts = new Map<HTMLElement, HTMLElement>();
  const unmount = (mount?: HTMLElement): void => {
    if (mount) {
      ReactDOM.unmountComponentAtNode(mount);
      mount.remove();
      mounts.delete(mount);
    }
  };
  const close = (): void => {
    service.cancel();
    unmount(dialogMount);
    dialogMount = undefined;
    dialogLaunch = undefined;
    if (priorFocus) api.ui.setBlockFocusAndSelection({ location: priorFocus });
  };
  const context = async (overrides: Partial<Launch> = {}): Promise<Launch> => {
    const destination =
      (await api.ui.mainWindow.getOpenPageOrBlockUid()) ||
      api.util.dateToPageUid(new Date());
    const focused = api.ui.getFocusedBlock()?.["block-uid"];
    const pageTitle =
      graph.read(destination)?.title ||
      (api.q(
        "[:find ?title . :in $ ?uid :where [?b :block/uid ?uid] [?b :block/page ?p] [?p :node/title ?title]]",
        destination,
      ) as string | undefined);
    return {
      destination,
      pageTitle,
      blockUid:
        focused || graph.read(destination)?.children[0]?.uid || destination,
      ...overrides,
    };
  };
  const openWorkspace = async (): Promise<void> => {
    const original = await context();
    if (disposed) return;
    close();
    const uid = await graph.ensurePage(WORKSPACE);
    if (disposed) return;
    if (!graph.read(uid)?.children.length)
      await graph.create({
        uid: graph.uid(),
        parentUid: uid,
        text: "SPARQL workspace · Enable the SPARQL extension to open its query library and native editor. Saved queries remain ordinary blocks on [[roam/js/sparql]].",
      });
    workspaceLaunch = original;
    await api.ui.mainWindow.openPage({ page: { uid } });
    await syncWorkspace();
  };
  const renderDialog = (): void => {
    if (!dialogMount || !dialogLaunch) return;
    ReactDOM.render(
      <Dialog
        isOpen
        title="SPARQL Import"
        className="sparql-dialog"
        onClose={close}
        canEscapeKeyClose
        canOutsideClickClose={false}
        autoFocus
        enforceFocus={false}
      >
        <Workbench
          graph={graph}
          service={service}
          launch={dialogLaunch}
          onWorkspace={() => void openWorkspace()}
          blocked={blocked}
        />
        <div className="sparql-footer">
          Close <kbd>Esc</kbd>
        </div>
      </Dialog>,
      dialogMount,
    );
  };
  const open = async (overrides: Partial<Launch> = {}): Promise<void> => {
    if (disposed) return;
    priorFocus = api.ui.getFocusedBlock();
    close();
    // One authoring surface owns the controller at a time.
    unmount(workspaceMount);
    workspaceMount = undefined;
    dialogLaunch = await context(overrides);
    if (disposed) return;
    dialogMount = document.createElement("div");
    mounts.add(dialogMount);
    document.body.appendChild(dialogMount);
    renderDialog();
  };
  const openFocused = async (uid?: string): Promise<void> => {
    const launch = await context(uid ? { blockUid: uid } : {});
    try {
      const source = resolveSource({ graph, uid: launch.blockUid });
      await open({ ...launch, mode: "Custom Query", sourceUid: source.uid });
    } catch (error) {
      await open({
        ...launch,
        mode: "Custom Query",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const custom = async (): Promise<void> => {
    const launch = await context();
    let sourceUid: string | undefined;
    try {
      sourceUid = resolveSource({ graph, uid: launch.blockUid }).uid;
    } catch {
      /* The legacy command falls back to the page's most recently edited source. */
    }
    if (!sourceUid) {
      const page = graph.read(launch.destination);
      const sources: { uid: string; edited: number }[] = [];
      const walk = (
        nodes: typeof page extends undefined
          ? never
          : NonNullable<typeof page>["children"],
      ): void =>
        nodes.forEach((node) => {
          if (/```sparql/i.test(node.text))
            sources.push({ uid: node.uid, edited: node.edited || 0 });
          walk(node.children);
        });
      if (page) walk(page.children);
      sourceUid = sources.sort((a, b) => b.edited - a.edited)[0]?.uid;
    }
    await open({ ...launch, mode: "Custom Query", sourceUid });
  };
  const removeLegacy = (): void => {
    legacyLabels
      .splice(0)
      .forEach((label) =>
        extensionAPI.ui.commandPalette.removeCommand({ label }),
      );
    api.ui.blockContextMenu.removeCommand({ label: menuLabel });
    api.ui.blockRefContextMenu?.removeCommand({ label: menuLabel });
  };
  const detectDeveloper = (): void => {
    if (disposed || blocked || !developerPresent(runtime.roamjs?.loaded || []))
      return;
    blocked = COEXISTENCE_WARNING;
    service.cancel();
    removeLegacy();
    refreshMounts.forEach(unmount);
    refreshMounts.clear();
    if (runtime.roamjsSparql) runtime.roamjsSparql.state = "standby";
    renderDialog();
    if (workspaceMount && workspaceLaunch)
      ReactDOM.render(
        <Workbench
          graph={graph}
          service={service}
          launch={workspaceLaunch}
          wide
          onWorkspace={() => void openWorkspace()}
          blocked={blocked}
        />,
        workspaceMount,
      );
  };
  const syncRefresh = (): void => {
    refreshMounts.forEach((mount, block) => {
      if (!block.isConnected || !mount.isConnected) {
        unmount(mount);
        refreshMounts.delete(block);
      }
    });
    if (blocked || disposed) return;
    const saved = new Map(
      readSaved(graph).map((record) => [record.rootUid, record]),
    );
    refreshMounts.forEach((mount, block) => {
      if (!saved.has(getUids(block as HTMLDivElement).blockUid)) {
        unmount(mount);
        refreshMounts.delete(block);
      }
    });
    document
      .querySelectorAll<HTMLDivElement>(".roam-block")
      .forEach((block) => {
        const uid = getUids(block).blockUid;
        if (!saved.has(uid) || refreshMounts.has(block)) return;
        const mount = document.createElement("span");
        mount.className = "sparql-refresh-mount";
        block.appendChild(mount);
        mounts.add(mount);
        refreshMounts.set(block, mount);
        ReactDOM.render(
          <Button
            minimal
            small
            icon="refresh"
            title="Preview or refresh saved SPARQL import"
            aria-label="Refresh saved SPARQL import"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void open({ savedRoot: uid });
            }}
          />,
          mount,
        );
      });
  };
  let syncing = false;
  const syncWorkspace = async (): Promise<void> => {
    if (disposed || syncing || dialogMount) return;
    syncing = true;
    try {
      const uid = await api.ui.mainWindow.getOpenPageOrBlockUid();
      if (disposed) return;
      if (graph.read(uid || "")?.title !== WORKSPACE) {
        unmount(workspaceMount);
        workspaceMount = undefined;
        return;
      }
      if (workspaceMount?.isConnected) return;
      unmount(workspaceMount);
      workspaceMount = undefined;
      const title = document.querySelector(".roam-article .rm-title-display");
      const anchor =
        title?.closest(".roam-article") ||
        document.querySelector(".roam-article");
      if (!anchor) return;
      workspaceLaunch ||= await context();
      if (disposed) return;
      workspaceMount = document.createElement("div");
      workspaceMount.className = "sparql-workspace-mount";
      mounts.add(workspaceMount);
      anchor.appendChild(workspaceMount);
      ReactDOM.render(
        <Workbench
          graph={graph}
          service={service}
          launch={workspaceLaunch}
          wide
          onWorkspace={() => void openWorkspace()}
          blocked={blocked}
        />,
        workspaceMount,
      );
    } finally {
      syncing = false;
    }
  };
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  extensionAPI.settings.panel.create({
    tabTitle: "SPARQL",
    settings: [
      {
        id: "workspace",
        name: "Query workspace",
        description:
          "Saved legacy imports are read from roam/js/sparql. Publishing is disabled for this candidate.",
        action: {
          type: "button",
          content: "Open workspace",
          onClick: () => void openWorkspace(),
        },
      },
    ],
  });
  extensionAPI.ui.commandPalette.addCommand({
    label: "SPARQL: Open workspace",
    callback: openWorkspace,
  });
  if (!blocked) {
    [
      { label: "Run SPARQL Query", callback: () => open() },
      { label: "Run SPARQL Query: Custom", callback: custom },
      { label: "SPARQL: Open focused query", callback: () => openFocused() },
      {
        label: "SPARQL: Refresh saved import",
        callback: async () => {
          const launch = await context();
          const record = readSaved(graph).find(
            (saved) => saved.rootUid === launch.blockUid,
          );
          await open(
            record
              ? { ...launch, savedRoot: record.rootUid }
              : {
                  ...launch,
                  error:
                    "Focus a saved import root, or choose its definition in the library.",
                },
          );
        },
      },
    ].forEach((command) => {
      extensionAPI.ui.commandPalette.addCommand(command);
      legacyLabels.push(command.label);
    });
    api.ui.blockContextMenu.addCommand({
      label: menuLabel,
      callback: (ctx) => void openFocused(ctx["block-uid"]),
    });
    api.ui.blockRefContextMenu?.addCommand({
      label: menuLabel,
      callback: (ctx) => void openFocused(ctx["ref-uid"] || ctx["block-uid"]),
    });
  }
  const onLoaded = (): void => detectDeveloper();
  document.body.addEventListener("roamjs:developer:loaded", onLoaded);
  const timer = window.setInterval(() => {
    detectDeveloper();
    syncRefresh();
    void syncWorkspace();
  }, 500);
  runtime.roamjsSparql = {
    state: blocked ? "standby" : "active",
    ready: true,
    open,
    close,
  };
  return {
    unload: (): void => {
      disposed = true;
      service.cancel();
      clearInterval(timer);
      document.body.removeEventListener("roamjs:developer:loaded", onLoaded);
      removeLegacy();
      mounts.forEach(unmount);
      style.remove();
      delete runtime.roamjsSparql;
    },
  };
});
