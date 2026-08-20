import type { Breakdown, BreakdownPart, Check, CheckContext, Finding } from "../types.js";
import { normaliseHeading, parseSections } from "../parse.js";

/**
 * Breakdowns: a whole, its parts, and the order they are presented in.
 *
 * These are the generic form of what the Orbis domain model calls LEAD-01..03
 * — total leads, the UG/PGT split, the most-demanded courses. Nothing here
 * knows that: a breakdown is any set of labelled quantities the artifact is
 * expected to state, so the same three checks cover an invoice's line items or
 * a cohort's age bands in the next app.
 *
 * The failure that motivated them is worth stating plainly, because it is the
 * one a figures check cannot see. A report correctly said five leads were
 * captured and then, in the same paragraph, that no study-level split had been
 * recorded — while the database held three UG and one PGT. Every number it
 * printed was right. What was wrong was a number it *omitted*, and omission is
 * invisible to any check that only inspects what is present.
 */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Separators that can sit between a label and its number: "UG) | 3", "UG: 3". */
const SEP = "[)\\s|:=\\-\u2013\u2014.]*";

/**
 * A number that is not one side of a ratio.
 *
 * "a 3:1 UG:PGT ratio" is the sentence that forced this, written by a report
 * whose figures were all correct: without the guard the "1" binds to "UG" and
 * the report reports itself for recording a single undergraduate.
 */
const NUM = "(?<![\\d:./])(\\d[\\d,]*(?:\\.\\d+)?)(?![:/]\\d)";

type Stated = { value: number; evidence: string; index: number; line: number };

/**
 * Every number the text states against a label, in either arrangement:
 * "| Undergraduate (UG) | 3 |" (table) and "3 UG leads" (prose).
 *
 * Line by line, which is not a detail. Run across the whole text, the "number
 * before the label" arrangement reaches back over the newline and reads a row
 * ending "| 3 |" as the figure for the row *below* it — so a perfectly correct
 * table reports every one of its own values against its neighbour's label.
 *
 * Word boundaries do the other half of the work: "UG" must not be found inside
 * "undergraduate" or "Uganda", or every report would flag itself.
 */
function statedValues(text: string, labels: string[]): Stated[] {
  const out: Stated[] = [];
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    for (const label of labels) {
      if (!label.trim()) continue;
      const l = esc(label.trim());
      const after = new RegExp(`\\b${l}\\b${SEP}${NUM}`, "gi");
      const before = new RegExp(`${NUM}${SEP}\\b${l}\\b`, "gi");
      for (const re of [after, before]) {
        for (const m of line.matchAll(re)) {
          const value = Number((m[1] ?? "").replace(/,/g, ""));
          if (!Number.isFinite(value)) continue;
          out.push({ value, evidence: m[0].trim(), index: offset + (m.index ?? 0), line: offset });
        }
      }
    }
    offset += line.length + 1;
  }

  // One number, one line, one claim. Both arrangements match "7 total leads
  // captured", and an alias overlapping its own label matches again — three
  // findings for a single wrong figure, which reads as three problems.
  const best = new Map<string, Stated>();
  for (const s of out) {
    const key = `${s.line}:${s.value}`;
    const held = best.get(key);
    if (!held || s.evidence.length > held.evidence.length) best.set(key, s);
  }
  return Array.from(best.values());
}

/** Where a label is first mentioned at all, number or not. -1 when absent. */
function firstMention(text: string, labels: string[]): number {
  let best = -1;
  for (const label of labels) {
    if (!label.trim()) continue;
    const m = new RegExp(`\\b${esc(label.trim())}\\b`, "i").exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * The named section *and everything nested under it*.
 *
 * Sections are parsed one heading at a time, so a `##` section's body stops at
 * its first `###` child. Scoping to the body alone would look past exactly the
 * subsections where a per-event breakdown is written.
 */
function scopeOf(artifact: string, section?: string): string {
  if (!section) return artifact;
  const sections = parseSections(artifact);
  const want = normaliseHeading(section).toLowerCase();
  const start = sections.findIndex((s) => s.name.toLowerCase() === want);
  if (start === -1) return artifact; // absence is COV-01's finding, not ours
  const level = sections[start]!.level;
  const parts = [sections[start]!.body];
  for (let i = start + 1; i < sections.length && sections[i]!.level > level; i++) {
    parts.push(sections[i]!.name, sections[i]!.body);
  }
  return parts.join("\n");
}

const labelsOf = (p: BreakdownPart) => [p.label, ...(p.aliases ?? [])];

const eachBreakdown = (ctx: CheckContext, fn: (b: Breakdown, scope: string) => Finding[]): Finding[] =>
  (ctx.facts.breakdowns ?? []).flatMap((b) => fn(b, scopeOf(ctx.artifact, b.section)));

export const breakdownTotal: Check = {
  id: "BRK-01",
  title: "The whole a breakdown states matches the data",
  run: (ctx) =>
    eachBreakdown(ctx, (b, scope) => {
      if (b.total == null || !b.totalLabel) return [];
      const findings: Finding[] = [];
      for (const s of statedValues(scope, [b.totalLabel, ...(b.totalAliases ?? [])])) {
        if (s.value === b.total) continue;
        findings.push({
          checkId: "BRK-01",
          severity: "error",
          summary: `The report states ${s.value} ${b.totalLabel}, but the data has ${b.total}.`,
          detail: `Recomputed from the source records for ${b.label}.`,
          evidence: s.evidence,
        });
      }
      return findings;
    }),
};

export const breakdownParts: Check = {
  id: "BRK-02",
  title: "Each part of a breakdown matches the data",
  run: (ctx) =>
    eachBreakdown(ctx, (b, scope) => {
      const findings: Finding[] = [];
      for (const part of b.parts) {
        const stated = statedValues(scope, labelsOf(part));
        for (const s of stated) {
          if (s.value === part.value) continue;
          findings.push({
            checkId: "BRK-02",
            severity: "error",
            summary: `The report states ${s.value} for ${part.label}, but the data has ${part.value}.`,
            detail: `Part of ${b.label}.`,
            evidence: s.evidence,
          });
        }

        // A part the report never states. Only worth raising when there is
        // something to state: a category with nothing in it is rightly absent,
        // and demanding it would flag every clean report.
        if (stated.length === 0 && part.value > 0 && part.mustAppear !== false) {
          findings.push({
            checkId: "BRK-02",
            severity: "warning",
            summary: `The report never states ${part.label}, though the data has ${part.value}.`,
            detail:
              `Part of ${b.label}. A figure the report omits is invisible to every check that ` +
              `inspects only what is present — this is the one that catches it.`,
          });
        }
      }
      return findings;
    }),
};

export const breakdownOrder: Check = {
  id: "BRK-03",
  title: "A ranked breakdown is presented in the right order",
  run: (ctx) =>
    eachBreakdown(ctx, (b, scope) => {
      if (!b.ranked) return [];
      const placed = b.parts
        .map((p) => ({ part: p, at: firstMention(scope, labelsOf(p)) }))
        .filter((p) => p.at !== -1)
        .sort((a, z) => a.at - z.at);

      const findings: Finding[] = [];
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const earlier = placed[i]!.part;
          const later = placed[j]!.part;
          // Strictly greater only. Equal values have no true order, and
          // flagging an arbitrary choice between them is noise.
          if (later.value <= earlier.value) continue;
          findings.push({
            checkId: "BRK-03",
            severity: "error",
            summary: `The report presents ${earlier.label} (${earlier.value}) ahead of ${later.label} (${later.value}).`,
            detail: `${b.label} is ranked, so the order the report gives reads as a ranking. It is the wrong way round.`,
          });
          break; // one finding per misplaced item is enough to act on
        }
      }
      return findings;
    }),
};
