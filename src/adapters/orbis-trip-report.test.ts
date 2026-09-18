import { describe, it, expect } from "vitest";
import { toSourceFacts, type OrbisTripInput } from "./orbis-trip-report.js";
import { declaredButUnused, usedButUndeclared } from "../checks/scope.js";

/**
 * The adapter decides what counts as a legitimate link. Getting that wrong
 * makes the checker accuse the app of inventing links it was given — which is
 * exactly what happened on the first live run.
 */
const input = (activities: any[]): OrbisTripInput => ({
  trip: { start_date: "2026-03-01", end_date: "2026-03-10", destinations: ["Egypt"] },
  activities,
  hotels: [],
  contacts: [],
  accountCurrency: "GBP",
});

describe("agent links", () => {
  it("accepts an agent link on a school visit the agent arranged", () => {
    const facts = toSourceFacts(
      input([
        {
          id: "a1",
          type: "school_visit",
          title: "Visit Cairo International School",
          agent_id: "agent-1",
          agents: { trading_name: "Edvoy" },
          schools: { name: "Cairo International School" },
        },
      ]),
    );
    expect(facts.links.map((l) => l.href)).toContain("/agents/agent-1");
  });

  it("requires the link only on an agent visit", () => {
    const facts = toSourceFacts(
      input([
        { id: "a1", type: "agent_visit", title: "Edvoy — Cairo", agent_id: "a", agents: { trading_name: "Edvoy" } },
        { id: "a2", type: "other", title: "Debrief", agent_id: "b", agents: { trading_name: "Nile" } },
      ]),
    );
    expect(facts.links.find((l) => l.href === "/agents/a")?.required).toBe(true);
    expect(facts.links.find((l) => l.href === "/agents/b")?.required).toBeFalsy();
  });

  it("creates no link for a free-typed agent", () => {
    const facts = toSourceFacts(
      input([{ id: "a1", type: "agent_visit", title: "Typed Agency", manual_agent: "Typed Agency" }]),
    );
    expect(facts.links).toHaveLength(0);
    expect(facts.entities.some((e) => e.label === "Typed Agency")).toBe(true);
  });
});

describe("school directory link", () => {
  it("allows /schools when a school was visited", () => {
    const facts = toSourceFacts(
      input([{ id: "a1", type: "school_visit", title: "Visit X", schools: { name: "School X" } }]),
    );
    expect(facts.links.map((l) => l.href)).toContain("/schools");
  });

  it("does not allow /schools when no school was visited", () => {
    const facts = toSourceFacts(input([{ id: "a1", type: "travel", title: "Flight" }]));
    expect(facts.links.map((l) => l.href)).not.toContain("/schools");
  });
});

describe("third-party addresses the app holds (PII-04)", () => {
  it("collects every address held for the branches, schools and head offices on the trip", () => {
    const facts = toSourceFacts(
      input([
        { id: "a1", type: "agent_visit", title: "Edvoy - Cairo", agent_id: "e", agents: { trading_name: "Edvoy", hq_address: "1 Baker Street, London NW1 6XE" }, agent_branches: { formatted_address: "Zamalek, Cairo, Egypt 11211", address: "12 Sarayat El Gezira, Zamalek" } },
        { id: "a2", type: "school_visit", title: "School", schools: { formatted_address: "6 October City, Giza, Egypt" } },
      ]),
    );
    expect(facts.addresses).toEqual(
      expect.arrayContaining([
        "1 Baker Street, London NW1 6XE",
        "Zamalek, Cairo, Egypt 11211",
        "12 Sarayat El Gezira, Zamalek",
        "6 October City, Giza, Egypt",
      ]),
    );
    expect(facts.addresses).toHaveLength(4);
  });

  it("holds each address once however many activities share it", () => {
    const same = { formatted_address: "Zamalek, Cairo, Egypt 11211" };
    const facts = toSourceFacts(
      input([
        { id: "a1", type: "agent_visit", title: "A", agent_branches: same },
        { id: "a2", type: "agent_visit", title: "B", agent_branches: same },
      ]),
    );
    expect(facts.addresses).toEqual(["Zamalek, Cairo, Egypt 11211"]);
  });

  it("ignores blank addresses", () => {
    const facts = toSourceFacts(
      input([{ id: "a1", type: "agent_visit", title: "A", agent_branches: { address: "   ", formatted_address: null } }]),
    );
    expect(facts.addresses).toEqual([]);
  });

  it("does not treat a hotel as somebody's contact address", () => {
    const facts = toSourceFacts({ ...input([]), hotels: [{ cost: 100, address: "1 Hotel Road" } as any] });
    expect(facts.addresses).toEqual([]);
  });
});

describe("multi-day activities (DATE-03)", () => {
  it("supplies a span for an activity whose end_date is genuinely later", () => {
    const facts = toSourceFacts(
      input([
        {
          id: "a1",
          type: "recruitment_event",
          title: "GSUK Cairo Fair October 2026",
          day_date: "2026-10-15",
          end_date: "2026-10-17",
        },
      ]),
    );
    expect(facts.dateSpans).toEqual([
      {
        subject: "GSUK Cairo Fair",
        kind: "event",
        start: "2026-10-15",
        end: "2026-10-17",
        section: "Recruitment Event Outcomes",
      },
    ]);
  });

  it("scopes an agent visit to the engagements section, like its entity", () => {
    const facts = toSourceFacts(
      input([
        {
          id: "a1",
          type: "agent_visit",
          title: "Edvoy Conference",
          agent_id: "a",
          agents: { trading_name: "Edvoy" },
          day_date: "2026-10-15",
          end_date: "2026-10-16",
        },
      ]),
    );
    expect(facts.dateSpans![0]!.section).toBe("Key Agent & School Engagements");
  });

  it("says nothing for an activity with no end_date at all", () => {
    const facts = toSourceFacts(
      input([{ id: "a1", type: "recruitment_event", title: "Fair", day_date: "2026-10-15" }]),
    );
    expect(facts.dateSpans).toEqual([]);
  });

  it("says nothing when end_date equals day_date -- not a real span", () => {
    const facts = toSourceFacts(
      input([
        { id: "a1", type: "recruitment_event", title: "Fair", day_date: "2026-10-15", end_date: "2026-10-15" },
      ]),
    );
    expect(facts.dateSpans).toEqual([]);
  });

  it("says nothing when end_date is before day_date -- bad data, not this check's job", () => {
    const facts = toSourceFacts(
      input([
        { id: "a1", type: "recruitment_event", title: "Fair", day_date: "2026-10-17", end_date: "2026-10-15" },
      ]),
    );
    expect(facts.dateSpans).toEqual([]);
  });
});

describe("total activity count (COV-05)", () => {
  it("counts every activity on the trip, whatever its type", () => {
    const facts = toSourceFacts(
      input([
        { id: "a1", type: "travel", title: "Flight" },
        { id: "a2", type: "agent_visit", title: "Visit" },
        { id: "a3", type: "resting_day", title: "Weekend" },
      ]),
    );
    const total = facts.counts!.find((c) => c.label === "activities");
    expect(total?.value).toBe(3);
  });

  it("scopes the total to the Trip Overview section", () => {
    const facts = toSourceFacts(input([{ id: "a1", type: "travel", title: "Flight" }]));
    expect(facts.counts!.find((c) => c.label === "activities")?.section).toBe("Trip Overview");
  });

  it("is zero on a trip with no activities yet, not absent", () => {
    // Absent would make CNT-01 skip the count entirely; a trip newly created
    // and correctly reporting zero activities is a real, checkable claim.
    const facts = toSourceFacts(input([]));
    expect(facts.counts!.find((c) => c.label === "activities")?.value).toBe(0);
  });
});

describe("cost categories", () => {
  it("puts every non-travel cost under Events so the parts sum to the total", () => {
    const facts = toSourceFacts(
      input([
        { id: "a1", type: "travel", title: "Flight", cost: 100 },
        { id: "a2", type: "agent_visit", title: "Visit", cost: 50 },
        { id: "a3", type: "other", title: "Misc", cost: 25 },
      ]),
    );
    const v = (id: string) => facts.figures.find((f) => f.id === id)!.value;
    expect(v("travel")).toBe(100);
    expect(v("events")).toBe(75);
    expect(v("travel") + v("hotels") + v("events")).toBe(v("total"));
  });
});

describe("declared destinations against where activities happened", () => {
  const trip = (destinations: string[], activities: any[]): OrbisTripInput => ({
    trip: { start_date: "2026-03-01", end_date: "2026-03-10", destinations },
    activities,
    hotels: [],
    contacts: [],
    accountCurrency: "GBP",
  });

  it("takes the country from the activity, the school and the branch alike", () => {
    const facts = toSourceFacts(
      trip(
        ["Egypt", "Morocco", "Algeria"],
        [
          { id: "a1", type: "other", title: "Flight", to_country: "Egypt" },
          { id: "a2", type: "school_visit", title: "School", schools: { country: "Morocco" } },
          {
            id: "a3",
            type: "agent_visit",
            title: "Agent",
            agent_branches: { country: "Algeria" },
          },
        ],
      ),
    );
    const d = facts.declarations?.[0];
    expect(d?.kind).toBe("destination country");
    expect(d?.observed).toEqual(
      expect.arrayContaining(["Egypt", "Morocco", "Algeria"]),
    );
  });

  it("supplies the comparison when the two disagree", () => {
    const facts = toSourceFacts(
      trip(["Egypt", "Algeria"], [{ id: "a1", type: "other", title: "Flight", to_country: "Egypt" }]),
    );
    expect(facts.declarations).toHaveLength(1);
    expect(facts.declarations![0]!.declared).toEqual(["Egypt", "Algeria"]);
    expect(facts.declarations![0]!.observed).toEqual(["Egypt"]);
  });

  // The guard that stops this check firing on trips where nobody filled in a
  // country -- which is most of them. Without it, every declared destination
  // would be reported as never visited, and the finding would be the
  // checker's fault rather than the trip's.
  it("says nothing when no activity records a country anywhere", () => {
    const facts = toSourceFacts(
      trip(["Egypt", "Algeria"], [{ id: "a1", type: "other", title: "Debrief" }]),
    );
    expect(facts.declarations).toEqual([]);
  });

  it("says nothing when the trip declared no destinations", () => {
    const facts = toSourceFacts(
      trip([], [{ id: "a1", type: "other", title: "Flight", to_country: "Egypt" }]),
    );
    expect(facts.declarations).toEqual([]);
  });

  it("ignores blank and whitespace-only country fields", () => {
    const facts = toSourceFacts(
      trip(
        ["Egypt", "  "],
        [
          { id: "a1", type: "other", title: "Flight", to_country: "Egypt" },
          { id: "a2", type: "other", title: "Transfer", to_country: "   " },
        ],
      ),
    );
    expect(facts.declarations![0]!.declared).toEqual(["Egypt"]);
    expect(facts.declarations![0]!.observed).toEqual(["Egypt"]);
  });
});

describe("home is not a destination", () => {
  const trip = (destinations: string[], activities: any[]): OrbisTripInput => ({
    trip: { start_date: "2026-09-12", end_date: "2026-09-20", destinations },
    activities,
    hotels: [],
    contacts: [],
    accountCurrency: "GBP",
  });

  // The shape of all four real trips: out on the first day, back on the last.
  // Counting the return leg reported "work was recorded in the United Kingdom,
  // which was never declared" on essentially every trip.
  const outAndBack = [
    { id: "t1", type: "travel", title: "Fly out", day_date: "2026-09-12", from_country: "UK", to_country: "Egypt" },
    { id: "t2", type: "travel", title: "Fly home", day_date: "2026-09-20", from_country: "Egypt", to_country: "United Kingdom" },
  ];

  it("leaves out the country the trip departs from and returns to", () => {
    const facts = toSourceFacts(trip(["Egypt"], outAndBack));
    expect(facts.declarations![0]!.observed).toEqual(["Egypt", "Egypt"]);
  });

  // A real trip records "UK" outbound and "United Kingdom" home. Excluding
  // only one end leaves the other to be reported as an undeclared country.
  it("excludes both spellings when the two ends are typed differently", () => {
    const observed = toSourceFacts(trip(["Egypt"], outAndBack)).declarations![0]!.observed;
    expect(observed.some((c) => c.toLowerCase().includes("king"))).toBe(false);
    expect(observed).not.toContain("UK");
  });

  it("orders by date rather than trusting the order rows arrive in", () => {
    const facts = toSourceFacts(trip(["Egypt"], [outAndBack[1], outAndBack[0]] as any[]));
    expect(facts.declarations![0]!.observed).toEqual(["Egypt", "Egypt"]);
  });

  it("still counts a country that is worked in as well as flown through", () => {
    const facts = toSourceFacts(
      trip(
        ["Egypt", "Morocco"],
        [
          ...outAndBack,
          { id: "a1", type: "agent_visit", title: "Casablanca", day_date: "2026-09-15", agent_branches: { country: "Morocco" } },
        ],
      ),
    );
    expect(facts.declarations![0]!.observed).toEqual(expect.arrayContaining(["Egypt", "Morocco"]));
  });

  // A domestic trip never crosses a border, so nothing is treated as home and
  // the declared country is observed like any other. What matters is that the
  // checks stay quiet -- the two sides agree.
  it("says nothing about a trip that never leaves home", () => {
    const facts = toSourceFacts(
      trip(["United Kingdom"], [
        { id: "t1", type: "travel", title: "Train", day_date: "2026-09-12", from_country: "United Kingdom", to_country: "United Kingdom" },
      ]),
    );
    const ctx = { config: { appId: "orbis", sections: [] }, facts, artifact: "" } as any;
    expect([...declaredButUnused.run(ctx), ...usedButUndeclared.run(ctx)]).toEqual([]);
  });

  // The whole point, end to end: the real trips' out-and-back shape produces
  // no finding, and a country genuinely outside the declared scope does.
  it("stays quiet on a real out-and-back trip, and speaks up on scope creep", () => {
    const quiet = toSourceFacts(trip(["Egypt"], outAndBack));
    const ctx = (facts: any) =>
      ({ config: { appId: "orbis", sections: [] }, facts, artifact: "" }) as any;
    expect([
      ...declaredButUnused.run(ctx(quiet)),
      ...usedButUndeclared.run(ctx(quiet)),
    ]).toEqual([]);

    const crept = toSourceFacts(
      trip(["Egypt"], [
        ...outAndBack,
        { id: "a1", type: "agent_visit", title: "Casablanca", day_date: "2026-09-15", agent_branches: { country: "Morocco" } },
      ]),
    );
    const findings = usedButUndeclared.run(ctx(crept));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.summary).toContain("Morocco");
  });
});

describe("branches a report may name", () => {
  const trip = (activities: any[]): OrbisTripInput => ({
    trip: { start_date: "2026-09-12", end_date: "2026-09-20", destinations: ["Egypt"] },
    activities,
    hotels: [],
    contacts: [],
    accountCurrency: "GBP",
  });

  const permitted = (facts: any, subject: string) =>
    facts.qualifiers.find((q: any) => q.subject === subject)?.permitted ?? [];

  // Real rows from the live database. Most activities have no linked branch
  // record while their title still names one, and the trip UI composes that
  // title on purpose -- the domain model calls it the authoritative source.
  // Reading only the linked row reported about twenty correct titles per trip
  // as invented.
  it("takes the branch from the title when no branch row is linked", () => {
    const facts = toSourceFacts(
      trip([
        { id: "a1", type: "agent_visit", title: "Global Study — Zamalek Office", agent_id: "g", agents: { trading_name: "Global Study" } },
        { id: "a2", type: "agent_visit", title: "Global Study — Maadi Office", agent_id: "g", agents: { trading_name: "Global Study" } },
      ]),
    );
    expect(permitted(facts, "Global Study")).toEqual(["Zamalek Office", "Maadi Office"]);
  });

  it("takes the linked branch row as well", () => {
    const facts = toSourceFacts(
      trip([
        { id: "a1", type: "agent_visit", title: "Academix — Taksim Ofisi", agent_id: "a", agents: { trading_name: "Academix" }, agent_branches: { branch_name: "Ankara Ofisi" } },
      ]),
    );
    expect(permitted(facts, "Academix")).toEqual(expect.arrayContaining(["Ankara Ofisi", "Taksim Ofisi"]));
  });

  it("keeps a branch name that itself contains a dash", () => {
    const facts = toSourceFacts(
      trip([
        { id: "a1", type: "agent_visit", title: "ICAN — IDP - Istanbul Office", agent_id: "i", agents: { trading_name: "ICAN" } },
      ]),
    );
    expect(permitted(facts, "ICAN")).toEqual(["IDP - Istanbul Office"]);
  });

  it("handles an agency whose own name contains a dash", () => {
    const facts = toSourceFacts(
      trip([
        { id: "a1", type: "agent_visit", title: "SI-UK — Istanbul branch", agent_id: "s", agents: { trading_name: "SI-UK" } },
      ]),
    );
    expect(permitted(facts, "SI-UK")).toEqual(["Istanbul branch"]);
  });

  // "School visits" and "GSUK Morocco Fair - OCT 2026 - Tangier" are both real
  // titles on an agency's activities. Neither names a branch, and reading a
  // branch out of them would invent one to check against.
  it("reads no branch from a title that does not begin with the agency", () => {
    const facts = toSourceFacts(
      trip([
        { id: "a1", type: "recruitment_event", title: "GSUK Morocco Fair - OCT 2026 - Tangier", agent_id: "g", agents: { trading_name: "Global Study" } },
        { id: "a2", type: "agent_visit", title: "School visits", agent_id: "g", agents: { trading_name: "Global Study" } },
      ]),
    );
    expect(permitted(facts, "Global Study")).toEqual([]);
  });

  it("still lists an agency with no branch at all, so an invented one is caught", () => {
    const facts = toSourceFacts(
      trip([{ id: "a1", type: "agent_visit", title: "School visits", agent_id: "g", agents: { trading_name: "Global Study" } }]),
    );
    expect(facts.qualifiers!.map((q) => q.subject)).toContain("Global Study");
  });
});

describe("cities the trip actually visited (COV-02)", () => {
  const trip = (activities: any[]): OrbisTripInput => ({
    trip: { start_date: "2026-09-12", end_date: "2026-09-20", destinations: ["Egypt"] },
    activities,
    hotels: [],
    contacts: [],
    accountCurrency: "GBP",
  });

  const cities = (facts: any) =>
    facts.entities.filter((e: any) => e.kind === "city").map((e: any) => e.label).sort();

  // The real shape: home airport out, a domestic city-to-city leg in the
  // middle, home airport back. Cairo and Alexandria are both real visits;
  // Manchester is the airport at both ends and is not one.
  const realTrip = [
    { id: "t1", type: "travel", title: "Fly out", day_date: "2026-09-12", from_city: "Manchester", to_city: "Cairo" },
    { id: "t2", type: "travel", title: "Domestic", day_date: "2026-09-15", from_city: "Cairo", to_city: "Alexandria" },
    { id: "t3", type: "travel", title: "Fly home", day_date: "2026-09-20", from_city: "Alexandria", to_city: "Manchester" },
  ];

  it("lists a city the trip actually moved through, leaving out the airport at both ends", () => {
    const facts = toSourceFacts(trip(realTrip));
    expect(cities(facts)).toEqual(["Alexandria", "Cairo"]);
  });

  it("takes a city from a linked school or branch record as well", () => {
    const facts = toSourceFacts(
      trip([
        { id: "a1", type: "school_visit", title: "Visit", schools: { city: "Luxor" } },
        { id: "a2", type: "agent_visit", title: "Visit", agent_branches: { city: "Aswan" } },
      ]),
    );
    expect(cities(facts)).toEqual(["Aswan", "Luxor"]);
  });

  // The trap QUAL-01 already taught: "Global Study - Sheraton Office" names a
  // hotel, "AHZ - New Cairo" names a district. Neither literally says "Cairo",
  // and guessing would invent a fact the source does not structurally have.
  it("reads no city out of a free-typed activity title", () => {
    const facts = toSourceFacts(
      trip([
        { id: "a1", type: "agent_visit", title: "Global Study — Sheraton Office", agent_id: "g", agents: { trading_name: "Global Study" } },
        { id: "a2", type: "agent_visit", title: "AHZ — New Cairo", agent_id: "a", agents: { trading_name: "AHZ" } },
      ]),
    );
    expect(cities(facts)).toEqual([]);
  });

  it("does not report a single outbound leg's destination as home", () => {
    // One leg only -- a trip still being planned. Cairo must not be swallowed
    // as though it were the airport at both ends.
    const facts = toSourceFacts(
      trip([{ id: "t1", type: "travel", title: "Fly out", day_date: "2026-09-12", from_city: "Manchester", to_city: "Cairo" }]),
    );
    expect(cities(facts)).toEqual(["Cairo"]);
  });

  // A city genuinely visited is reported even when the leg that shows it
  // trivially starts and ends there (an airport-to-hotel transfer, say) --
  // that is still a true fact. What must not happen is a same-city leg being
  // mistaken for a real border crossing when working out which city is home.
  it("still reports a city recorded on a same-city leg, and does not let that leg stand in for home", () => {
    const facts = toSourceFacts(
      trip([
        { id: "t1", type: "travel", title: "Transfer", day_date: "2026-09-13", from_city: "Cairo", to_city: "Cairo" },
        ...realTrip,
      ]),
    );
    // Manchester is still correctly excluded as home -- the same-city leg did
    // not confuse which leg is the real first crossing.
    expect(cities(facts)).toEqual(["Alexandria", "Cairo"]);
  });

  it("says nothing when no activity records a city anywhere", () => {
    const facts = toSourceFacts(trip([{ id: "a1", type: "other", title: "Debrief" }]));
    expect(cities(facts)).toEqual([]);
  });

  it("reports each city once even when several legs pass through it", () => {
    const facts = toSourceFacts(
      trip([
        ...realTrip,
        { id: "t4", type: "other", title: "Second Cairo stop", to_city: "Cairo" },
      ]),
    );
    expect(cities(facts)).toEqual(["Alexandria", "Cairo"]);
  });

  it("stamps a missing city as COV-02, not COV-01", () => {
    const facts = toSourceFacts(trip(realTrip));
    const cairo = facts.entities.find((e: any) => e.label === "Cairo");
    expect(cairo?.checkId).toBe("COV-02");
  });

  // Found by running this against the real Morocco trip, which has both
  // "Casablanca" and "Casablanaca" recorded -- almost certainly a typo, not
  // two places. A warning, not an error, so a misspelling in the source does
  // not read as the report's fault.
  it("reports a missing city as a warning, not an error", () => {
    const facts = toSourceFacts(trip(realTrip));
    expect(facts.entities.find((e: any) => e.label === "Cairo")?.severity).toBe("warning");
  });
});
