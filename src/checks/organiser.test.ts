import { describe, it, expect } from "vitest";
import { runChecks } from "../run.js";
import { toSourceFacts } from "../adapters/orbis-trip-report.js";
import type { AppConfig } from "../types.js";

/**
 * ORG-01, through the adapter rather than against a hand-written fact, because
 * the thing worth proving is that an organiser and a visitor are told apart.
 * They share a subject when an event has no organiser, and a wrong answer there
 * silently disables both checks at once.
 */
const config: AppConfig = { appId: "orbis", sections: [] };

const input = (over: Record<string, unknown> = {}) => ({
  trip: { start_date: "2026-07-17", end_date: "2026-08-01", destinations: ["Egypt"] },
  hotels: [],
  contacts: [],
  accountCurrency: "GBP",
  staff: [{ id: "u1", name: "Ramy Hegab" }, { id: "u2", name: "Sara Okonkwo" }],
  // Every agency the institution knows, which is how an invented organiser is
  // recognised as a real name in the wrong place.
  agencies: ["Global Study", "AHZ", "NCUK", "Academix"],
  activities: [
    {
      id: "e1",
      type: "recruitment_event",
      title: "NCUK Fair - Algiers June 2026",
      agents: { trading_name: "Global Study" },
      agent_id: "a1",
      visited_by: "u1",
    },
    { id: "v1", type: "agent_visit", title: "Visit", agents: { trading_name: "AHZ" }, agent_id: "a2", visited_by: "u1" },
  ],
  ...over,
});

const find = (md: string, over?: Record<string, unknown>) =>
  runChecks(md, toSourceFacts(input(over) as any), config).findings.filter((f) => f.checkId === "ATTR-01");

describe("ORG-01: who ran the event", () => {
  it("accepts the organiser the record names", () => {
    expect(find("| NCUK Fair — Algiers | Global Study |")).toEqual([]);
  });

  it("catches an event credited to the wrong organiser", () => {
    const f = find("| NCUK Fair — Algiers | AHZ |");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("organising");
    expect(f[0]!.summary).toContain("Global Study");
  });

  it("catches an organiser invented for an event that has none", () => {
    const noOrganiser = input().activities.map((a) =>
      a.id === "e1" ? { ...a, agents: null, agent_id: null } : a,
    );
    const f = find("| NCUK Fair — Algiers | Global Study |", { activities: noOrganiser });
    expect(f.some((x) => x.summary.includes("names nobody"))).toBe(true);
  });

  it("accepts a report that says an event had no organiser", () => {
    const noOrganiser = input().activities.map((a) =>
      a.id === "e1" ? { ...a, agents: null, agent_id: null } : a,
    );
    expect(find("| NCUK Fair — Algiers | *(not recorded)* |", { activities: noOrganiser })).toEqual([]);
  });

  it("keeps the organiser claim apart from who attended", () => {
    // Both claims are about the same event when it has no organiser. Without a
    // relation to separate them they look like one question with two answers,
    // and the ambiguity guard would drop both.
    const noOrganiser = input().activities.map((a) =>
      a.id === "e1" ? { ...a, agents: null, agent_id: null } : a,
    );
    const facts = toSourceFacts(input({ activities: noOrganiser }) as any);
    const forEvent = facts.attributions!.filter((a) => a.subject.startsWith("NCUK"));
    expect(forEvent).toHaveLength(2);
    expect(new Set(forEvent.map((a) => a.relation))).toEqual(new Set(["organising", "the visit to"]));
  });
});
