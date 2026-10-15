import { Graph, Tree } from "~/types";

type Pull = {
  ":block/uid"?: string;
  ":block/string"?: string;
  ":node/title"?: string;
  ":block/order"?: number;
  ":edit/time"?: number;
  ":block/children"?: Pull[];
};
export type Host = {
  pull: (pattern: string, entity: [string, string]) => Pull | null;
  q: (query: string, ...args: unknown[]) => unknown;
  createBlock: (args: {
    location: { "parent-uid": string; order: "last" | number };
    block: { uid: string; string: string };
  }) => Promise<void>;
  updateBlock: (args: {
    block: { uid: string; string: string };
  }) => Promise<void>;
  deleteBlock: (args: { block: { uid: string } }) => Promise<void>;
  createPage: (args: { page: { uid: string; title: string } }) => Promise<void>;
  util: {
    generateUID: () => string;
    dateToPageTitle: (date: Date) => string;
    dateToPageUid: (date: Date) => string;
  };
  graph: { name: string };
  ui: {
    getFocusedBlock: () => { "block-uid": string; "window-id": string } | null;
    setBlockFocusAndSelection: (args: {
      location: { "block-uid": string; "window-id": string };
    }) => void;
    mainWindow: {
      getOpenPageOrBlockUid: () => Promise<string | null>;
      openPage: (args: { page: { uid: string } }) => Promise<void>;
      openBlock: (args: { block: { uid: string } }) => Promise<void>;
    };
    components: {
      unmountNode: (args: { el: HTMLElement }) => Promise<void>;
      renderBlock: (args: {
        uid: string;
        el: HTMLElement;
        "zoom-path?"?: boolean;
      }) => Promise<void>;
    };
    blockContextMenu: {
      addCommand: (args: {
        label: string;
        callback: (context: { "block-uid": string }) => void;
      }) => void;
      removeCommand: (args: { label: string }) => void;
    };
    blockRefContextMenu?: {
      addCommand: (args: {
        label: string;
        callback: (context: {
          "block-uid": string;
          "ref-uid"?: string;
        }) => void;
      }) => void;
      removeCommand: (args: { label: string }) => void;
    };
  };
};
export const host = (): Host =>
  (window as unknown as { roamAlphaAPI: Host }).roamAlphaAPI;
const treeFromPull = (pull: Pull): Tree => ({
  uid: pull[":block/uid"] || "",
  text: pull[":block/string"] || pull[":node/title"] || "",
  title: pull[":node/title"],
  edited: pull[":edit/time"],
  order: pull[":block/order"],
  children: (pull[":block/children"] || [])
    .sort((a, b) => (a[":block/order"] || 0) - (b[":block/order"] || 0))
    .map(treeFromPull),
});
const PATTERN =
  "[:block/uid :block/string :node/title :block/order :edit/time {:block/children ...}]";
export const roamGraph = (): Graph => {
  const api = host();
  const read = (uid: string): Tree | undefined => {
    const pull = api.pull(PATTERN, [":block/uid", uid]);
    return pull ? treeFromPull(pull) : undefined;
  };
  const page = (title: string): Tree | undefined => {
    const pull = api.pull(PATTERN, [":node/title", title]);
    return pull ? treeFromPull(pull) : undefined;
  };
  return {
    read,
    page,
    uid: api.util.generateUID,
    parent: (uid) =>
      api.q(
        "[:find ?u . :in $ ?uid :where [?b :block/uid ?uid] [?p :block/children ?b] [?p :block/uid ?u]]",
        uid,
      ) as string | undefined,
    create: async ({ uid, parentUid, text, order }): Promise<void> => {
      await api.createBlock({
        location: { "parent-uid": parentUid, order: order ?? "last" },
        block: { uid, string: text },
      });
    },
    update: async ({ uid, text }): Promise<void> => {
      await api.updateBlock({ block: { uid, string: text } });
    },
    remove: async (uid): Promise<void> => {
      await api.deleteBlock({ block: { uid } });
    },
    ensurePage: async (title): Promise<string> => {
      const found = page(title);
      if (found) return found.uid;
      const uid = api.util.generateUID();
      await api.createPage({ page: { uid, title } });
      return uid;
    },
    referenced: (uid): boolean =>
      !!api.q(
        "[:find ?b . :in $ ?uid :where [?target :block/uid ?uid] [?b :block/refs ?target]]",
        uid,
      ),
  };
};
