import type { Finding } from "../types.js";
import { JUDGEMENT_CHECKS } from "./checks.js";
import type { Judge, JudgementFacts, JudgementOptions, JudgementResult } from "./types.js";

const DEFAULTS: Required<JudgementOptions> = {
  only: [],
  minConfidence: 0.6,
  maxFindingsPerCheck: 5,
  batchSize: 8,
};

/**
 * Runs the judgement checks that apply, with the caller's model.
 *
 * Two rules carry over from the rest of the engine. A check that did not run is
 * never reported as one that passed: it appears in `skipped` with its reason,
 * including when the model itself failed. And a broken check must not take the
 * others down -- the checks are independent, so they run side by side and one
 * failing costs only itself.
 *
 * Nothing here throws on a bad model reply. A judge that answers with prose, or
 * with a quote that is not in the document, produces `discarded` entries, not
 * findings and not exceptions.
 */
export async function runJudgement(
  artifact: string,
  facts: JudgementFacts,
  judge: Judge,
  options: JudgementOptions = {},
): Promise<JudgementResult> {
  const opts: Required<JudgementOptions> = {
    only: options.only ?? DEFAULTS.only,
    minConfidence: options.minConfidence ?? DEFAULTS.minConfidence,
    maxFindingsPerCheck: options.maxFindingsPerCheck ?? DEFAULTS.maxFindingsPerCheck,
    batchSize: Math.max(1, options.batchSize ?? DEFAULTS.batchSize),
  };

  const result: JudgementResult = { findings: [], ran: [], skipped: [], discarded: [] };
  const wanted = JUDGEMENT_CHECKS.filter((c) => !opts.only.length || opts.only.includes(c.id));

  const runnable = wanted.filter((check) => {
    const gate = check.applies(facts, artifact);
    if (!gate.ok) {
      result.skipped.push({ id: check.id, reason: gate.reason });
      return false;
    }
    return true;
  });

  const settled = await Promise.allSettled(
    runnable.map((check) => check.run({ facts, artifact, judge, options: opts })),
  );

  settled.forEach((outcome, i) => {
    const check = runnable[i]!;
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      result.skipped.push({ id: check.id, reason: `the judge failed: ${message.slice(0, 200)}` });
      return;
    }
    if (outcome.value.incomplete) {
      result.skipped.push({ id: check.id, reason: outcome.value.incomplete });
    } else {
      result.ran.push(check.id);
    }
    result.findings.push(...(outcome.value.findings as Finding[]));
    result.discarded.push(...outcome.value.discarded);
  });

  return result;
}
