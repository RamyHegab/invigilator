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
