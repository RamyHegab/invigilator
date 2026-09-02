import { normaliseName } from "../parse.js";
import type { Check, Finding } from "../types.js";

/**
 * A sub-name attached to a known thing that the record never gave it.
 *
 * LINK-03 in the Orbis domain model, and the check with the clearest real
 * cause: the report prompt required agent-visit titles to read
 * "Agency - Branch", while the branch was never included in the context. Asked
 * for a field the data did not contain, the model invented plausible ones. They
 * are unfalsifiable by reading -- the agency is real, the format is right, and
 * the branch simply does not exist.
 *
 * The engine has no notion of a branch. A qualifier is any sub-name a record
 * permits after a subject, so the same check serves a supplier's depot or a
 * hospital's ward unchanged.
 */

/**
 * Separators a report uses between a name and its sub-name.
 *
 * Em dash, en dash and hyphen, all optionally spaced. A comma is deliberately
 * excluded: "Edvoy, which we met in March" is a sentence, not a qualifier, and
 * treating commas as separators reported prose as invention.
 *
 * Spaces and tabs only, never a line break: `\s` includes newlines, so a name
 * ending a line with a dash bound to the first words of the next line and
 * reported them as its sub-name.
 */
const SEPARATOR = "[ \\t]*[-\u2013\u2014][ \\t]*";

/**
 * How much of what follows the separator to treat as the sub-name.
 *
 * Stops at a line break, a table cell wall, a bracket, or sentence
 * punctuation, and takes at most five words. Without a ceiling, a heading like
 * "Edvoy - a strong first meeting, and we agreed to..." is read as a branch
 * named after the whole clause, which is noise dressed as a finding.
 */
const VALUE = "([^|\\n\\r()\\[\\].;:!?]{1,60})";

const MAX_WORDS = 5;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when the two names are the same thing said at different lengths.
 *
 * A report writing "Cairo" for a branch recorded as "Cairo Office" is correct
 * and must not be reported; so must "IDP - Istanbul" against "Istanbul
 * Office". Containment either way is deliberately generous -- the check exists
 * to catch names that are absent from the record altogether, not to police how
 * fully they are written out.
 */
function matches(named: string, permitted: string): boolean {
  const a = normaliseName(named);
  const b = normaliseName(permitted);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export const qualifiers: Check = {
  id: "QUAL-01",
  title: "Sub-names attached to a thing are ones the record gives it",
  run: ({ facts, artifact }) => {
    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const q of facts.qualifiers ?? []) {
      const subject = q.subject.trim();
      if (!subject) continue;

      const pattern = new RegExp(`${escape(subject)}${SEPARATOR}${VALUE}`, "gi");
      for (const m of artifact.matchAll(pattern)) {
        const named = (m[1] ?? "").trim().replace(/\s+/g, " ");
        if (!named) continue;
        if (named.split(" ").length > MAX_WORDS) continue;

        if (q.permitted.some((p) => matches(named, p))) continue;

        // One finding per invented name, however many times it is repeated:
        // a report naming the same wrong branch in six rows has one fault.
        const key = `${normaliseName(subject)}|${normaliseName(named)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        findings.push({
          checkId: "QUAL-01",
          severity: "error",
          summary: q.permitted.length
            ? `The report gives ${subject} the ${q.kind} "${named}", which is not one the record has for it.`
            : `The report gives ${subject} a ${q.kind}, "${named}", but the record gives it none.`,
          detail: q.permitted.length
            ? `Recorded: ${q.permitted.map((p) => `"${p}"`).join(", ")}.`
            : `Nothing in the data says which ${q.kind} this was, so the name in the report came from somewhere else.`,
          evidence: named,
        });
      }
    }

    return findings;
  },
};
