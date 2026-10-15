export type OutputFormat = "Parent" | "Line" | "Table";
export type EndpointMode = "prefix" | "standard";
export type Cell = {
  type: "uri" | "literal" | "typed-literal" | "bnode";
  value: string;
  datatype?: string;
  "xml:lang"?: string;
};
export type Result = {
  head: { vars: string[] };
  results: { bindings: Record<string, Cell>[] };
};
export type Tree = {
  uid: string;
  text: string;
  children: Tree[];
  title?: string;
  order?: number;
  edited?: number;
};
export type Node = { key: string; text: string; children: Node[] };
export type Identity = { title: string; uri: string };
export type Plan = {
  nodes: Node[];
  identities: Identity[];
  destinationLinks?: string[];
  rows: number;
  warnings: string[];
};
export type Query = {
  query: string;
  source: string;
  outputFormat: OutputFormat;
  endpointMode: EndpointMode;
  sourceUid?: string;
  compatibility?: boolean;
};
export type Saved = Query & {
  recordUid: string;
  rootUid: string;
  name: string;
  error?: string;
};
export type Owned = {
  uid: string;
  parentUid: string;
  key: string;
  text: string;
};
export type ImportMeta = {
  version: 1;
  rootUid: string;
  name: string;
  sourceUid?: string;
  endpointMode: EndpointMode;
  compatibility: boolean;
  ownershipVerified?: boolean;
  owned: Owned[];
  label: string;
  renderedLabel?: string;
  lastRun?: string;
};
export type Change = {
  kind: "create" | "update";
  uid: string;
  parentUid: string;
  before?: string;
  after: string;
};
export type Journal = {
  changes: Change[];
  status: "complete" | "partial" | "failed";
  error?: string;
  retained: string[];
  owned: Owned[];
};
export type Graph = {
  read: (uid: string) => Tree | undefined;
  page: (title: string) => Tree | undefined;
  parent: (uid: string) => string | undefined;
  uid: () => string;
  create: (args: {
    uid: string;
    parentUid: string;
    text: string;
  }) => Promise<void>;
  update: (args: { uid: string; text: string }) => Promise<void>;
  remove: (uid: string) => Promise<void>;
  ensurePage: (title: string) => Promise<string>;
  referenced: (uid: string) => boolean;
};
