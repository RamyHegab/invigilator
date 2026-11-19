import type { Attribution, Check, Finding } from "../types.js";
import { END, START, fold, foldKey, sameName } from "../text.js";

/**
 * Who the artifact says did what.
 *
 * The generic form of what the Orbis domain model calls VIS-01. A report that
 * credits the wrong colleague with a visit omits nothing, invents no figure and
 * contradicts no total — every other check in this engine passes it. What it
 * produces is a false record of who was in the room, which is the sort of thing
 * people later rely on.
 *
 * Deliberately narrow. It reports a name that is *wrong* and a name where the
 * source records nobody; it does not require the artifact to name anyone at
 * all. Demanding an attribution in every mention would fire on every ordinary
 * sentence that happens to name an agency, and a check that cries wolf gets
 * ignored.
 */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Punctuation collapses before comparing, exactly as it does for entity
 * mentions. A record's "NCUK Fair - Algiers" is written up as "NCUK Fair —
 * Algiers", and a check that reads those as different names quietly stops
 * matching the very reports it exists to read.
 *
 * Word boundaries still apply, so a short name is not found inside a longer
 * word — "AHZ" must not match "AHZUK".
 *
 * Accents fold away too: "José" in the record is "Jose" in the report.
 */
const flatten = (s: string) =>
  fold(s)
    .toLowerCase()
    .replace(/[‐-―\-_/\\,.;:()[\]{}'"“”‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const namesIn = (text: string, name: string) => {
  const needle = flatten(name);
  if (!needle) return false;
  return new RegExp(`${START}${esc(needle)}${END}`, "iu").test(flatten(text));
};

const subjectLabels = (a: Attribution) => [a.subject, ...(a.aliases ?? [])];

/** "organising " / "the visit to ", or nothing when the app did not say. */
const rel = (a: Attribution) => (a.relation ? `${a.relation.trim()} ` : "");

/**
 * The blocks a single claim can live in.
 *
 * A paragraph is the natural unit for prose, but reports put engagements in
 * tables, and a table is one paragraph naming a dozen subjects — which this
 * check then refuses to read, because it cannot tell which name belongs to
 * which. Measured against a real report, that blind spot swallowed every
 * attribution in the document.
 *
 * So table rows and list items are blocks in their own right. A row is exactly
 * one claim about one subject, which is what makes it checkable.
 */
const ROW_OR_ITEM = /^\s*(\||[-*+]\s|\d+[.)]\s)/;

const blocksOf = (artifact: string): string[] => {
  const out: string[] = [];
  for (const para of artifact.split(/\n\s*\n/)) {
    const lines = para.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.some((l) => ROW_OR_ITEM.test(l))) {
      for (const line of lines) out.push(line.trim());
    } else {
      out.push(para.trim());
    }
  }
  return out.filter(Boolean);
};

/**
 * One entry per subject, not per record.
 *
 * The same agency is often visited more than once in a trip, which arrives here
 * as several attributions sharing a subject. Left as they are, every mention
 * looks like it could refer to any of them and the "cannot tell which" guard
 * throws the whole subject away — which is what silently disabled this check
 * against a real report.
 *
 * Records agreeing on who did it are one claim. Records disagreeing are
 * genuinely ambiguous — two visits to one agency by two colleagues, and a
 * mention that could be either — so that subject is dropped, which is the
 * honest answer rather than a coin flip.
 */
function bySubject(attributions: Attribution[]): Attribution[] {
  const groups = new Map<string, Attribution[]>();
  for (const a of attributions) {
    const key = `${(a.relation ?? "").toLowerCase()}|${foldKey(a.subject)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }

  const out: Attribution[] = [];
  for (const group of groups.values()) {
    // null is its own value here, not a string: "the record names nobody" and
        // "the record names somebody" are different claims, and any sentinel
        // string could in principle collide with a real name.
        const distinct = new Set<string | null>(
          group.map((a) => (a.expected === null ? null : foldKey(a.expected))),
        );
    if (distinct.size !== 1) continue;
    out.push(group[0]!);
  }
  return out;
}

export const attribution: Check = {
  id: "ATTR-01",
  title: "Who the report credits matches who the record names",
  run: ({ facts, artifact }) => {
    const attributions = bySubject(facts.attributions ?? []);
    if (!attributions.length) return [];

    const findings: Finding[] = [];
    const blocks = blocksOf(artifact);

    // One question at a time. Who *ran* an event and who *attended* it are
    // different questions, and a table row answering both is not ambiguous --
    // it is complete. Pooling them made a row naming an event and its organiser
    // look like two competing claims, and the guard threw it away.
    const relations = new Set(attributions.map((a) => a.relation ?? ""));

    for (const block of blocks) {
      for (const relation of relations) {
      const ofRelation = attributions.filter((a) => (a.relation ?? "") === relation);

      // Which subjects does this block talk about? A block covering two visits
      // cannot tell us which name belongs to which, so it is left alone rather
      // than guessed at -- a wrong finding here accuses a real colleague of
      // something they did not do.
      const present = ofRelation.filter((a) => subjectLabels(a).some((l) => namesIn(block, l)));
      if (present.length !== 1) continue;

      const a = present[0]!;

      // Look for a credited name in what is left after the subject's own name
      // is taken out. Events are routinely named after whoever runs them --
      // "NCUK Fair — Algiers", "Global Study UK — Cairo" -- so without this the
      // title alone reads as a claim, and a report that correctly says the
      // organiser was not recorded gets reported for naming one.
      const residue = subjectLabels(a).reduce(
        (text, label) => text.replace(new RegExp(esc(flatten(label)), "gi"), " "),
        flatten(block),
      );
      const named = a.candidates.filter((c) => c.trim() && namesIn(residue, c));
      if (!named.length) continue; // nobody credited: not this check's business

      if (a.expected === null) {
        findings.push({
          checkId: "ATTR-01",
          severity: "error",
          summary: `The report credits ${named.join(" and ")} with ${rel(a)}${a.subject}, but the record names nobody.`,
          detail:
            "Either the attribution was invented, or it is real and was never recorded. " +
            "Both are worth resolving, because the report is now the only place it exists.",
          evidence: block.slice(0, 200),
        });
        continue;
      }

      const wrong = named.filter((n) => !sameName(n, a.expected!));
      // Right name present alongside another is fine -- two colleagues, or a
      // name mentioned for a different reason. Only a wrong name standing in
      // place of the right one is a false record.
      if (wrong.length && !named.some((n) => sameName(n, a.expected!))) {
        findings.push({
          checkId: "ATTR-01",
          severity: "error",
          summary: `The report credits ${wrong.join(" and ")} with ${rel(a)}${a.subject}, but the record says ${a.expected}.`,
          evidence: block.slice(0, 200),
        });
      }
      }
    }
    return findings;
  },
};
