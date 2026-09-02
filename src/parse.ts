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

/**
 * A free-typed name reduced to what makes it that name.
 *
 * Case, surrounding space, punctuation, accents and a leading "the" are how
 * people type, not what they mean: "The Gambia", "the gambia" and "Gambia" are
 * one country. Anything past that is a real difference and is left alone --
 * "UAE" and "United Arab Emirates" do not compare equal here, on purpose.
 * Smoothing those together needs a synonym list, and a wrong synonym list
 * hides real gaps in silence.
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // so "Cote" matches the accented spelling
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
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

/**
 * Case-, whitespace- and punctuation-insensitive containment.
 *
 * Punctuation matters here in a way it does not look like it should. A record
 * titled "Global Study UK - Cairo" is written up by a report as "Global Study
 * UK — Cairo", because a writer reaches for an em dash. Comparing the two
 * literally says the report never mentions the event, which is both false and
 * the most confusing kind of false: the name is right there on the page.
 *
 * So dashes, slashes, commas and the rest collapse to a single space on both
 * sides before comparing. Two names that differ only in punctuation are the
 * same name.
 */
export function mentions(haystack: string, needle: string): boolean {
  if (!needle.trim()) return false;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[‐-―\-_/\\,.;:()[\]{}'"“”‘’]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return norm(haystack).includes(norm(needle));
}

/**
 * The named section *and everything nested under it*.
 *
 * Sections are parsed one heading at a time, so a `##` section's body stops at
 * its first `###` child. Scoping to the body alone would look past exactly the
 * subsections where per-item detail is written.
 *
 * A section that is not there returns the whole artifact rather than nothing.
 * Its absence is COV-01's finding to report; a scoped check that silently saw
 * an empty string would report every item in it as missing too, turning one
 * fault into twenty.
 */
export function sectionScope(artifact: string, section?: string): string {
  if (!section) return artifact;
  const sections = parseSections(artifact);
  const want = normaliseHeading(section).toLowerCase();
  const start = sections.findIndex((s) => s.name.toLowerCase() === want);
  if (start === -1) return artifact;
  const level = sections[start]!.level;
  const parts = [sections[start]!.body];
  for (let i = start + 1; i < sections.length && sections[i]!.level > level; i++) {
    parts.push(sections[i]!.name, sections[i]!.body);
  }
  return parts.join("\n");
}
