import type { Check, Finding } from "../types.js";
import { sectionScope } from "../parse.js";

/**
 * Numbers the report states about itself.
 *
 * A model that faithfully copies every figure it is given can still miscount in
 * prose: a real report opened with "Eight sectors of air travel" on a trip with
 * six travel legs, while its own overview table said six. Nothing else catches
 * that — the number was never in the source data to compare against, it was
 * asserted by the writer.
 *
 * The same claim is written two ways depending on where it lands. Prose states
 * the number first -- "Eight sectors of air travel". A markdown table states
 * the label first and the number after it in the next cell -- "| Total
 * Activities | 25 |" reads, once punctuation is stripped, as "total activities
 * 25". Both directions are checked, nearest number wins, and a phrase with a
 * number immediately behind it is never also checked forward -- the two
 * shapes do not occur in the same sentence in practice, and checking only one
 * direction was found, when this was wired up for COV-05, to make the check
 * silently useless against the exact table format the report prompt asks for.
 */

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const numberFrom = (token: string): number | null => {
  const word = WORDS[token];
  if (word !== undefined) return word;
  if (!/^[\d,]+$/.test(token)) return null;
  const digits = Number(token.replace(/,/g, ""));
  return Number.isFinite(digits) ? digits : null;
};

/** Words only — punctuation is noise for this comparison. */
const tokenise = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9,]+/)
    .filter(Boolean)
    .map((t) => t.replace(/,$/, ""));

/**
 * Only a number *immediately* before the phrase counts as a claim about the
 * whole: "seven fair days" yes; "four GSUK fair days" and "four consecutive
 * fair days" no, because the qualifier scopes them to a subset. Allowing filler
 * words in between produced exactly those false positives against a correct
 * report, and a check that cries wolf gets ignored.
 */
const LOOKBACK = 1;

export const statedCounts: Check = {
  id: "CNT-01",
  title: "Counts the report states match the data",
  run: ({ facts, artifact }) => {
    const findings: Finding[] = [];
    if (!facts.counts?.length) return findings;

    // Line by line: a table row ending "| 25 |" followed by a row beginning
    // "| Recruitment events |" is not a claim that there were 25 of them.
    for (const count of facts.counts) {
      const lines = sectionScope(artifact, count.section)
        .split(String.fromCharCode(10))
        .map((l) => l.replace(String.fromCharCode(13), ""));
      const phrases = [count.label, ...(count.aliases ?? [])]
        .map((p) => tokenise(p))
        .filter((p) => p.length > 0);

      // One finding per line per count, however many of its aliases match
      // there. "Activities" and its own alias "total activities" both match
      // "| Total Activities | 25 |" -- without this, the one wrong number
      // was reported twice, as though there were two separate mistakes.
      const reportedLines = new Set<number>();

      for (const phrase of phrases) {
        for (let li = 0; li < lines.length; li++) {
        const line = lines[li]!;
        const tokens = tokenise(line);
        for (let i = 0; i <= tokens.length - phrase.length; i++) {
          if (!phrase.every((word, k) => tokens[i + k] === word)) continue;

          // Walk back over at most a few filler words for a number: "Eight
          // sectors of air travel" states the count before naming the thing.
          let matched = false;
          for (let back = 1; back <= LOOKBACK && i - back >= 0; back++) {
            const stated = numberFrom(tokens[i - back]!);
            if (stated === null) continue;
            matched = true;
            if (stated !== count.value && !reportedLines.has(li)) {
              reportedLines.add(li);
              findings.push({
                checkId: "CNT-01",
                severity: "error",
                summary: `The report says ${stated} ${phrase.join(" ")}, but the data has ${count.value}.`,
                detail:
                  "A miscount in prose survives every figure check, because the number was asserted by the writer rather than copied from the source.",
                evidence: tokens.slice(i - back, i + phrase.length).join(" "),
              });
            }
            break; // nearest number wins; do not keep walking back
          }

          // Only tried when nothing was found behind the phrase, so a
          // sentence that happens to have a number on both sides is never
          // reported twice. A markdown table row states the label first and
          // the count after it -- "| Total Activities | 25 |" tokenises to
          // "total activities 25" -- which no report written as prose ever
          // does, so the two directions do not collide in practice.
          for (let fwd = 0; !matched && fwd < LOOKBACK && i + phrase.length + fwd < tokens.length; fwd++) {
            const stated = numberFrom(tokens[i + phrase.length + fwd]!);
            if (stated === null) continue;
            if (stated !== count.value && !reportedLines.has(li)) {
              reportedLines.add(li);
              findings.push({
                checkId: "CNT-01",
                severity: "error",
                summary: `The report says ${stated} ${phrase.join(" ")}, but the data has ${count.value}.`,
                detail:
                  "A miscount in prose survives every figure check, because the number was asserted by the writer rather than copied from the source.",
                evidence: tokens.slice(i, i + phrase.length + fwd + 1).join(" "),
              });
            }
            break;
          }
        }
        }
      }
    }
    return findings;
  },
};
