import { mentions, sectionScope } from "../parse.js";
import type { Check, Finding } from "../types.js";

/**
 * A multi-day thing collapsed to one day.
 *
 * DATE-03 in the Orbis domain model. The itinerary table a report renders is
 * spliced in from the data, never written by the model, so it is always
 * right. The risk is in the prose around it: a fair that ran 15-17 October
 * is a perfectly natural thing to describe as "a productive visit on
 * 15 October", and nothing about that sentence looks wrong -- it just quietly
 * drops two of the three days.
 *
 * A warning, not an error, for the same reason COV-06/07 are: this only knows
 * how to look for specific date strings, and a report can correctly convey a
 * span without ever repeating the end date literally -- "over three days
 * from 15 October" is honest and would still be flagged. Silence would miss
 * the mistake this exists to catch; a wrong severity would make a correct
 * report look broken. Warning is the smaller cost.
 */

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "2026-10-17" -> every plausible way a person or a model writes that date. */
function dateVariants(iso: string): string[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [iso];
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const day = String(Number(d));
  const monthNum = Number(mo);
  const monthName = MONTHS[monthNum - 1];
  if (!monthName) return [iso];
  const short = monthName.slice(0, 3);

  return [
    iso, // 2026-10-17
    `${d}/${mo}/${y}`, // 17/10/2026 (UK day-first)
    `${d}-${mo}-${y}`, // 17-10-2026
    `${day} ${monthName} ${y}`, // 17 October 2026
    `${day} ${short} ${y}`, // 17 Oct 2026
    `${day} ${monthName}`, // 17 October
    `${day} ${short}`, // 17 Oct
    `${monthName} ${day}, ${y}`, // October 17, 2026
    `${monthName} ${day}`, // October 17
  ];
}

/**
 * Whether any spelling of `iso` appears in `text`.
 *
 * Ordinal suffixes ("17th") are stripped from the text first rather than
 * added to every candidate -- a report is free to write "17th" or "17", and
 * generating both forms of nine candidates each was worse than normalising
 * the one side that varies.
 */
function mentionsDate(text: string, iso: string): boolean {
  const stripped = text.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  return dateVariants(iso).some((v) => mentions(stripped, v));
}

export const dateSpanKept: Check = {
  id: "DATE-03",
  title: "A multi-day span is not collapsed to one day",
  run: ({ facts, artifact }) => {
    const findings: Finding[] = [];
    for (const span of facts.dateSpans ?? []) {
      if (!span.start || !span.end || span.start >= span.end) continue;
      if (!span.subject.trim()) continue;

      const scope = sectionScope(artifact, span.section);
      if (!mentions(scope, span.subject)) continue; // COV-01's finding, not this one

      const hasStart = mentionsDate(scope, span.start);
      const hasEnd = mentionsDate(scope, span.end);
      if (hasStart && !hasEnd) {
        findings.push({
          checkId: "DATE-03",
          severity: "warning",
          summary: `The ${span.kind} "${span.subject}" ran from ${span.start} to ${span.end}, but the report only gives its first day.`,
          detail:
            "A date range collapsed to its start reads as a shorter, single-day thing than what actually happened. This may be a correct report that names the span another way -- \"over three days\" -- which this check cannot read.",
          evidence: span.start,
        });
      }
    }
    return findings;
  },
};
