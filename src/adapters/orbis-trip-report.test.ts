import { describe, it, expect } from "vitest";
import { toSourceFacts, type OrbisTripInput } from "./orbis-trip-report.js";

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
