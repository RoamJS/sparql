import { Graph, Tree } from "../src/types";
export class MemoryGraph implements Graph {
  nodes = new Map<string, Tree>();
  parents = new Map<string, string>();
  refs = new Set<string>();
  writes = 0;
  failAt = Infinity;
  serial = 0;
  beforeWrite?: () => void;
  read = (uid: string): Tree | undefined => {
    const node = this.nodes.get(uid);
    return node ? structuredClone(node) : undefined;
  };
  page = (title: string): Tree | undefined =>
    [...this.nodes.values()].find((node) => node.title === title);
  parent = (uid: string): string | undefined => this.parents.get(uid);
  uid = (): string => `uid${++this.serial}`;
  put = (uid: string, text: string, parentUid?: string): void => {
    const node: Tree = { uid, text, children: [] };
    this.nodes.set(uid, node);
    if (parentUid) {
      this.parents.set(uid, parentUid);
      this.nodes.get(parentUid)!.children.push(node);
    }
  };
  private check = (): void => {
    this.beforeWrite?.();
    if (++this.writes === this.failAt)
      throw new Error("Injected write failure");
  };
  create = async ({
    uid,
    parentUid,
    text,
    order,
  }: {
    uid: string;
    parentUid: string;
    text: string;
    order?: number;
  }): Promise<void> => {
    this.check();
    if (!this.nodes.has(parentUid)) throw new Error("Missing parent");
    this.put(uid, text, parentUid);
    if (order !== undefined) {
      const siblings = this.nodes.get(parentUid)!.children;
      const [created] = siblings.splice(
        siblings.findIndex((node) => node.uid === uid),
        1,
      );
      siblings.splice(order, 0, created);
    }
  };
  update = async ({
    uid,
    text,
  }: {
    uid: string;
    text: string;
  }): Promise<void> => {
    this.check();
    this.nodes.get(uid)!.text = text;
  };
  remove = async (uid: string): Promise<void> => {
    this.check();
    const parentUid = this.parent(uid);
    if (parentUid)
      this.nodes.get(parentUid)!.children = this.nodes
        .get(parentUid)!
        .children.filter((node) => node.uid !== uid);
    this.nodes.delete(uid);
    this.parents.delete(uid);
  };
  ensurePage = async (title: string): Promise<string> => {
    const page = this.page(title);
    if (page) return page.uid;
    this.check();
    const uid = this.uid();
    this.put(uid, title);
    this.nodes.get(uid)!.title = title;
    return uid;
  };
  referenced = (uid: string): boolean => this.refs.has(uid);
}
