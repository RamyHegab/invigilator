import type { AppConfig, Check, CheckContext, Finding, SourceFacts } from "./types.js";
import { coverage, datesWithinPeriod } from "./checks/coverage.js";
import { figuresReconcile, figuresStated, singleCurrency } from "./checks/figures.js";
import { links, noPersonalData, structure } from "./checks/integrity.js";
import { statedCounts } from "./checks/counts.js";
import { breakdownOrder, breakdownParts, breakdownTotal } from "./checks/breakdown.js";

/**
 * Every deterministic check. Judgement checks (does the summary address the
 * stated objectives; is a claim supported) run in a separate pass with a model
 * and are not part of this registry — these must stay free, instant and
 * incapable of a false positive, so that a finding is always worth reading.
 */
export const CHECKS: Check[] = [
  coverage,
  datesWithinPeriod,
  figuresStated,
  figuresReconcile,
  singleCurrency,
  links,
  noPersonalData,
  structure,
  statedCounts,
  breakdownTotal,
  breakdownParts,
  breakdownOrder,
];

export type RunResult = {
  appId: string;
  findings: Finding[];
  /** Checks that ran, for the audit trail — "nothing found" needs proof. */
  ran: string[];
  skipped: Array<{ id: string; reason: string }>;
};

export function runChecks(
  artifact: string,
  facts: SourceFacts,
  config: AppConfig,
  checks: Check[] = CHECKS,
): RunResult {
  const ctx: CheckContext = { config, facts, artifact };
  const findings: Finding[] = [];
  const ran: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const check of checks) {
    const reason = config.disabledChecks?.[check.id];
    if (reason) {
      skipped.push({ id: check.id, reason });
      continue;
    }
    ran.push(check.id);
    try {
      findings.push(...check.run(ctx));
    } catch (e: any) {
      // A broken check must not take the run down with it, and must not be
      // mistaken for a clean result.
      findings.push({
        checkId: check.id,
        severity: "warning",
        summary: `The check "${check.title}" could not run.`,
        detail: e?.message ?? String(e),
      });
    }
  }

  const rank = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.checkId.localeCompare(b.checkId));

  return { appId: config.appId, findings, ran, skipped };
}

/** Plain-text summary, for an email body or a log line. */
export function formatFindings(result: RunResult): string {
  if (result.findings.length === 0) {
    return `No problems found (${result.ran.length} checks ran).`;
  }
  const lines = result.findings.map((f) => {
    const bits = [`[${f.severity.toUpperCase()}] ${f.checkId}: ${f.summary}`];
    if (f.detail) bits.push(`    ${f.detail}`);
    if (f.evidence) bits.push(`    Found: ${f.evidence}`);
    return bits.join("\n");
  });
  const errors = result.findings.filter((f) => f.severity === "error").length;
  return `${result.findings.length} finding(s), ${errors} error(s):\n\n${lines.join("\n")}`;
}
