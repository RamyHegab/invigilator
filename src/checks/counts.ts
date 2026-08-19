import type { Check, Finding } from "../types.js";

/**
 * Numbers the report states about itself.
 *
 * A model that faithfully copies every figure it is given can still miscount in
 * prose: a real report opened with "Eight sectors of air travel" on a trip with
 * six travel legs, while its own overview table said six. Nothing else catches
 * that — the number was never in the source data to compare against, it was
 * asserted by the writer.
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
    const lines = artifact.split(String.fromCharCode(10)).map((l) => l.replace(String.fromCharCode(13), ""));

    for (const count of facts.counts) {
      const phrases = [count.label, ...(count.aliases ?? [])]
        .map((p) => tokenise(p))
        .filter((p) => p.length > 0);

      for (const phrase of phrases) {
        for (const line of lines) {
        const tokens = tokenise(line);
        for (let i = 0; i <= tokens.length - phrase.length; i++) {
          if (!phrase.every((word, k) => tokens[i + k] === word)) continue;

          // Walk back over at most a few filler words for a number.
          for (let back = 1; back <= LOOKBACK && i - back >= 0; back++) {
            const stated = numberFrom(tokens[i - back]!);
            if (stated === null) continue;
            if (stated !== count.value) {
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
        }
        }
      }
    }
    return findings;
  },
};
