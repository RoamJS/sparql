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
  let workbenchMount: HTMLDivElement | undefined;
  let workbenchLaunch: Launch | undefined;
  let surface: "dialog" | "workspace" | "sidebar" | undefined;
  let workspaceUid: string | undefined;
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
  const closeDialogShell = (): void => {
    workbenchMount?.remove();
    unmount(dialogMount);
    dialogMount = undefined;
  };
  const close = (): void => {
    service.cancel();
    unmount(workbenchMount);
    workbenchMount = undefined;
    workbenchLaunch = undefined;
    surface = undefined;
    closeDialogShell();
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
  const renderWorkbench = (): void => {
    if (!workbenchMount || !workbenchLaunch) return;
    ReactDOM.render(
      <Workbench
        graph={graph}
        service={service}
        launch={workbenchLaunch}
        wide={surface === "workspace"}
        inSidebar={surface === "sidebar"}
        onWorkspace={() => void openWorkspace(true)}
        onSidebar={() => openSidebar(true)}
        blocked={blocked}
      />,
      workbenchMount,
    );
  };
  const attachWorkbench = (anchor: HTMLElement): void => {
    if (!workbenchMount) {
      workbenchMount = document.createElement("div");
      mounts.add(workbenchMount);
    }
    const className =
      surface === "sidebar"
        ? "sparql-sidebar-mount"
        : surface === "workspace"
          ? "sparql-workspace-mount"
          : "";
    if (
      workbenchMount.parentElement === anchor &&
      workbenchMount.className === className
    )
      return;
    workbenchMount.className = className;
    anchor.appendChild(workbenchMount);
    renderWorkbench();
  };
  const ensureWorkspace = async (): Promise<string> => {
    const uid = await graph.ensurePage(WORKSPACE);
    if (!graph.read(uid)?.children.length)
      await graph.create({
        uid: graph.uid(),
        parentUid: uid,
        text: "SPARQL workspace · Enable the SPARQL extension to open its query library and native editor. Saved queries remain ordinary blocks on [[roam/js/sparql]].",
      });
    workspaceUid = uid;
    return uid;
  };
  const openWorkspace = async (preserve = false): Promise<void> => {
    const original =
      preserve && workbenchLaunch ? workbenchLaunch : await context();
    const uid = await ensureWorkspace();
    if (disposed) return;
    if (preserve) closeDialogShell();
    else close();
    workbenchLaunch = original;
    surface = "workspace";
    await api.ui.mainWindow.openPage({ page: { uid } });
    await syncWorkspace();
  };
  const openSidebar = async (preserve = false): Promise<void> => {
    const original =
      preserve && workbenchLaunch ? workbenchLaunch : await context();
    try {
      const uid = await ensureWorkspace();
      if (disposed) return;
      await api.ui.rightSidebar.open();
      await api.ui.rightSidebar.addWindow({
        window: { type: "outline", "block-uid": uid },
      });
      await api.ui.rightSidebar.expandWindow({
        window: { type: "outline", "block-uid": uid },
      });
      if (disposed) return;
      if (preserve) closeDialogShell();
      else close();
      workbenchLaunch = original;
      surface = "sidebar";
      await syncWorkspace();
    } catch (error) {
      throw new Error(
        `SPARQL sidebar could not open: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const renderDialog = (): void => {
    if (!dialogMount || !workbenchLaunch) return;
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
        <div
          ref={(anchor) => {
            if (anchor) attachWorkbench(anchor);
          }}
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
    workbenchLaunch = await context(overrides);
    if (disposed) return;
    surface = "dialog";
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
    renderWorkbench();
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
    if (disposed || syncing || surface === "dialog") return;
    syncing = true;
    try {
      if (surface === "sidebar") {
        const window = api.ui.rightSidebar
          .getWindows()
          .find(
            (window) =>
              window.type === "outline" && window["page-uid"] === workspaceUid,
          );
        if (!window) {
          close();
          return;
        }
        const sidebarWindow = document.getElementById(
          `sidebar-window-${window["window-id"]}`,
        );
        const anchor = sidebarWindow?.querySelector<HTMLElement>(
          ".rm-sidebar-outline-wrapper",
        );
        if (anchor && !window["collapsed?"]) attachWorkbench(anchor);
        return;
      }
      const uid = await api.ui.mainWindow.getOpenPageOrBlockUid();
      if (disposed) return;
      if (graph.read(uid || "")?.title !== WORKSPACE) {
        if (surface === "workspace") close();
        return;
      }
      if (workbenchMount?.isConnected) return;
      const title = document.querySelector(".roam-article .rm-title-display");
      const anchor =
        title?.closest<HTMLElement>(".roam-article") ||
        document.querySelector<HTMLElement>(".roam-article");
      if (!anchor) return;
      workbenchLaunch ||= await context();
      if (disposed) return;
      surface = "workspace";
      attachWorkbench(anchor);
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
    callback: () => openWorkspace(),
  });
  extensionAPI.ui.commandPalette.addCommand({
    label: "SPARQL: Open in sidebar",
    callback: () => openSidebar(),
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
      extensionAPI.ui.commandPalette.removeCommand({
        label: "SPARQL: Open workspace",
      });
      extensionAPI.ui.commandPalette.removeCommand({
        label: "SPARQL: Open in sidebar",
      });
      mounts.forEach(unmount);
      style.remove();
      delete runtime.roamjsSparql;
    },
  };
});
