import { describe, it, expect } from "vitest";
import { runChecks } from "../run.js";
import type { AppConfig, Attribution, SourceFacts } from "../types.js";

const config = { appId: "t", sections: [] } as AppConfig;
const TEAM = ["Ramy Hegab", "Sara Okonkwo", "Tom Bright"];

const facts = (...attributions: Attribution[]): SourceFacts => ({
  entities: [],
  figures: [],
  links: [],
  forbidden: [],
  attributions,
});

const visit = (subject: string, expected: string | null): Attribution => ({
  subject,
  expected,
  candidates: TEAM,
});

const find = (md: string, ...a: Attribution[]) =>
  runChecks(md, facts(...a), config).findings.filter((f) => f.checkId === "ATTR-01");

describe("ATTR-01: who did what", () => {
  it("accepts the person the record names", () => {
    const md = "Ramy Hegab visited Cairo Study Abroad and agreed a new intake target.";
    expect(find(md, visit("Cairo Study Abroad", "Ramy Hegab"))).toEqual([]);
  });

  it("catches a visit credited to the wrong colleague", () => {
    const md = "Sara Okonkwo visited Cairo Study Abroad and agreed a new intake target.";
    const f = find(md, visit("Cairo Study Abroad", "Ramy Hegab"));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("Sara Okonkwo");
    expect(f[0]!.summary).toContain("Ramy Hegab");
  });

  it("catches an attribution the record does not have at all", () => {
    const md = "Tom Bright met Nile Education to discuss commission.";
    const f = find(md, visit("Nile Education", null));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("names nobody");
  });

  it("says nothing when the report credits no one", () => {
    const md = "The meeting with Cairo Study Abroad covered intake targets.";
    expect(find(md, visit("Cairo Study Abroad", "Ramy Hegab"))).toEqual([]);
    expect(find(md, visit("Cairo Study Abroad", null))).toEqual([]);
  });

  it("allows a colleague named alongside the right person", () => {
    const md = "Ramy Hegab and Tom Bright visited Cairo Study Abroad together.";
    expect(find(md, visit("Cairo Study Abroad", "Ramy Hegab"))).toEqual([]);
  });

  it("refuses to guess when one paragraph covers two visits", () => {
    // Which name goes with which agency is unknowable here, and a wrong
    // finding accuses a real person. Silence is the right answer.
    const md = "Ramy Hegab and Sara Okonkwo covered Cairo Study Abroad and Nile Education.";
    const f = find(md, visit("Cairo Study Abroad", "Ramy Hegab"), visit("Nile Education", "Sara Okonkwo"));
    expect(f).toEqual([]);
  });

  it("reads each paragraph on its own", () => {
    const md =
      "Ramy Hegab visited Cairo Study Abroad.\n\nSara Okonkwo visited Nile Education.\n\nTom Bright visited Delta Partners.";
    const f = find(
      md,
      visit("Cairo Study Abroad", "Ramy Hegab"),
      visit("Nile Education", "Tom Bright"), // wrong: Sara is credited
      visit("Delta Partners", "Tom Bright"),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("Nile Education");
  });

  it("reads a table row as its own claim", () => {
    // Reports put engagements in tables. Treating the whole table as one block
    // meant every row named several agencies at once, and the check silently
    // read nothing at all in a real report.
    const md =
      "| Date | Type | Agency | By |\n| --- | --- | --- | --- |\n" +
      "| 18 Jul | Agent visit | Cairo Study Abroad | Ramy Hegab |\n" +
      "| 19 Jul | Agent visit | Nile Education | Sara Okonkwo |\n";
    const f = find(md, visit("Cairo Study Abroad", "Ramy Hegab"), visit("Nile Education", "Ramy Hegab"));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("Nile Education");
  });

  it("treats repeat visits by the same person as one claim", () => {
    // An agency visited twice arrives as two attributions. They agree, so a
    // mention is not ambiguous -- before this, a second visit disabled the
    // check for that agency entirely.
    const md = "Sara Okonkwo visited Cairo Study Abroad.";
    const f = find(md, visit("Cairo Study Abroad", "Ramy Hegab"), visit("Cairo Study Abroad", "Ramy Hegab"));
    expect(f).toHaveLength(1);
  });

  it("stays quiet when two records for one subject disagree", () => {
    // Two visits to one agency by two colleagues: a mention could be either.
    const md = "Sara Okonkwo visited Cairo Study Abroad.";
    const f = find(md, visit("Cairo Study Abroad", "Ramy Hegab"), visit("Cairo Study Abroad", "Tom Bright"));
    expect(f).toEqual([]);
  });

  it("does not match a name inside a longer word", () => {
    const md = "Tomorrow the team visits Cairo Study Abroad.";
    expect(find(md, visit("Cairo Study Abroad", null))).toEqual([]); // "Tom" is not in "Tomorrow"
  });
});
