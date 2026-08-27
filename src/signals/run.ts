import type { Finding } from "../types.js";
import type { BehaviourEvent, SignalConfig, SignalContext } from "./types.js";
import { SIGNAL_CHECKS } from "./checks.js";

export type SignalResult = {
  findings: Finding[];
  ran: string[];
  skipped: Array<{ id: string; reason: string }>;
  /** How much was looked at, so an empty result can be told from an empty table. */
  examined: number;
};

/**
 * Runs the behavioural checks over a window of events.
 *
 * Mirrors runChecks deliberately, down to reporting what was skipped and why: a
 * check that did not run must never be mistaken for a check that found nothing.
 * A quiet week and a broken collector look identical otherwise, and the second
 * is the one worth knowing about.
 */
export function runSignals(
  events: BehaviourEvent[],
  config: SignalConfig,
  period?: { start: string; end: string },
): SignalResult {
  const findings: Finding[] = [];
  const ran: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const ctx: SignalContext = { config, events, period };

  for (const check of SIGNAL_CHECKS) {
    const reason = config.disabledChecks?.[check.id];
    if (reason) {
      skipped.push({ id: check.id, reason });
      continue;
    }
    try {
      findings.push(...check.run(ctx));
      ran.push(check.id);
    } catch (e: any) {
      // One bad check must not cost the whole run, and its failure must be
      // visible rather than looking like a clean result.
      skipped.push({ id: check.id, reason: `threw: ${e?.message ?? e}` });
    }
  }

  // Worst first: somebody reading this stops partway down.
  const order = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return { findings, ran, skipped, examined: events.length };
}
