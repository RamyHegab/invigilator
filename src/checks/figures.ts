import type { Check, Figure, Finding } from "../types.js";
import { parseAmounts } from "../parse.js";

/** Money compared at 2dp: 940.004 and 940.00 are the same figure. */
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Every figure the source knows about appears somewhere in the artifact.
 *
 * A model asked to "copy the totals" will occasionally recompute them instead,
 * and a plausible wrong number is indistinguishable from a right one by eye.
 */
export const figuresStated: Check = {
  id: "FIG-01",
  title: "Stated figures match the source",
  run: ({ facts, artifact }) => {
    const amounts = parseAmounts(artifact);
    const findings: Finding[] = [];
    for (const f of facts.figures) {
      if (amounts.some((a) => same(a, f.value))) continue;
      findings.push({
        checkId: "FIG-01",
        severity: "error",
        summary: `The report never states the ${f.label} figure of ${f.value.toFixed(2)}.`,
        detail:
          "Either the figure is missing or it has been altered. Figures are meant to be copied from the source, never recomputed.",
      });
    }
    return findings;
  },
};

/**
 * Category figures add up to the total they claim to break down.
 *
 * This is the check that catches the failure nobody spots in review: four
 * numbers in a table where the first three do not make the fourth, with
 * nothing on the page to say why.
 */
export const figuresReconcile: Check = {
  id: "FIG-02",
  title: "Categories sum to their total",
  run: ({ facts }) => {
    const byTotal = new Map<string, Figure[]>();
    for (const f of facts.figures) {
      if (!f.partOfTotal) continue;
      const list = byTotal.get(f.partOfTotal) ?? [];
      list.push(f);
      byTotal.set(f.partOfTotal, list);
    }

    const findings: Finding[] = [];
    for (const [totalId, parts] of byTotal) {
      const total = facts.figures.find((f) => f.id === totalId);
      if (!total) {
        findings.push({
          checkId: "FIG-02",
          severity: "warning",
          summary: `Figures claim to be part of "${totalId}", but no such total exists.`,
          detail: "This is a configuration error in the app's facts, not a fault in the report.",
        });
        continue;
      }
      const sum = parts.reduce((n, p) => n + p.value, 0);
      if (same(sum, total.value)) continue;
      findings.push({
        checkId: "FIG-02",
        severity: "error",
        summary: `${total.label} does not equal the sum of its parts.`,
        detail: `${parts.map((p) => `${p.label} ${p.value.toFixed(2)}`).join(" + ")} = ${sum.toFixed(
          2,
        )}, but ${total.label} is ${total.value.toFixed(2)} — a difference of ${Math.abs(
          sum - total.value,
        ).toFixed(2)}.`,
      });
    }
    return findings;
  },
};

/**
 * One currency, where the app enforces one.
 *
 * Mixing units in a total is a silent error of tens of percent, and the symbol
 * is usually the only visible clue.
 */
export const singleCurrency: Check = {
  id: "CUR-01",
  title: "Only the account currency appears",
  run: ({ config, facts, artifact }) => {
    const expected = config.singleCurrency;
    if (!expected) return [];

    const findings: Finding[] = [];
    const others = new Set<string>();

    for (const f of facts.figures) {
      if (f.currency && f.currency.toUpperCase() !== expected.toUpperCase()) {
        others.add(f.currency.toUpperCase());
      }
    }
    for (const code of others) {
      findings.push({
        checkId: "CUR-01",
        severity: "error",
        summary: `A source figure is in ${code}, but every figure should be in ${expected}.`,
        detail: "Nothing converts automatically, so a foreign figure here means one was stored unconverted.",
      });
    }

    // Currency codes written in the artifact itself, e.g. "EUR 450".
    for (const m of artifact.matchAll(/\b([A-Z]{3})\s?\d/g)) {
      const code = m[1] ?? "";
      if (code === expected.toUpperCase()) continue;
      if (!/^(GBP|EUR|USD|AED|SAR|EGP|TRY|MAD|DZD|JOD|AZN|KZT|UZS)$/.test(code)) continue;
      findings.push({
        checkId: "CUR-01",
        severity: "error",
        summary: `The report quotes an amount in ${code}, but reports are single-currency (${expected}).`,
        evidence: m[0],
      });
    }
    return findings;
  },
};
