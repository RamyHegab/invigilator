/**
 * Just enough markdown parsing to inspect a report.
 *
 * Deliberately not a markdown library: the checks need headings, tables, links
 * and dates, and a hand-rolled reader for those is easier to reason about than
 * an AST — and it cannot drag a parser's opinions into a compliance finding.
 */

export type Section = {
  /** Heading text with markdown and numbering stripped: "Cost Summary". */
  name: string;
  level: number;
  body: string;
};

const HEADING = /^(#{1,6})\s+(.*)$/;

/** "3. **Cost Summary**" and "Cost Summary" must compare equal. */
export function normaliseHeading(raw: string): string {
  return raw
    .replace(/[*_`]/g, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;
  const body: string[] = [];

  const flush = () => {
    if (current) {
      current.body = body.join("\n").trim();
      sections.push(current);
    }
    body.length = 0;
  };

  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      current = { name: normaliseHeading(m[2] ?? ""), level: (m[1] ?? "").length, body: "" };
    } else if (current) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

export type Table = { columns: string[]; rows: string[][] };

/** Reads GitHub-flavoured pipe tables. Returns every table in the text. */
export function parseTables(markdown: string): Table[] {
  const lines = markdown.split(/\r?\n/);
  const tables: Table[] = [];

  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i] ?? "";
    const divider = lines[i + 1] ?? "";
    const looksLikeTable = header.includes("|") && /^\s*\|?[\s:-]*-[-\s:|]*\|?\s*$/.test(divider);
    if (!looksLikeTable) continue;

    const columns = cells(header).map((c) => c.replace(/[*_`]/g, "").trim());
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && (lines[j] ?? "").includes("|")) {
      rows.push(cells(lines[j] ?? ""));
      j++;
    }
    tables.push({ columns, rows });
    i = j - 1;
  }
  return tables;
}

export type MarkdownLink = { label: string; href: string };

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

export function parseLinks(markdown: string): MarkdownLink[] {
  const out: MarkdownLink[] = [];
  for (const m of markdown.matchAll(LINK)) {
    out.push({ label: (m[1] ?? "").replace(/[*_`]/g, "").trim(), href: (m[2] ?? "").trim() });
  }
  return out;
}

/** ISO dates only. Prose dates are the judgement checks' problem, not this one. */
export function parseIsoDates(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)).map((m) => m[1] ?? "");
}

/**
 * Numbers as a reader would see them: "1,234.50" and "£1234.5" both parse.
 * Years and other bare four-digit integers are excluded — a date is not a figure.
 */
export function parseAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0] ?? "";
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const isBareYear = /^\d{4}$/.test(raw) && value >= 1900 && value <= 2200;
    if (isBareYear) continue;
    out.push(value);
  }
  return out;
}

/** Case- and whitespace-insensitive containment, for label matching. */
export function mentions(haystack: string, needle: string): boolean {
  if (!needle.trim()) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  return norm(haystack).includes(norm(needle));
}
