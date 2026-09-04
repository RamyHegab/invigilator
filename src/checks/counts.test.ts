import { describe, it, expect } from "vitest";
import { runChecks } from "../run.js";
import type { AppConfig, SourceFacts } from "../types.js";

const config = { appId: "t", sections: [] } as AppConfig;

const facts = (): SourceFacts => ({
  entities: [],
  figures: [],
  links: [],
  forbidden: [],
  counts: [
    { label: "travel legs", value: 6, aliases: ["sectors", "flights"] },
    { label: "agent visits", value: 5, aliases: ["agent engagements"] },
  ],
});

const find = (md: string) => runChecks(md, facts(), config).findings.filter((f) => f.checkId === "CNT-01");

describe("stated counts", () => {
  it("catches the real miscount that started this", () => {
    // The live report said this while its own table said six.
    const f = find("Eight sectors of air travel were completed across four cities.");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("8");
    expect(f[0]!.summary).toContain("6");
  });

  it("accepts a correct count in words or digits", () => {
    expect(find("Six flights were completed.")).toEqual([]);
    expect(find("6 travel legs were completed.")).toEqual([]);
    expect(find("Five agent engagements took place.")).toEqual([]);
  });

  it("reads an alias as the same thing", () => {
    expect(find("Seven flights were booked.")).toHaveLength(1);
  });

  it("treats a qualifier as scoping the count to a subset, not the whole", () => {
    // Deliberate trade-off, learned from a live report: "four GSUK fair days"
    // and "four consecutive fair days" are correct statements about part of a
    // trip, and firing on them made every finding suspect. The cost is that a
    // genuine miscount phrased with a filler word slips through.
    expect(find("Eight separate travel legs were completed.")).toEqual([]);
    expect(find("Four consecutive travel legs were completed.")).toEqual([]);
  });

  it("does not read a number from an adjacent table row as a claim", () => {
    // "| Total activities | 25 |" above "| Recruitment events | 7 |" is not a
    // claim that there were 25 recruitment events.
    const md = "| Total activities | 25 |\n| Travel legs | 6 flights |";
    expect(find(md)).toEqual([]);
  });

  it("stays silent when no number precedes the phrase", () => {
    expect(find("Travel legs were completed efficiently.")).toEqual([]);
    expect(find("The agent visits went well.")).toEqual([]);
  });

  it("does not fire on a number that belongs to something else", () => {
    // "four cities" is not a claim about travel legs.
    expect(find("Across four cities, the six flights were efficient.")).toEqual([]);
  });

  it("does nothing when the app supplies no counts", () => {
    const noCounts = { ...facts(), counts: undefined };
    expect(runChecks("Eight flights.", noCounts, config).findings.filter((f) => f.checkId === "CNT-01")).toEqual([]);
  });
});

describe("a count stated in a markdown table cell", () => {
  // The Orbis prompt asks for exactly this shape in the Trip Overview table:
  // "| Field | Detail |" with the label in one cell and the number in the
  // next. The label comes first and the number after it -- the opposite
  // order from prose -- which the original backward-only search could not
  // see at all, found while wiring this up for COV-05.
  const overviewFacts = (): SourceFacts => ({
    entities: [],
    figures: [],
    links: [],
    forbidden: [],
    counts: [{ label: "activities", value: 20, aliases: ["total activities"] }],
  });
  const find = (md: string) =>
    runChecks(md, overviewFacts(), config).findings.filter((f) => f.checkId === "CNT-01");

  it("catches a wrong count stated after the label in a table row", () => {
    const f = find("| Total Activities | 25 |");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("25");
    expect(f[0]!.summary).toContain("20");
  });

  it("accepts a correct count stated after the label", () => {
    expect(find("| Total Activities | 20 |")).toEqual([]);
  });

  it("does not report the same occurrence twice when checked in one line", () => {
    const f = find("| Activities | 25 |");
    expect(f).toHaveLength(1);
  });
});

describe("backward still wins over forward when both are present", () => {
  it("uses the number immediately behind the phrase, not one further away after it", () => {
    const facts: SourceFacts = {
      entities: [],
      figures: [],
      links: [],
      forbidden: [],
      counts: [{ label: "activities", value: 6 }],
    };
    // "8" is immediately behind the phrase; the report's own real number, 20,
    // sits after it. The nearer, backward one is the claim being made.
    const f = runChecks("8 activities were logged, of a possible 20.", facts, config).findings.filter(
      (x) => x.checkId === "CNT-01",
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("8");
  });
});
