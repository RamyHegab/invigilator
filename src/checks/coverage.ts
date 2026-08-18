import type { Check, Finding } from "../types.js";
import { mentions, parseIsoDates, parseSections } from "../parse.js";

/**
 * Everything the source says happened is mentioned.
 *
 * Absence is the failure mode nobody notices: a report that omits a country
 * reads perfectly well, and only the data knows it is incomplete.
 */
export const coverage: Check = {
  id: "COV-01",
  title: "Every entity that must appear does",
  run: ({ facts, artifact }) => {
    const findings: Finding[] = [];
    for (const e of facts.entities) {
      if (e.mustAppear === false) continue;
      const names = [e.label, ...(e.aliases ?? [])];
      if (names.some((n) => mentions(artifact, n))) continue;
      findings.push({
        checkId: "COV-01",
        severity: "error",
        summary: `The report never mentions ${e.kind} "${e.label}".`,
        detail:
          e.aliases?.length
            ? `Looked for: ${names.map((n) => `"${n}"`).join(", ")}.`
            : undefined,
      });
    }
    return findings;
  },
};

/**
 * No date outside the period the artifact covers.
 *
 * A date a fortnight after the trip ended is either a typo in the data or an
 * invention in the report; either way somebody should look.
 */
export const datesWithinPeriod: Check = {
  id: "DATE-01",
  title: "Dates fall inside the period",
  run: ({ config, facts, artifact }) => {
    const period = facts.period;
    if (!period) return [];

    // Sections that legitimately carry dates outside the period — follow-up
    // due dates, most obviously — are exempt by configuration. Checking the
    // whole document blindly makes the check fire on correct reports.
    const exempt = new Set(
      config.sections
        .filter((s) => s.allowDatesOutsidePeriod)
        .map((s) => s.name.toLowerCase()),
    );

    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const section of parseSections(artifact)) {
      if (exempt.has(section.name.toLowerCase())) continue;
      for (const d of parseIsoDates(section.body)) {
        if (seen.has(d)) continue;
        seen.add(d);
        if (d >= period.start && d <= period.end) continue;
        findings.push({
          checkId: "DATE-01",
          severity: "error",
          summary: `"${section.name}" gives ${d}, which is outside the period the report covers.`,
          detail: `Period is ${period.start} to ${period.end}.`,
          evidence: d,
        });
      }
    }
    return findings;
  },
};
