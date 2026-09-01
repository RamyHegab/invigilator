import type { Finding } from "../types.js";
import type { Counts, Tally, TallyConfig } from "./types.js";

/**
 * Three ways a set of counts can be wrong while looking right.
 *
 * TAL-01  the stated figure is not what a recount gives
 * TAL-02  the breakdown does not add up to the whole it breaks down
 * TAL-03  source records fell into no category and vanished from both
 */

const categories = (...maps: Counts[]) => [...new Set(maps.flatMap((m) => Object.keys(m)))].sort();

const sumParts = (parts: Tally["parts"], category: string) =>
  (parts ?? []).reduce((n, p) => n + (p.counts[category] ?? 0), 0);

export type TallyResult = {
  findings: Finding[];
  ran: string[];
  skipped: Array<{ id: string; reason: string }>;
  checked: number;
};

export function runTallies(tallies: Tally[], config: TallyConfig): TallyResult {
  const findings: Finding[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const ran: string[] = [];

  const enabled = (id: string) => {
    const reason = config.disabledChecks?.[id];
    if (reason) {
      if (!skipped.some((s) => s.id === id)) skipped.push({ id, reason });
      return false;
    }
    if (!ran.includes(id)) ran.push(id);
    return true;
  };

  for (const t of tallies) {
    // --- TAL-01: does the figure survive a recount? -------------------------
    if (enabled("TAL-01")) {
      for (const c of categories(t.stated, t.recomputed)) {
        const said = t.stated[c] ?? 0;
        const found = t.recomputed[c] ?? 0;
        if (said === found) continue;
        findings.push({
          checkId: "TAL-01",
          severity: "error",
          summary: `${t.label}: the report says ${said} ${c}, a recount gives ${found}.`,
          detail:
            "Both numbers come from the same records by different routes. One of the two routes is wrong, " +
            "and the report is the one people will act on.",
          evidence: c,
        });
      }
    }

    // --- TAL-02: does the breakdown add up? ---------------------------------
    if (t.parts?.length && enabled("TAL-02")) {
      for (const c of categories(t.stated)) {
        const whole = t.stated[c] ?? 0;
        const parts = sumParts(t.parts, c);
        if (whole === parts) continue;
        findings.push({
          checkId: "TAL-02",
          severity: "error",
          summary: `${t.label}: ${c} totals ${whole}, but the breakdown adds to ${parts}.`,
          detail:
            `Across ${t.parts.length} rows. A reader who adds up the column gets a different answer ` +
            `from the one printed at the top, and has no way to tell which is right.`,
          evidence: c,
        });
      }
    }

    // --- TAL-03: did anything fall out of every category? -------------------
    if (t.unclassified && t.unclassified.count > 0 && enabled("TAL-03")) {
      const reason = t.unclassified.reason ?? "";
      const expected = (config.expectedExclusions ?? []).includes(reason);
      if (!expected) {
        findings.push({
          checkId: "TAL-03",
          severity: "warning",
          summary: `${t.label}: ${t.unclassified.count} record(s) counted in no category.`,
          detail:
            (reason ? `Given reason: ${reason}. ` : "No reason given. ") +
            "They are in the period the report covers but appear in none of its figures, so the totals " +
            "understate the work without saying so.",
        });
      }
    }
  }

  const order = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return { findings, ran, skipped, checked: tallies.length };
}
