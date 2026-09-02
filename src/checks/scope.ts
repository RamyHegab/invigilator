import { normaliseName } from "../parse.js";
import type { Check, Declaration, Finding } from "../types.js";

/**
 * Compares what a record declared it would cover against what it covered.
 *
 * Unlike every other check here, these two never read the artifact. The
 * disagreement is inside the source: a trip declares its destination countries
 * in one field and accumulates activities in another, and nothing has ever
 * made the two agree. A generated report is then perfectly faithful to data
 * that is itself wrong, which is exactly the failure no reader can catch.
 */

/** Keeps the first spelling seen, so findings quote what a person typed. */
function index(names: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of names) {
    const key = normaliseName(name);
    if (key && !map.has(key)) map.set(key, name.trim());
  }
  return map;
}

function each(
  declarations: Declaration[] | undefined,
  fn: (d: Declaration, declared: Map<string, string>, observed: Map<string, string>) => void,
): void {
  for (const d of declarations ?? []) fn(d, index(d.declared), index(d.observed));
}

/**
 * Declared, but nothing happened there.
 *
 * A warning rather than an error: the honest readings are "the visit was
 * cancelled and nobody updated the trip" and "it is spelled differently in the
 * two places", and only a person can tell those apart.
 */
export const declaredButUnused: Check = {
  id: "COV-06",
  title: "Everything declared was actually used",
  run: ({ facts }) => {
    const findings: Finding[] = [];
    each(facts.declarations, (d, declared, observed) => {
      for (const [key, label] of declared) {
        if (observed.has(key)) continue;
        findings.push({
          checkId: "COV-06",
          severity: "warning",
          summary: `${d.kind} "${label}" was declared, but nothing was recorded in it.`,
          detail:
            `Either it was planned and never happened, or it is spelled differently ` +
            `in the two places.` + (d.where ? ` Declared in ${d.where}.` : ""),
          evidence: label,
        });
      }
    });
    return findings;
  },
};

/**
 * Happened, but was never declared.
 *
 * The mirror image, and the more interesting direction: work exists that the
 * record's own scope does not admit to.
 */
export const usedButUndeclared: Check = {
  id: "COV-07",
  title: "Everything used was declared",
  run: ({ facts }) => {
    const findings: Finding[] = [];
    each(facts.declarations, (d, declared, observed) => {
      for (const [key, label] of observed) {
        if (declared.has(key)) continue;
        findings.push({
          checkId: "COV-07",
          severity: "warning",
          summary: `Work was recorded in ${d.kind} "${label}", which was never declared.`,
          detail:
            `Either the scope grew and the declaration was not updated, or ` +
            `something was filed under the wrong ${d.kind}.` +
            (d.where ? ` Declared in ${d.where}.` : ""),
          evidence: label,
        });
      }
    });
    return findings;
  },
};
