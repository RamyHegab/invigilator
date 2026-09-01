/**
 * Numbers an artifact presents as fact.
 *
 * The third kind of thing this engine checks. Reports are prose measured
 * against data; behaviour is measured against itself; a tally is arithmetic
 * measured against a recount.
 *
 * It exists because "computed in code, therefore correct" is not true. The
 * figures in a portfolio briefing are calculated rather than written by a
 * model, and that removes one failure and not the other: the sums can still be
 * wrong, the categories can still fail to cover everything, and a breakdown can
 * still disagree with the total it breaks down. Those errors are worse than a
 * model's, because nobody thinks to look for them.
 *
 * The Orbis domain model calls these AGG-01..03. Nothing here knows what a trip
 * is: a tally is any set of labelled counts with a source to recount from.
 */

export type Counts = Record<string, number>;

export type Tally = {
  id: string;
  /** "activity counts for the year" — used in messages, never in logic. */
  label: string;

  /** What the artifact says, category by category. */
  stated: Counts;

  /**
   * The same categories, counted again from the source records.
   *
   * Supplied by the app, because only the app knows what its records mean. The
   * point is not that the engine can count better — it is that counting twice,
   * by two paths, catches the case where one path is wrong.
   */
  recomputed: Counts;

  /**
   * The same totals split some other way — by country, by month, by owner.
   * Each part's categories must sum to the stated whole.
   */
  parts?: Array<{ label: string; counts: Counts }>;

  /**
   * Source records that landed in no category at all.
   *
   * Some exclusions are deliberate and should be stated rather than hidden: a
   * rest day is on the itinerary and is not work. What must never happen is an
   * item quietly falling out of every category, so that the parts look tidy and
   * the whole is short.
   */
  unclassified?: { count: number; reason?: string };
};

export type TallyConfig = {
  appId: string;
  /**
   * Deliberate exclusions, by reason, that are not worth reporting.
   * Anything unclassified for a reason not listed here is reported.
   */
  expectedExclusions?: string[];
  disabledChecks?: Record<string, string>;
};
