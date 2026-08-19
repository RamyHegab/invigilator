/**
 * The contract between an app and the engine.
 *
 * The whole design rests on one idea: **checks are generic, facts are not.**
 * An app supplies (a) a config describing what a correct artifact looks like
 * and (b) the facts the artifact is supposed to describe, both in the shapes
 * below. Every check then works on those shapes alone and knows nothing about
 * trips, agents, invoices or patients — which is what lets the same engine run
 * against a second app without being rewritten.
 */

export type Severity = "error" | "warning" | "info";

export type Finding = {
  /** Stable id, e.g. "COV-01". Findings are compared across runs by this. */
  checkId: string;
  severity: Severity;
  /** One sentence, written for the person who has to act on it. */
  summary: string;
  /** What was expected versus what the artifact said. */
  detail?: string;
  /** The exact text from the artifact that triggered it, where there is one. */
  evidence?: string;
};

/** Something the artifact is expected to mention. */
export type Entity = {
  id: string;
  /** "country", "agent", "event" — used only in messages, never in logic. */
  kind: string;
  /** The name as it should appear. Matching is case-insensitive. */
  label: string;
  /** Alternative spellings that also count as a mention. */
  aliases?: string[];
  /**
   * When false the entity may legitimately be absent — a free-typed record
   * with no linkable card, say. Absence is then not a finding.
   */
  mustAppear?: boolean;
};

/**
 * A number the artifact states, which must match the source.
 *
 * `partOfTotal` drives reconciliation: every figure carrying the same total id
 * must sum to that total. This is the check that catches a cost breakdown whose
 * categories quietly fail to add up.
 */
export type Figure = {
  id: string;
  label: string;
  value: number;
  currency?: string;
  partOfTotal?: string;
};

/** A link the artifact may contain. Anything else is invented. */
export type LinkFact = {
  href: string;
  label: string;
  /** Whether the artifact is required to include it. */
  required?: boolean;
};

/** A count the artifact may state about itself, e.g. six travel legs. */
export type CountFact = {
  /** The phrase as a reader would write it: "travel legs". */
  label: string;
  value: number;
  /** Other wordings for the same thing: "sectors", "flights". */
  aliases?: string[];
};

export type SourceFacts = {
  /** Dates in the artifact must fall inside this range, when given. */
  period?: { start: string; end: string };
  entities: Entity[];
  figures: Figure[];
  links: LinkFact[];
  /**
   * Strings that must never appear — third-party contact names, emails,
   * phone numbers pulled from the app's own records. Matching is exact and
   * case-insensitive, so these produce no false positives.
   */
  forbidden: string[];
  /** Counts the artifact may assert about itself; checked by CNT-01. */
  counts?: CountFact[];
};

export type SectionSpec = {
  name: string;
  required: boolean;
  /** When set, the section must contain a table with these column headers. */
  tableColumns?: string[];
  /**
   * Dates here may fall outside the period, and are not flagged.
   *
   * Follow-up actions are the case that matters: a due date after the trip is
   * correct by definition. Without this, the date check fires on every
   * well-formed report — noise that teaches people to ignore findings.
   */
  allowDatesOutsidePeriod?: boolean;
};

/**
 * Per-app configuration. This is the machine-readable twin of the app's
 * human domain model — the file its owner reads, corrects and signs off.
 */
export type AppConfig = {
  appId: string;
  /** Where the human-readable model lives, for traceability. */
  domainModel?: string;
  /** Section structure is per-app: one institution's template is not another's. */
  sections: SectionSpec[];
  /** Currency every figure must be expressed in, when the app enforces one. */
  singleCurrency?: string;
  /** Checks to skip, with the reason — e.g. data the app cannot supply yet. */
  disabledChecks?: Record<string, string>;
};

export type CheckContext = {
  config: AppConfig;
  facts: SourceFacts;
  /** The artifact under inspection, as markdown. */
  artifact: string;
};

export type Check = {
  id: string;
  title: string;
  run: (ctx: CheckContext) => Finding[];
};
