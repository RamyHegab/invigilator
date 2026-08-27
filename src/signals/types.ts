/**
 * The behavioural half of the contract.
 *
 * Reports are checked against the data they describe. Behaviour is checked
 * against itself: nobody supplies a "correct" answer for how an application
 * should feel, so these checks look for shapes that only appear when something
 * is wrong — the same control abandoned by several people, an error that keeps
 * happening and is never reported, a request that fails under a spinner.
 *
 * As generic as the report side. An event carries a kind, a place, a thing, and
 * who it happened to. Nothing here knows what a trip is.
 */

/** One thing that happened to one person. */
export type BehaviourEvent = {
  /** "rage_click", "dead_click", "js_error", "failed_request", "route_view". */
  kind: string;
  /** ISO timestamp. */
  at: string;
  /**
   * Who it happened to, opaquely. Only ever compared for equality — the checks
   * count how many *different* people hit something, never who they were.
   */
  actor: string;
  /** One visit in one tab, so a single frustrated afternoon is recognisable. */
  session: string;
  /** Where in the app: a route with its ids already stripped. */
  where: string;
  /** What was involved: a named control, an error message, a request. */
  what?: string | null;
  /** Numbers and short strings. Never anything a person typed or read. */
  detail?: Record<string, number | string>;
};

/**
 * When a pattern is worth telling somebody about.
 *
 * Every threshold here exists to answer one question: is this a defect, or is
 * it one person having a bad afternoon? The answer is almost always **how many
 * different people**, which is why that is the primary guard rather than a
 * count of events. One person clicking a button eleven times is a story about
 * that person; three people clicking it is a story about the button.
 */
export type SignalConfig = {
  appId: string;
  /** Distinct people who must hit the same thing before it is reported. */
  minActors?: number;
  /** Total occurrences required, as a floor under the actor rule. */
  minOccurrences?: number;
  /** Checks to skip, with the reason. */
  disabledChecks?: Record<string, string>;
};

export type SignalContext = {
  config: SignalConfig;
  events: BehaviourEvent[];
  /** The window these events were drawn from, for the wording of a finding. */
  period?: { start: string; end: string };
};

export type SignalCheck = {
  id: string;
  title: string;
  run: (ctx: SignalContext) => import("../types.js").Finding[];
};
