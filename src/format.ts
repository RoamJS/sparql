import { Cell, Node, OutputFormat, Plan, Result } from "~/types";

const isImage = (s: string): boolean =>
  /^https?:\/\/[^\s]+\.(?:jpg|jpeg|gif|png|svg)(?:[?#].*)?$/i.test(s);
const isUrl = (s: string): boolean => /^(?:https?:\/\/|www\.)[^\s]+$/i.test(s);
const identity = (cell?: Cell): string =>
  cell
    ? `${cell.type}:${cell.value}:${cell.datatype || ""}:${cell["xml:lang"] || ""}`
    : "unbound";
export const labelText = ({
  label,
  format,
  date = new Date(),
}: {
  label: string;
  format: OutputFormat;
  date?: Date;
}): string =>
  `${label.replace("{date}", date.toLocaleString())}${format === "Table" ? " {{[[table]]}}" : ""}`;

export const planOutput = ({
  result,
  format,
  compatibility = false,
  dateTitle,
}: {
  result: Result;
  format: OutputFormat;
  compatibility?: boolean;
  dateTitle: (date: Date) => string;
}): Plan => {
  const vars = result.head.vars.filter((v) => !v.endsWith("Label"));
  const labels = new Set(result.head.vars.filter((v) => v.endsWith("Label")));
  const formatCell = (row: Record<string, Cell>, variable: string): string => {
    const base = row[variable];
    const paired = labels.has(`${variable}Label`);
    const cell = (paired && row[`${variable}Label`]) || base;
    if (!cell) return "";
    const s = cell.value;
    if (isImage(s)) return `![](${s})`;
    if (isUrl(s)) return `[${s}](${s})`;
    if (paired && /entity\/P\d+$/.test(base?.value || "")) return `${s}::`;
    if (/^\d+$/.test(s)) return s;
    const date = new Date(s);
    const typedDate = /#(?:date|dateTime)$/.test(base?.datatype || "");
    if ((compatibility || typedDate) && !Number.isNaN(date.valueOf()))
      return `[[${dateTitle(date)}]]`;
    if (base?.type === "uri") return `[[${s}]]`;
    return s;
  };
  const roots: Node[] = [];
  result.results.bindings.forEach((row) => {
    const cells = vars.map((variable) => ({
      text: formatCell(row, variable),
      key: compatibility
        ? formatCell(row, variable)
        : `${variable}:${identity(row[variable])}`,
    }));
    if (format === "Line") {
      const text = cells.map((cell) => cell.text).join(" ");
      const key = cells.map((cell) => cell.key).join("|");
      if (!roots.some((node) => node.key === key))
        roots.push({ key, text, children: [] });
      return;
    }
    let level = roots;
    let prefix = "";
    cells
      .filter((cell) => cell.text)
      .forEach((cell) => {
        prefix += `/${cell.key}`;
        let node = level.find((candidate) => candidate.key === prefix);
        if (!node) {
          node = { key: prefix, text: cell.text, children: [] };
          level.push(node);
        }
        level = node.children;
      });
  });
  const sort = (nodes: Node[]): Node[] =>
    nodes
      .sort((a, b) => a.text.localeCompare(b.text))
      .map((node) => ({ ...node, children: sort(node.children) }));
  const nodes = sort(roots);
  if (format === "Table" && vars.length)
    nodes.unshift(
      vars
        .slice()
        .reverse()
        .reduce<Node | undefined>(
          (child, variable) => ({
            key: `header:${variable}`,
            text: variable,
            children: child ? [child] : [],
          }),
          undefined,
        )!,
    );
  if (!result.results.bindings.length)
    nodes.push({ key: "empty", text: "No results found", children: [] });
  const identities = new Map<string, { title: string; uri: string }>();
  result.results.bindings.forEach((row) =>
    labels.forEach((variable) => {
      const title = row[variable]?.value;
      const base = row[variable.replace(/Label$/, "")];
      if (title && base?.type === "uri" && !isImage(title))
        identities.set(`${title}\n${base.value}`, { title, uri: base.value });
    }),
  );
  return {
    nodes,
    identities: [...identities.values()],
    rows: result.results.bindings.length,
    warnings: compatibility
      ? [
          "Legacy formatting: grouping by displayed text and broad date recognition are preserved.",
        ]
      : [],
  };
};
