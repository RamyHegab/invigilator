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
