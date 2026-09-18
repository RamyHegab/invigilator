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
  /**
   * The section it must appear *in*, when appearing anywhere is not enough.
   *
   * An agent visit named in passing in the summary, but missing from the
   * section that lists engagements, is still a gap: a reader who goes looking
   * for what happened with that agent will not find it. Unset means anywhere
   * in the artifact will do.
   */
  section?: string;
  /**
   * Which check a missing entity is reported under. Defaults to "COV-01".
   *
   * The mechanism is identical for every kind of entity -- something the
   * source says exists and the report must mention. Two entity kinds can
   * still be different *checks* in the domain-model sense: a missing country
   * and a missing city are found the same way but are worth naming, disabling
   * and reasoning about separately, the way COV-01 and COV-02 are two rows in
   * a checklist even though one function covers both.
   */
  checkId?: string;
  /**
   * Defaults to "error". Set to "warning" for a free-typed field where two
   * spellings of the same real thing are a live risk -- a city typed once as
   * "Casablanca" and once as "Casablanaca" is almost certainly one place, not
   * two, and reporting the misspelling as a hard error blames the report for
   * a typo in the source it cannot fix. Same reasoning as COV-06/07.
   */
  severity?: "error" | "warning";
};

/**
 * A claim the artifact makes about *who did something*.
 *
 * Attribution is its own failure mode. A report that names the wrong colleague
 * beside a visit is not missing anything and contradicts no figure — every
 * other check passes it — but the record it creates is false, and it is the
 * kind of falsehood people act on.
 */
export type Attribution = {
  /** What the claim is about, as the artifact would name it: an agency, a school. */
  subject: string;
  aliases?: string[];
  /**
   * What kind of claim this is, in words that finish "credits X with …":
   * "the visit to", "organising".
   *
   * Not decoration. Two different claims can share a subject — who *ran* an
   * event and who *attended* it — and without something to tell them apart they
   * look like one claim with two contradictory answers, which the ambiguity
   * guard then drops. That would silently disable both checks on exactly the
   * events that have the most riding on them.
   */
  relation?: string;
  /**
   * Who the source says did it. **Null means the source names nobody**, and the
   * artifact naming somebody anyway is an invention.
   */
  expected: string | null;
  /**
   * Every person who could plausibly be named here — the team. Without the full
   * set a wrong name is unrecognisable: the check can only tell that the
   * expected name is absent, not that a different real person was credited.
   */
  candidates: string[];
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

/** One labelled quantity inside a breakdown. */
export type BreakdownPart = {
  label: string;
  value: number;
  /** Other wordings: "UG" is also written "undergraduate". */
  aliases?: string[];
  /** When false the artifact may omit it without a finding. */
  mustAppear?: boolean;
};

/**
 * A whole and its parts: a split, a tally, a ranking.
 *
 * Generic on purpose. Orbis fills this with lead figures, but the shape says
 * nothing about leads — the next app fills it with invoice lines or cohorts and
 * gets the same three checks for nothing.
 */
export type Breakdown = {
  id: string;
  /** "leads by study level" — used in messages, never in logic. */
  label: string;
  /** Restrict the search to this section and everything nested under it. */
  section?: string;
  /** How a writer words the whole: "leads captured". Checked by BRK-01. */
  totalLabel?: string;
  totalAliases?: string[];
  total?: number;
  parts: BreakdownPart[];
  /**
   * When true the order the artifact lists the parts in reads as a ranking,
   * and presenting a smaller part ahead of a larger one is a finding.
   */
  ranked?: boolean;
};

/** A count the artifact may state about itself, e.g. six travel legs. */
export type CountFact = {
  /** The phrase as a reader would write it: "travel legs". */
  label: string;
  value: number;
  /** Other wordings for the same thing: "sectors", "flights". */
  aliases?: string[];
  /**
   * Only check this count inside the named section.
   *
   * A portfolio total is a claim about the whole; a section headed "Outcomes by
   * Country" makes claims about parts. Checking "3 agent visits" in a country
   * section against a portfolio total of ten reports a correct sentence.
   */
  section?: string;
};

/**
 * What a record said it would cover, against what it turned out to cover.
 *
 * Some records declare their own scope separately from the work inside them --
 * a trip lists its destination countries, and also contains activities that
 * each happened somewhere. Nothing makes the two agree. A country declared and
 * never visited is a plan that quietly did not happen; a country visited and
 * never declared is scope that crept, or a slip in data entry.
 *
 * Both sides are supplied by the adapter and compared to each other, not to
 * the artifact: this is the source disagreeing with itself, which no amount of
 * reading the report would reveal.
 */
export type Declaration = {
  /** Singular, lower case, for the finding's wording -- e.g. "destination country". */
  kind: string;
  /** What the record declared up front. */
  declared: string[];
  /** What the records underneath it actually show, derived independently. */
  observed: string[];
  /**
   * Where the declaration lives, for someone about to go and fix it --
   * e.g. "the trip's destinations".
   */
  where?: string;
};

/**
 * A named thing, and the only sub-names the record allows to follow it.
 *
 * Reports write "Agency — Branch", "Supplier (Depot)", "Hospital, Ward". The
 * first half is checked by every other check here; the second half is checked
 * by nothing, and is exactly where a model invents. Asked for a detail it was
 * never given, it will either leave it out or make one up, and the made-up one
 * reads like a fact.
 *
 * `permitted` is the closed set for this artifact -- not everything that exists,
 * but what this record actually attaches to that subject. A real branch of the
 * right agency, on the wrong trip, is still wrong in this report.
 */
export type Qualifier = {
  /** The thing being qualified, exactly as the record spells it. */
  subject: string;
  /** Singular, lower case, for the finding's wording -- e.g. "branch". */
  kind: string;
  /** Every sub-name the record permits here. Empty means none is allowed. */
  permitted: string[];
};

/**
 * A named thing that ran across more than one day, as the source records it.
 *
 * Nothing forces a report to keep both ends of a span once it starts naming
 * dates in prose: "a productive visit on 15 October" is a perfectly natural
 * sentence about a fair that actually ran 15-17 October, and reads no
 * differently from one that ran a single day. The reader has no way to tell
 * the difference from the sentence alone, and neither does any check that
 * only asks whether a subject was mentioned.
 */
export type DateSpan = {
  /** The activity or event as it should be found in the report. */
  subject: string;
  /** Singular, lower case, for the finding's wording -- e.g. "activity". */
  kind: string;
  /** ISO yyyy-mm-dd. Must be strictly before `end`, or nothing is checked. */
  start: string;
  end: string;
  /** Where a reader would look for this subject, if scoped. */
  section?: string;
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
  /** Who the artifact says did what; checked by ATTR-01. */
  attributions?: Attribution[];
  /** Breakdowns the artifact should state; checked by BRK-01..03. */
  breakdowns?: Breakdown[];
  /** Scope declared up front vs scope actually worked; checked by COV-06/07. */
  declarations?: Declaration[];
  /** Sub-names an artifact may attach to a named thing; checked by QUAL-01. */
  qualifiers?: Qualifier[];
  /** Multi-day things whose full span must survive into the report; checked by DATE-03. */
  dateSpans?: DateSpan[];
  /**
   * Third-party postal addresses the app holds, which must never appear; PII-04.
   * Matched loosely on punctuation and case, so a comma moved is still a leak.
   */
  addresses?: string[];
};

export type SectionSpec = {
  name: string;
  required: boolean;
  /** When set, the section must contain a table with these column headers. */
  tableColumns?: string[];
  /**
   * Columns in that table which must carry a real answer.
   *
   * An owner column reading "TBC" is a row that looks like a commitment and
   * obliges nobody. Checked by STR-05.
   */
  noPlaceholderColumns?: string[];
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
