import { describe, it, expect } from "vitest";
import { runSignals } from "./run.js";
import type { BehaviourEvent, SignalConfig } from "./types.js";

const config: SignalConfig = { appId: "t" };

let n = 0;
const ev = (over: Partial<BehaviourEvent> = {}): BehaviourEvent => ({
  kind: "rage_click",
  at: `2026-09-${String(10 + (n % 10)).padStart(2, "0")}T09:0${n++ % 10}:00Z`,
  actor: "u1",
  session: "s1",
  where: "/trips/:id",
  what: "activity-save",
  ...over,
});

/** k events from k different people, which is the shape that gets reported. */
const fromMany = (count: number, over: Partial<BehaviourEvent> = {}) =>
  Array.from({ length: count }, (_, i) => ev({ actor: `u${i}`, session: `s${i}`, ...over }));

const find = (events: BehaviourEvent[], id: string) =>
  runSignals(events, config).findings.filter((f) => f.checkId === id);

describe("SIG-01: a control people fight with", () => {
  it("reports a control several people got nothing from", () => {
    const f = find(fromMany(6), "SIG-01");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("activity-save");
    expect(f[0]!.summary).toContain("6 people");
  });

  it("says nothing about one person having a bad afternoon", () => {
    // Twenty clicks, one person. That is a story about the person, not the app.
    const events = Array.from({ length: 20 }, () => ev());
    expect(find(events, "SIG-01")).toEqual([]);
  });

  it("says nothing about three people who each clicked once", () => {
    // Enough people, not enough happening: three coincidences, not a pattern.
    expect(find(fromMany(3), "SIG-01")).toEqual([]);
  });

  it("keeps the same control on two pages apart", () => {
    const events = [
      ...fromMany(6, { where: "/trips/:id" }),
      ...fromMany(6, { where: "/agents/:id" }),
    ];
    const f = find(events, "SIG-01");
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.summary).join(" ")).toContain("/agents/:id");
  });

  it("counts dead clicks and rage clicks as the same complaint", () => {
    const events = [...fromMany(3, { kind: "dead_click" }), ...fromMany(3, { kind: "rage_click" })];
    const f = find(events, "SIG-01");
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("nothing on the page changing");
  });

  it("ignores an event with nothing identifying what was clicked", () => {
    expect(find(fromMany(6, { what: null }), "SIG-01")).toEqual([]);
  });
});

describe("SIG-02: an error nobody reported", () => {
  const err = (message: string, over: Partial<BehaviourEvent> = {}) =>
    ev({ kind: "js_error", what: null, detail: { message }, ...over });

  it("reports a repeated error", () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      err("Cannot read properties of null", { actor: `u${i}`, session: `s${i}` }),
    );
    const f = find(events, "SIG-02");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("nobody said so");
    expect(f[0]!.evidence).toContain("Cannot read properties");
  });

  it("treats one fault across several pages as one bug", () => {
    const routes = ["/trips", "/agents", "/schools", "/reports", "/setup", "/timeline"];
    const events = routes.map((where, i) =>
      err("boom", { where, actor: `u${i}`, session: `s${i}` }),
    );
    const f = find(events, "SIG-02");
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("and 2 more");
  });
});

describe("SIG-03: a request that keeps failing", () => {
  it("reports it, with the status", () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      ev({ kind: "failed_request", what: "save-activity", detail: { status: 500 }, actor: `u${i}`, session: `s${i}` }),
    );
    const f = find(events, "SIG-03");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("500");
    expect(f[0]!.detail).toContain("behind a spinner");
  });
});

describe("the run itself", () => {
  it("says how much it looked at, so quiet is not confused with broken", () => {
    const r = runSignals([], config);
    expect(r.findings).toEqual([]);
    expect(r.examined).toBe(0);
    expect(r.ran).toHaveLength(3);
  });

  it("records a disabled check rather than silently passing it", () => {
    const r = runSignals(fromMany(6), { ...config, disabledChecks: { "SIG-01": "not yet trusted" } });
    expect(r.ran).not.toContain("SIG-01");
    expect(r.skipped[0]).toEqual({ id: "SIG-01", reason: "not yet trusted" });
    expect(r.findings).toEqual([]);
  });

  it("honours a stricter threshold", () => {
    const r = runSignals(fromMany(6), { ...config, minActors: 10 });
    expect(r.findings).toEqual([]);
  });
});
