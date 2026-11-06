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
  const selected = new Set(result.head.vars);
  const labels = new Set(
    result.head.vars.filter(
      (v) => v.endsWith("Label") && selected.has(v.slice(0, -5)),
    ),
  );
  const vars = result.head.vars.filter((v) => !labels.has(v));
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
    const calendarDate =
      /^([+-]?\d{4,})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.0+)?(?:Z|\+00:00)$)/.exec(
        s,
      );
    const date = new Date(s);
    if (calendarDate && !Number.isNaN(date.valueOf())) {
      date.setFullYear(
        Number(calendarDate[1]),
        Number(calendarDate[2]) - 1,
        Number(calendarDate[3]),
      );
      date.setHours(12, 0, 0, 0);
    }
    const typedDate = /#(?:date|dateTime)$/.test(base?.datatype || "");
    if ((compatibility || typedDate) && !Number.isNaN(date.valueOf()))
      return `[[${dateTitle(date)}]]`;
    if (base?.type === "uri") return `[[${s}]]`;
    return s;
  };
  const roots: Node[] = [];
  const grouped = new WeakMap<Node[], Map<string, Node>>();
  const lineKeys = new Set<string>();
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
      if (!lineKeys.has(key)) {
        lineKeys.add(key);
        roots.push({ key, text, children: [] });
      }
      return;
    }
    let level = roots;
    let prefix = "";
    cells
      .filter((cell) => format === "Table" || cell.text)
      .forEach((cell) => {
        prefix += `/${cell.key}`;
        let group = grouped.get(level);
        if (!group) {
          group = new Map();
          grouped.set(level, group);
        }
        let node = group.get(prefix);
        if (!node) {
          node = { key: prefix, text: cell.text, children: [] };
          level.push(node);
          group.set(prefix, node);
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
