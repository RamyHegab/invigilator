import { mentions } from "../parse.js";
import type { Check, Finding } from "../types.js";

/**
 * No postal address in the report.
 *
 * PII-04 in the Orbis domain model, where it is marked as needing judgement. It
 * does not. The report writer is never given an address -- the app keeps them
 * on branches, schools and agent head offices and none reaches the prompt -- so
 * an address in a report can only be one of two things: something a person
 * typed into a free-text note, or something the writer invented. The first is
 * an exact string the app already holds; the second has a shape. A model asked
 * to read the report for addresses would be slower, cost money, and be
 * wrong sometimes, for a job two cheap rules do without being wrong.
 *
 * Two grades, because they are two kinds of evidence:
 *
 *   error    an address the app holds for a third party, appearing in the report
 *            -- a fact, matched loosely on punctuation and case
 *   warning  something with the shape of one -- a postcode, a PO box, a house
 *            number and a street. A fair held at "1 Sheikh Zayed Road" is a
 *            venue, not a leak, and only a person can tell.
 */

/** A UK postcode, e.g. "L3 5UA" or "SW1A 1AA". Upper case, as they are written. */
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g;

const PO_BOX = /\bP\.?\s?O\.?\s?Box\s+\d+\b/gi;

const STREET_WORD =
  "(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd|Way|Close|Court|Ct|Crescent|Place|Square|Terrace|Gardens|Highway|Hwy)";

/**
 * A house number, up to three capitalised words, then a street word:
 * "12 Baker Street", "221B Baker Street", "14-16 Rue Hassan Road".
 *
 * The capitalisation is what keeps "3 days on the road" and "12 new leads by
 * the Way" from matching -- a street name is a proper noun.
 */
/**
 * A month name straight after the number makes it a date, not a house number:
 * "20 Sep Way ahead of schedule". The cost is a street named for a month --
 * Cairo has a "26 July Street" -- which this will not see. That is the right
 * trade for a warning-grade check: a held address is still caught exactly, and
 * a date is written in every report.
 */
const NOT_A_MONTH =
  "(?!(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\\b)";

const HOUSE_AND_STREET = new RegExp(
  `\\b\\d{1,4}[A-Za-z]?(?:[-–]\\d{1,4})?,?\\s+${NOT_A_MONTH}(?:[\\p{Lu}][\\p{L}'’.-]*\\s+){0,3}[\\p{Lu}][\\p{L}'’.-]*\\s+${STREET_WORD}\\b\\.?`,
  "gu",
);

/** A held address shorter than this is a word, not an address. */
const MIN_HELD_ADDRESS = 12;

export const postalAddress: Check = {
  id: "PII-04",
  title: "No postal address",
  run: ({ facts, artifact }) => {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    const add = (f: Finding) => {
      const key = `${f.severity}|${(f.evidence ?? "").toLowerCase().replace(/\W+/g, " ").trim()}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(f);
    };

    for (const address of facts.addresses ?? []) {
      if (address.trim().length < MIN_HELD_ADDRESS) continue;
      if (!mentions(artifact, address)) continue;
      add({
        checkId: "PII-04",
        severity: "error",
        summary: `The report contains a postal address held in your records: "${address.trim()}"`,
        detail:
          "Addresses are never sent to the model, so this reached the report through a free-text note. Agency and school addresses are not for reports.",
        evidence: address.trim(),
      });
    }

    const shaped: Array<[RegExp, string]> = [
      [UK_POSTCODE, "a UK postcode"],
      [PO_BOX, "a PO box"],
      [HOUSE_AND_STREET, "a house number and street"],
    ];
    for (const [pattern, what] of shaped) {
      for (const m of artifact.matchAll(pattern)) {
        const text = (m[0] ?? "").trim();
        add({
          checkId: "PII-04",
          severity: "warning",
          summary: `The report contains what looks like ${what}: "${text}"`,
          detail:
            "The report writer is never given an address, so this was typed in or invented. It may be a venue rather than a contact address -- only a person can tell.",
          evidence: text,
        });
      }
    }
    return findings;
  },
};
