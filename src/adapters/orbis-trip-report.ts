import type { Entity, Figure, LinkFact, SourceFacts } from "../types.js";

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
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function toSourceFacts(input: OrbisTripInput): SourceFacts {
  const entities: Entity[] = [];
  const links: LinkFact[] = [];

  for (const country of input.trip.destinations ?? []) {
    if (country?.trim()) entities.push({ id: `country:${country}`, kind: "country", label: country });
  }

  let hasSchoolVisit = false;

  for (const a of input.activities) {
    // An agent can be attached to any activity type, not just an agent visit —
    // a school visit is often arranged by an agent, and the app links that
    // agent's card from it. Keying off type missed those and made the checker
    // call a perfectly real link invented.
    const linked = a.agents?.trading_name?.trim();
    if (linked && a.agent_id) {
      entities.push({ id: `agent:${a.agent_id}`, kind: "agent", label: linked });
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
      entities.push({ id: `agent:manual:${a.id}`, kind: "agent", label: a.manual_agent.trim() });
    }

    // Deliberately NOT registering the branch city as somewhere the report must
    // mention: an agency office in Ho Chi Minh City is not a place this trip
    // went, and requiring it made the checker demand cities nobody visited.

    if (a.type === "school_visit" && a.schools?.name?.trim()) {
      hasSchoolVisit = true;
      entities.push({ id: `school:${a.id}`, kind: "school", label: a.schools.name.trim() });
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
  ];

  const seen = new Set<string>();
  return {
    period: { start: input.trip.start_date, end: input.trip.end_date },
    entities: entities.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))),
    figures,
    links,
    forbidden: Array.from(forbidden),
    counts,
  };
}
