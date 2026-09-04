import { normaliseName } from "../parse.js";
import type { Attribution, Breakdown, Declaration, Qualifier, Entity, Figure, LinkFact, SourceFacts } from "../types.js";

/**
 * Orbis → SourceFacts.
 *
 * This is the only file in the engine that knows what a trip is, and it is
 * deliberately a **pure function over rows already fetched by the caller**. No
 * Supabase client, no network, no import from the Orbis codebase — so it runs
 * in a test with a literal object, and so the engine can be lifted out of this
 * repo without dragging an app's data layer with it.
 *
 * A second app writes its own file like this one. Nothing else changes.
 */

export type OrbisTripInput = {
  trip: {
    start_date: string;
    end_date: string;
    destinations?: string[] | null;
  };
  activities: Array<{
    id: string;
    type: string;
    title: string;
    cost?: number | string | null;
    cost_currency?: string | null;
    agent_id?: string | null;
    manual_agent?: string | null;
    /** The staff member recorded as having made the visit. Null when unknown. */
    visited_by?: string | null;
    /**
     * Where the activity happened. Set on travel legs and on anything given a
     * location; often null, which is why COV-06/07 stay silent unless at least
     * one activity on the trip has a country recorded somewhere.
     */
    to_country?: string | null;
    from_country?: string | null;
    to_city?: string | null;
    from_city?: string | null;
    /** Orders the travel legs, so the first departure and last arrival are known. */
    day_date?: string | null;
    agents?: { trading_name?: string | null } | null;
    schools?: { name?: string | null; city?: string | null; country?: string | null } | null;
    agent_branches?: { branch_name?: string | null; city?: string | null; country?: string | null } | null;
  }>;
  hotels: Array<{ cost?: number | string | null; cost_currency?: string | null }>;
  /** Contact rows, so their names and details can be forbidden by exact match. */
  contacts: Array<{
    contact_first_name?: string | null;
    contact_last_name?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    email?: string | null;
    contact_phone?: string | null;
    phone?: string | null;
  }>;
  accountCurrency: string;
  /**
   * The team, so a wrong attribution is recognisable as a wrong *person*
   * rather than merely an absent name. Own-team names are permitted in reports
   * (see PII-03 in the domain model); it is third-party contacts that are not.
   */
  staff?: Array<{ id: string; name: string }>;
  /**
   * Every agency the institution knows, not merely the ones on this trip.
   *
   * An organiser invented for an event is only recognisable as *wrong* against
   * the set of names that exist. Limited to this trip's agencies, the check can
   * see a missing name but not a substituted one -- and the substitution is the
   * failure that matters, because it reads as a fact.
   */
  agencies?: string[];
  /**
   * Lead figures already aggregated by the app, from `computeLeadMetrics`.
   *
   * Taken pre-computed rather than recomputed here on purpose: the report and
   * the checker must agree on what a lead *is*, and the only way to guarantee
   * that is for both to read the same function. Reimplementing the mapping in
   * this file would produce a checker that disagrees with the app for reasons
   * that are nobody's bug.
   *
   * Absent when the tenant has not mapped its form yet — the breakdowns are
   * then simply not supplied, and BRK-01..03 have nothing to check.
   */
  leads?: {
    total: number;
    byLevel: Record<string, number>;
    topCourses: Array<{ course: string; count: number }>;
  } | null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const MONTHS =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b|\b(19|20)\d{2}\b/gi;

/**
 * An event title with the month and year taken out.
 *
 * Activity titles carry the period because that is how they are told apart in a
 * list: "Global Study UK - Cairo June 2026". A report does the opposite and
 * should -- it names the event once and gives the real dates in a column, so it
 * writes "Global Study UK — Cairo". Requiring the raw title verbatim reports a
 * correct, better-written report as having omitted the event.
 *
 * Supplied as an alias, never as the label, so a finding still quotes the title
 * as it appears in the app.
 */
function withoutPeriod(title: string): string {
  return title.replace(MONTHS, " ").replace(/\s+/g, " ").replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
}

/**
 * The branch half of an activity title like "Global Study - Zamalek Office".
 *
 * Returns null when the title is not of that shape -- "School visits", or a
 * fair title that merely mentions the agency. Only a title that *starts* with
 * the agency name and a dash is treated as naming its branch, so a sentence
 * that happens to contain the name does not contribute a phantom branch.
 */
function branchInTitle(title: string, agency: string): string | null {
  const t = (title ?? "").trim();
  const a = agency.trim();
  if (!t || !a || t.length <= a.length) return null;
  if (t.slice(0, a.length).toLowerCase() !== a.toLowerCase()) return null;
  const rest = t.slice(a.length);
  const m = rest.match(/^[ \t]*[-–—][ \t]*(.+)$/);
  const branch = m?.[1]?.trim();
  return branch ? branch : null;
}

/** Same event, same section, one thing to say. Multi-day fairs are separate rows. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Activity types that record a person going somewhere, so can be misattributed. */
const VISIT_TYPES = new Set(["agent_visit", "school_visit", "recruitment_event"]);

/**
 * Section names from the app's own report format.
 *
 * A university template uses different headings, and the engine handles that by
 * falling back to the whole document when the named section is not there --
 * so a scoped entity is never reported missing merely because our heading is.
 */
const ENGAGEMENTS = "Key Agent & School Engagements";
const EVENT_OUTCOMES = "Recruitment Event Outcomes";

export function toSourceFacts(input: OrbisTripInput): SourceFacts {
  const entities: Entity[] = [];
  const links: LinkFact[] = [];
  const attributions: Attribution[] = [];
  const organiserOf: Attribution[] = [];
  // Every agency this trip touched: the set an invented organiser is spotted
  // against. Without it the check can only see that the right name is absent.
  const agencyNames = Array.from(
    new Set(
      input.activities
        .map((a) => a.agents?.trading_name?.trim() || a.manual_agent?.trim() || "")
        .filter(Boolean),
    ),
  );
  const organiserCandidates = (input.agencies?.length ? input.agencies : agencyNames)
    .map((n) => n.trim())
    .filter(Boolean);
  const staffNames = (input.staff ?? []).map((s) => s.name.trim()).filter(Boolean);
  const staffById = new Map((input.staff ?? []).map((s) => [s.id, s.name.trim()]));

  for (const country of input.trip.destinations ?? []) {
    if (country?.trim()) entities.push({ id: `country:${country}`, kind: "country", label: country });
  }

  let hasSchoolVisit = false;

  for (const a of input.activities) {
    // An agent can be attached to any activity type, not just an agent visit —
    // a school visit is often arranged by an agent, and the app links that
    // agent's card from it. Keying off type missed those and made the checker
    // call a perfectly real link invented.
    //
    // An agent visit has to be written up where a reader goes looking for it.
    // Named once in the summary and absent from the engagements section, the
    // visit is effectively missing -- COV-03 in the domain model.
    const visitSection = a.type === "agent_visit" ? ENGAGEMENTS : undefined;

    const linked = a.agents?.trading_name?.trim();
    if (linked && a.agent_id) {
      entities.push({ id: `agent:${a.agent_id}`, kind: "agent", label: linked, section: visitSection });
      links.push({
        href: `/agents/${a.agent_id}`,
        label: linked,
        // Only an agent visit is *required* to carry the link; elsewhere it is
        // permitted but not expected.
        required: a.type === "agent_visit",
      });
    } else if (a.manual_agent?.trim()) {
      // Free-typed: no record, so no card and no link. Its absence from the
      // report's links is correct, not a defect — hence mustAppear stays true
      // for the name but no LinkFact is created.
      entities.push({
        id: `agent:manual:${a.id}`,
        kind: "agent",
        label: a.manual_agent.trim(),
        section: visitSection,
      });
    }

    // Who organised this event -- ORG-01, and no new check needed for it. An
    // organiser is an attribution like any other: a claim about who was
    // responsible, checkable against a record that either names one or does
    // not. Where the record names nobody, a report that credits an organiser
    // anyway has invented one, which is the half of ORG-01 that matters.
    if (a.type === "recruitment_event" && a.title?.trim() && organiserCandidates.length) {
      organiserOf.push({
        subject: a.title.trim(),
        relation: "organising",
        aliases: withoutPeriod(a.title) !== a.title.trim() ? [withoutPeriod(a.title)] : undefined,
        expected: a.agents?.trading_name?.trim() || a.manual_agent?.trim() || null,
        candidates: organiserCandidates,
      });
    }

    // Who made this visit, if the report says at all. The subject is whatever
    // the report would call the visit: the agency, the school, the event.
    if (staffNames.length && VISIT_TYPES.has(a.type)) {
      const subject =
        a.agents?.trading_name?.trim() ||
        a.manual_agent?.trim() ||
        a.schools?.name?.trim() ||
        a.title?.trim();
      if (subject) {
        attributions.push({
          subject,
          relation: "the visit to",
          expected: a.visited_by ? (staffById.get(a.visited_by) ?? null) : null,
          candidates: staffNames,
        });
      }
    }

    // Deliberately NOT registering the branch city as somewhere the report must
    // mention: an agency office in Ho Chi Minh City is not a place this trip
    // went, and requiring it made the checker demand cities nobody visited.

    if (a.type === "school_visit" && a.schools?.name?.trim()) {
      hasSchoolVisit = true;
      entities.push({
        id: `school:${slug(a.schools.name.trim())}`,
        kind: "school",
        label: a.schools.name.trim(),
        section: ENGAGEMENTS,
      });
    }

    // Every recruitment event has to reach the outcomes section -- COV-04. A
    // fair that happened and went unreported is the most expensive omission
    // here: it is where the leads came from.
    if (a.type === "recruitment_event" && a.title?.trim()) {
      const title = a.title.trim();
      const shortened = withoutPeriod(title);
      entities.push({
        // Keyed by name, not by activity: a three-day fair is three rows in the
        // app and one event in the report, and saying so three times is noise.
        id: `event:${slug(shortened || title)}`,
        kind: "recruitment event",
        label: title,
        aliases: shortened && shortened.toLowerCase() !== title.toLowerCase() ? [shortened] : undefined,
        section: EVENT_OUTCOMES,
      });
    }
  }

  // Schools have no per-record page: the app links them all to the directory,
  // so /schools is a legitimate destination whenever a school was visited.
  if (hasSchoolVisit) links.push({ href: "/schools", label: "Schools directory" });

  // Cost categories, matching how Orbis reports them: travel, hotels, and
  // everything else under Events. Every costed activity lands in exactly one,
  // so the three always sum to Total — which FIG-02 then enforces.
  let travel = 0;
  let events = 0;
  let hotelTotal = 0;
  for (const a of input.activities) {
    const cost = num(a.cost);
    if (cost == null) continue;
    if (a.type === "travel") travel += cost;
    else events += cost;
  }
  for (const h of input.hotels) {
    const cost = num(h.cost);
    if (cost != null) hotelTotal += cost;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const figures: Figure[] = [
    { id: "travel", label: "Travel", value: round(travel), currency: input.accountCurrency, partOfTotal: "total" },
    { id: "hotels", label: "Hotels", value: round(hotelTotal), currency: input.accountCurrency, partOfTotal: "total" },
    { id: "events", label: "Events", value: round(events), currency: input.accountCurrency, partOfTotal: "total" },
    { id: "total", label: "Total", value: round(travel + hotelTotal + events), currency: input.accountCurrency },
  ];

  // Any currency actually stored on a row that is not the account currency is
  // itself a finding — CUR-01 reports it from here.
  for (const row of [...input.activities, ...input.hotels]) {
    const cur = (row as { cost_currency?: string | null }).cost_currency;
    if (cur && cur.toUpperCase() !== input.accountCurrency.toUpperCase()) {
      figures.push({
        id: `foreign:${cur}`,
        label: `A cost stored in ${cur}`,
        value: 0,
        currency: cur,
      });
    }
  }

  const forbidden = new Set<string>();
  for (const c of input.contacts) {
    const full = [c.contact_first_name, c.contact_last_name].filter(Boolean).join(" ").trim();
    for (const v of [full, c.contact_name, c.contact_email, c.email, c.contact_phone, c.phone]) {
      if (v && v.trim().length > 2) forbidden.add(v.trim());
    }
  }

  // Counts a report may assert about itself. Phrases are how a writer would
  // actually word them; CNT-01 only fires when a number sits right before one.
  const countOf = (t: string) => input.activities.filter((a) => a.type === t).length;
  const counts = [
    { label: "travel legs", value: countOf("travel"), aliases: ["sectors", "flights", "sectors of air travel"] },
    { label: "agent visits", value: countOf("agent_visit"), aliases: ["agent engagements", "agent meetings"] },
    { label: "school visits", value: countOf("school_visit"), aliases: ["schools visited"] },
    { label: "recruitment events", value: countOf("recruitment_event"), aliases: ["fair days"] },
    // COV-05: the prompt asks the Trip Overview table for a "total activities"
    // field. Scoped to that section, not the whole report -- an unrelated use
    // of the word "activities" elsewhere (a sentence in the summary, say)
    // is not a claim about this number. sectionScope() falls back to the
    // whole document if a template does not use this exact heading, so a
    // renamed section loses precision rather than losing the check.
    {
      label: "activities",
      value: input.activities.length,
      aliases: ["total activities"],
      section: "Trip Overview",
    },
  ];

  // Lead figures: the whole, the study-level split, the course ranking.
  //
  // Scoped to the outcomes section because the report also prints a per-event
  // "Leads captured" line, and an unscoped total would read one event's figure
  // as a claim about the trip. Per-event verification needs each event under
  // its own heading before it can be scoped — until then this checks the
  // trip-level figures, which is where the contradiction appeared.
  const breakdowns: Breakdown[] = [];
  const leads = input.leads;
  if (leads) {
    const levelAliases: Record<string, string[]> = {
      UG: ["undergraduate"],
      PGT: ["postgraduate taught", "postgraduate"],
      Other: ["unspecified", "not stated"],
    };
    breakdowns.push({
      id: "leads-by-level",
      label: "leads by study level",
      section: "Recruitment Event Outcomes",
      totalLabel: "total leads captured",
      totalAliases: ["total leads"],
      total: leads.total,
      parts: Object.entries(leads.byLevel).map(([level, value]) => ({
        label: level,
        value,
        aliases: levelAliases[level] ?? [],
        // "Other" is students who chose "not sure yet". A report that leaves
        // that group out is not wrong, so its absence must not be a finding.
        mustAppear: level !== "Other",
      })),
    });

    if (leads.topCourses.length) {
      breakdowns.push({
        id: "leads-by-course",
        label: "most demanded courses",
        section: "Recruitment Event Outcomes",
        ranked: true,
        parts: leads.topCourses.map((c) => ({ label: c.course, value: c.count })),
      });
    }
  }

  // Where the trip said it was going, against where its activities actually
  // were. The two are entered separately and nothing keeps them in step, so a
  // cancelled country sits in `destinations` for ever and a country nobody
  // declared can quietly acquire a week of visits.
  //
  // A trip whose activities record no country at all produces no comparison:
  // an empty observed list would otherwise flag every declared country as
  // never visited, on a trip where the truth is simply that nobody filled the
  // field in. A checker that fires on missing data teaches people to ignore it.
  const declarations: Declaration[] = [];
  const declaredCountries = (input.trip.destinations ?? [])
    .map((c) => c?.trim())
    .filter((c): c is string => Boolean(c));
  // Home is not a destination. In practice only travel legs carry a country,
  // and every trip ends with a flight back -- so counting them naively reports
  // "work was recorded in the United Kingdom, which was never declared" on
  // essentially every trip. Found by running this against the four real trips
  // rather than against fixtures, which agreed with me.
  //
  // The trip departs from home and returns to it, so both ends are taken:
  // the same trip really does record "UK" outbound and "United Kingdom" home,
  // and only excluding both keeps the check quiet.
  // Only legs that actually cross a border count. A domestic hop recorded as
  // Turkey-to-Turkey is not the journey home, and on a real trip one of those
  // shares the last day with the flight back.
  const moves = input.activities
    .filter((a) => {
      const from = a.from_country?.trim();
      const to = a.to_country?.trim();
      return from && to && normaliseName(from) !== normaliseName(to);
    })
    .slice()
    .sort((x, y) => (x.day_date ?? "").localeCompare(y.day_date ?? ""));

  const home = new Set<string>();
  // Wherever the trip set out from is home.
  const origin = moves[0]?.from_country?.trim();
  if (origin) home.add(normaliseName(origin));
  // And wherever it ended up, but only once it has come back from somewhere.
  // A trip with a single outbound leg -- one being planned, or a report
  // generated before the return flight is entered -- would otherwise have its
  // destination taken for home and be reported as never visited.
  if (moves.length > 1) {
    const arrival = moves[moves.length - 1]?.to_country?.trim();
    if (arrival) home.add(normaliseName(arrival));
  }

  const observedCountries = input.activities
    .flatMap((a) => [
      a.to_country,
      a.from_country,
      a.schools?.country,
      a.agent_branches?.country,
    ])
    .map((c) => c?.trim())
    .filter((c): c is string => Boolean(c))
    .filter((c) => !home.has(normaliseName(c)));

  if (declaredCountries.length && observedCountries.length) {
    declarations.push({
      kind: "destination country",
      declared: declaredCountries,
      observed: observedCountries,
      where: "the trip's destinations",
    });
  }

  // COV-02: every city the trip actually visited must be mentioned somewhere
  // in the report. Same shape of trap as the country check, so the same fix:
  // a city move is only real when the two ends actually differ (Cairo to
  // Alexandria is a real leg on a domestic flight; Cairo to Cairo is not one),
  // and home -- wherever the first leg set out from, and wherever the last one
  // returned to -- is excluded, or a report that never repeats its own airport
  // city reads as though it skipped a place it never went.
  //
  // Unlike the branch a report names, a city is not safely readable out of a
  // free-typed activity title: "Global Study - Sheraton Office" names a hotel,
  // "AHZ - New Cairo" names a Cairo district, neither is literally the word
  // "Cairo". Guessing which titles contain a city name would invent facts the
  // source does not structurally have -- exactly the mistake QUAL-01 exists to
  // catch elsewhere. So this only ever reports a city the source recorded in a
  // real field: a travel leg's own city columns, or a linked branch's or
  // school's city. An agent visit whose branch was never linked contributes
  // nothing here, same as it contributes nothing to QUAL-01's branch check.
  const cityMoves = input.activities
    .filter((a) => {
      const from = a.from_city?.trim();
      const to = a.to_city?.trim();
      return from && to && normaliseName(from) !== normaliseName(to);
    })
    .slice()
    .sort((x, y) => (x.day_date ?? "").localeCompare(y.day_date ?? ""));

  const homeCities = new Set<string>();
  const cityOrigin = cityMoves[0]?.from_city?.trim();
  if (cityOrigin) homeCities.add(normaliseName(cityOrigin));
  if (cityMoves.length > 1) {
    const cityArrival = cityMoves[cityMoves.length - 1]?.to_city?.trim();
    if (cityArrival) homeCities.add(normaliseName(cityArrival));
  }

  const citySeen = new Set<string>();
  for (const raw of input.activities.flatMap((a) => [
    a.to_city,
    a.from_city,
    a.schools?.city,
    a.agent_branches?.city,
  ])) {
    const city = raw?.trim();
    if (!city) continue;
    const key = normaliseName(city);
    if (!key || homeCities.has(key) || citySeen.has(key)) continue;
    citySeen.add(key);
    // Warning, not error: found on the real Morocco trip, where the data
    // holds both "Casablanca" and "Casablanaca" -- almost certainly a typo,
    // not two places. A report that correctly writes the real spelling would
    // otherwise be told it omitted the misspelling, which blames the report
    // for a mistake in the source it has no way to fix.
    entities.push({
      id: `city:${slug(city)}`,
      kind: "city",
      label: city,
      checkId: "COV-02",
      severity: "warning",
    });
  }

  // Every branch this trip actually records for each agency, so a branch the
  // report attaches to one is checkable. The report prompt used to require
  // "Agency - Branch" titles while the branch was never in the context, so the
  // model invented them; they read as fact and nothing could contradict them.
  //
  // An agency that appears on the trip with no branch recorded still gets an
  // entry with an empty list -- "the record gives it none" is a finding, not a
  // reason to skip. That is the exact case that produced the invented names.
  const branchesByAgency = new Map<string, Set<string>>();
  for (const a of input.activities) {
    const agency = a.agents?.trading_name?.trim();
    if (!agency) continue;
    if (!branchesByAgency.has(agency)) branchesByAgency.set(agency, new Set());
    const branch = a.agent_branches?.branch_name?.trim();
    if (branch) branchesByAgency.get(agency)!.add(branch);

    // The activity's own title counts as a record of the branch, because in
    // this app it is one. `branch_id` is null on most real activities while
    // the title still reads "Global Study - Zamalek Office", and the trip UI
    // composes that title deliberately; the domain model calls it the
    // authoritative source and has the report reproduce it verbatim.
    //
    // Taking only the linked row would report about twenty correct titles per
    // trip as invented -- found by running this against the live database
    // before trusting it.
    const fromTitle = branchInTitle(a.title, agency);
    if (fromTitle) branchesByAgency.get(agency)!.add(fromTitle);
  }
  const qualifiers: Qualifier[] = [...branchesByAgency].map(([subject, branches]) => ({
    subject,
    kind: "branch",
    permitted: [...branches],
  }));

  const seen = new Set<string>();
  return {
    period: { start: input.trip.start_date, end: input.trip.end_date },
    entities: entities.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))),
    figures,
    links,
    forbidden: Array.from(forbidden),
    counts,
    attributions: [...attributions, ...organiserOf],
    breakdowns,
    declarations,
    qualifiers,
  };
}
