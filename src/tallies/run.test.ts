import { describe, it, expect } from "vitest";
import { runTallies } from "./run.js";
import type { Tally, TallyConfig } from "./types.js";

const config: TallyConfig = { appId: "t" };

/** A year's activity counts, split by country. Correct unless a test breaks it. */
const good = (over: Partial<Tally> = {}): Tally => ({
  id: "year",
  label: "activity counts for the year",
  stated: { events: 8, agentVisits: 5, schoolVisits: 3 },
  recomputed: { events: 8, agentVisits: 5, schoolVisits: 3 },
  parts: [
    { label: "Egypt", counts: { events: 2, agentVisits: 3, schoolVisits: 3 } },
    { label: "Algeria", counts: { events: 5, agentVisits: 2, schoolVisits: 0 } },
    { label: "Unspecified", counts: { events: 1, agentVisits: 0, schoolVisits: 0 } },
  ],
  ...over,
});

const find = (t: Tally, id?: string, cfg: TallyConfig = config) => {
  const f = runTallies([t], cfg).findings;
  return id ? f.filter((x) => x.checkId === id) : f;
};

describe("TAL-01: does the figure survive a recount", () => {
  it("passes when both routes agree", () => {
    expect(find(good(), "TAL-01")).toEqual([]);
  });

  it("catches a stated figure the records do not support", () => {
    const f = find(good({ recomputed: { events: 8, agentVisits: 4, schoolVisits: 3 } }), "TAL-01");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("says 5 agentVisits");
    expect(f[0]!.summary).toContain("recount gives 4");
  });

  it("catches a category the report omits entirely", () => {
    // Present in the records, absent from the report: stated 0, found 2.
    const f = find(good({ recomputed: { events: 8, agentVisits: 5, schoolVisits: 3, other: 2 } }), "TAL-01");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("says 0 other");
  });
});

describe("TAL-02: does the breakdown add up", () => {
  it("passes when the parts sum to the whole", () => {
    expect(find(good(), "TAL-02")).toEqual([]);
  });

  it("catches a column that does not add up", () => {
    // This is the real one: a fair counted in the total but in no country.
    const parts = good().parts!.map((p) => (p.label === "Unspecified" ? { ...p, counts: { events: 0 } } : p));
    const f = find(good({ parts }), "TAL-02");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("events totals 8");
    expect(f[0]!.summary).toContain("breakdown adds to 7");
  });

  it("says nothing when there is no breakdown to check", () => {
    expect(find(good({ parts: undefined }), "TAL-02")).toEqual([]);
  });
});

describe("TAL-03: did anything fall out of every category", () => {
  it("reports records counted nowhere", () => {
    const f = find(good({ unclassified: { count: 4, reason: "type not counted" } }), "TAL-03");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("4 record(s) counted in no category");
    expect(f[0]!.severity).toBe("warning");
  });

  it("accepts an exclusion the app has declared deliberate", () => {
    const t = good({ unclassified: { count: 4, reason: "rest day" } });
    expect(find(t, "TAL-03", { ...config, expectedExclusions: ["rest day"] })).toEqual([]);
  });

  it("says nothing when everything was counted", () => {
    expect(find(good({ unclassified: { count: 0 } }), "TAL-03")).toEqual([]);
  });
});

describe("the run itself", () => {
  it("reports what it checked and what it skipped", () => {
    const r = runTallies([good()], { ...config, disabledChecks: { "TAL-02": "no breakdown yet" } });
    expect(r.checked).toBe(1);
    expect(r.ran).toContain("TAL-01");
    expect(r.ran).not.toContain("TAL-02");
    expect(r.skipped).toEqual([{ id: "TAL-02", reason: "no breakdown yet" }]);
  });

  it("puts errors above warnings", () => {
    const t = good({
      recomputed: { events: 9, agentVisits: 5, schoolVisits: 3 },
      unclassified: { count: 2 },
    });
    const f = runTallies([t], config).findings;
    expect(f[0]!.severity).toBe("error");
    expect(f[f.length - 1]!.severity).toBe("warning");
  });
});
