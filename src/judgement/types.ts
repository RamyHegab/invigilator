import type { Finding } from "../types.js";

/**
 * The judgement pass: checks that need a reader, not a rule.
 *
 * Everything in the main registry is free, instant and repeatable. These are
 * none of those -- "does the summary address the objectives" has no
 * deterministic answer -- so they live apart, run only when the caller supplies
 * a model, and carry a lower promise: a finding here is a reader's opinion,
 * checked as hard as it can be, never proof.
 *
 * The engine still never calls a model. It says what to ask and how far to
 * distrust the answer; the caller injects the model. That keeps this package
 * free of any SDK, keeps report text from leaving an application unless the
 * application chooses to send it, and lets every path here be tested with a
 * fake judge.
 */

/** What is put to the model. Untrusted text is delimited inside `user`. */
export type JudgeRequest = {
  /** Which check is asking, so the caller can log or route it. */
  checkId: string;
  /** Fixed instructions. Never contains report or source text. */
  system: string;
  /** The material to judge, with untrusted text fenced off as data. */
  user: string;
};

/**
 * The model's answer as raw text, expected to be JSON.
 *
 * Raw on purpose: the engine parses it defensively, because a model's output
 * is data from outside the system, not a value the type system can vouch for.
 */
export type Judge = (request: JudgeRequest) => Promise<string>;

/** What the app tells the judge about the thing being checked. */
export type JudgementFacts = {
  /**
   * What the trip set out to do, verbatim. Absent or blank means there is
   * nothing to hold the summary against, and QUA-01 does not run.
   */
  objectives?: string;
  /**
   * The plain-text account of what the data says happened -- exactly what the
   * writer was given, and nothing else. A claim that is not in here had no
   * possible source. It must already be free of anything the report itself may
   * not contain (third-party contact details), because it is sent to a model.
   */
  sourceText: string;
  /** Heading of the section that must address the objectives. */
  summarySection?: string;
  /**
   * Text that was derived from a record, next to the record it came from.
   * BRIEF-01 asks whether each is faithful to its source.
   */
  derived?: Array<{
    id: string;
    /** For findings -- "Cairo school visit, 12 Sep". */
    label: string;
    source: string;
    derived: string;
  }>;
};

export type JudgementOptions = {
  /** Which checks to run. Defaults to all of them. */
  only?: string[];
  /** Findings below this self-reported confidence are dropped. Default 0.6. */
  minConfidence?: number;
  /** Most findings kept per check, highest confidence first. Default 5. */
  maxFindingsPerCheck?: number;
  /** Derived items sent to the judge in one call. Default 8. */
  batchSize?: number;
};

export type JudgementResult = {
  findings: Finding[];
  /** Checks that ran, for the audit trail. */
  ran: string[];
  /** Checks that could not or need not run, and why. Never silently absent. */
  skipped: Array<{ id: string; reason: string }>;
  /**
   * Things the judge said that were thrown away rather than reported: a quote
   * that is not in the artifact, an objective it invented. Not findings -- but
   * a high count means the judge is not to be trusted with this artifact.
   */
  discarded: Array<{ id: string; reason: string; detail?: string }>;
};

/** One judgement check: how to ask, and how to read the answer. */
export type JudgementCheck = {
  id: string;
  title: string;
  /**
   * Whether it applies at all. A reason is returned when it does not, so a
   * skipped check is recorded rather than looking like a passed one.
   */
  applies: (facts: JudgementFacts, artifact: string) => { ok: true } | { ok: false; reason: string };
  run: (args: {
    facts: JudgementFacts;
    artifact: string;
    judge: Judge;
    options: Required<JudgementOptions>;
  }) => Promise<{
    findings: Finding[];
    discarded: JudgementResult["discarded"];
    /**
     * Set when the judge answered but the answer could not be read, so the
     * check did not really look. Recorded as skipped -- never as a clean pass --
     * while any findings from the readable part are kept.
     */
    incomplete?: string;
  }>;
};
