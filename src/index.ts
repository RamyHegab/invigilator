/**
 * Invigilator — checks generated reports against the data they describe.
 *
 * One engine, one config file per app. To point it at a new app you supply an
 * AppConfig (what a correct artifact looks like) and an adapter that maps that
 * app's data into SourceFacts. Nothing here knows what a trip, an invoice or a
 * patient is, and nothing here should learn.
 */
export type {
  AppConfig,
  Breakdown,
  BreakdownPart,
  Check,
  CheckContext,
  Entity,
  CountFact,
  Figure,
  Finding,
  LinkFact,
  SectionSpec,
  Severity,
  SourceFacts,
} from "./types.js";

export { CHECKS, runChecks, formatFindings } from "./run.js";
export type { RunResult } from "./run.js";

export {
  mentions,
  normaliseHeading,
  parseAmounts,
  parseIsoDates,
  parseLinks,
  parseSections,
  parseTables,
} from "./parse.js";

/**
 * The behavioural half: findings from what people did, rather than from what a
 * document says. Same idea, different evidence — and the same rule that a check
 * which did not run is never reported as a check that passed.
 */
export { runSignals } from "./signals/run.js";
export type { SignalResult } from "./signals/run.js";
export { SIGNAL_CHECKS } from "./signals/checks.js";
export type { BehaviourEvent, SignalConfig, SignalCheck, SignalContext } from "./signals/types.js";

/**
 * Arithmetic, measured against a recount. Figures computed in code are not
 * automatically right: the sums can be wrong, the categories can fail to cover
 * everything, and a breakdown can disagree with the total it breaks down.
 */
export { runTallies } from "./tallies/run.js";
export type { TallyResult } from "./tallies/run.js";
export type { Tally, TallyConfig, Counts } from "./tallies/types.js";
