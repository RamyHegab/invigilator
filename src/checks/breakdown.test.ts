import { describe, it, expect } from "vitest";
import { runChecks } from "../run.js";
import type { AppConfig, Breakdown, SourceFacts } from "../types.js";

const config = { appId: "t", sections: [] } as AppConfig;

/** The real dry-run figures: 5 leads, 3 UG, 1 PGT, 1 unspecified. */
const levels = (): Breakdown => ({
  id: "leads-by-level",
  label: "leads by study level",
  section: "Recruitment Event Outcomes",
  totalLabel: "total leads captured",
  totalAliases: ["total leads"],
  total: 5,
  parts: [
    { label: "UG", value: 3, aliases: ["undergraduate"] },
    { label: "PGT", value: 1, aliases: ["postgraduate taught"] },
    { label: "Other", value: 1, aliases: ["unspecified"], mustAppear: false },
  ],
});

const courses = (): Breakdown => ({
  id: "leads-by-course",
  label: "most demanded courses",
  section: "Recruitment Event Outcomes",
  ranked: true,
  parts: [
    { label: "Business & Management", value: 2 },
    { label: "Computer Science & IT", value: 1 },
    { label: "Engineering", value: 1 },
  ],
});

const facts = (...breakdowns: Breakdown[]): SourceFacts => ({
  entities: [],
  figures: [],
  links: [],
  forbidden: [],
  breakdowns,
});

const section = (body: string) => `## Recruitment Event Outcomes\n\n${body}\n`;

const find = (md: string, id: string, ...b: Breakdown[]) =>
  runChecks(md, facts(...(b.length ? b : [levels()])), config).findings.filter((f) => f.checkId === id);

describe("BRK-01: the whole", () => {
  it("accepts the figure the data holds", () => {
    expect(find(section("| Total leads captured | 5 |\n"), "BRK-01")).toEqual([]);
  });

  it("catches an inflated total", () => {
    const f = find(section("Total leads captured: 12"), "BRK-01");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("12");
    expect(f[0]!.summary).toContain("5");
  });

  it("reads prose as readily as a table", () => {
    expect(find(section("A total of 7 total leads captured."), "BRK-01")).toHaveLength(1);
  });
});

describe("BRK-02: the parts", () => {
  it("accepts a correct split in either arrangement", () => {
    expect(find(section("| Undergraduate (UG) | 3 |\n| Postgraduate taught (PGT) | 1 |"), "BRK-02")).toEqual([]);
    expect(find(section("3 UG and 1 PGT were captured."), "BRK-02")).toEqual([]);
  });

  it("catches a wrong part even when the total is right", () => {
    const f = find(section("| Total leads captured | 5 |\n| UG | 4 |\n| PGT | 1 |"), "BRK-02");
    expect(f.filter((x) => x.severity === "error")).toHaveLength(1);
    expect(f[0]!.summary).toContain("UG");
  });

  it("catches the omission that started this", () => {
    // The live report: the total right, the split simply absent — and it went
    // on to assert no split had been recorded at all.
    const f = find(
      section("Five leads were captured. No UG/PGT split was recorded."),
      "BRK-02",
    );
    // Both UG and PGT are missing; "Other" is exempt.
    const missing = f.filter((x) => x.severity === "warning");
    expect(missing).toHaveLength(2);
    expect(missing.map((m) => m.summary).join(" ")).toContain("never states");
  });

  it("does not demand a part the data has none of", () => {
    const b = levels();
    b.parts = [{ label: "UG", value: 3 }, { label: "PGT", value: 0 }];
    expect(find(section("| UG | 3 |"), "BRK-02", b)).toEqual([]);
  });

  it("does not demand a part marked optional", () => {
    const f = find(section("| UG | 3 |\n| PGT | 1 |"), "BRK-02");
    expect(f).toEqual([]); // "Other" has a value of 1 but mustAppear is false
  });

  it("does not match a short label inside a longer word", () => {
    // "UG" must not be found inside "Uganda" or "undergraduate".
    const f = find(section("| UG | 3 |\n| PGT | 1 |\nRecruitment in Uganda continues."), "BRK-02");
    expect(f).toEqual([]);
  });

  it("reads a count given in parentheses after the name", () => {
    // Verbatim shape from a live report: "| Most demanded courses | Engineering (1) |".
    const md = section("| Most demanded courses | Business & Management (2) |");
    expect(find(md, "BRK-02", courses()).filter((f) => f.summary.includes("Business"))).toEqual([]);
  });

  it("does not read a ratio as a count", () => {
    // Verbatim from the dry-run report, whose figures were all correct. The
    // "1" in "3:1" was being bound to UG.
    const md = section("| UG | 3 |\n| PGT | 1 |\n\nThe split resolved to a 3:1 UG:PGT ratio.");
    expect(find(md, "BRK-02")).toEqual([]);
  });

  it("looks inside subsections, not just the section's own body", () => {
    const md = "## Recruitment Event Outcomes\n\n### TEST Fair\n\n| UG | 9 |\n";
    expect(find(md, "BRK-02").filter((x) => x.severity === "error")).toHaveLength(1);
  });

  it("ignores figures outside the scoped section", () => {
    const md = "## Executive Summary\n\n| UG | 9 |\n\n" + section("| UG | 3 |\n| PGT | 1 |");
    expect(find(md, "BRK-02")).toEqual([]);
  });
});

describe("BRK-03: the ranking", () => {
  it("accepts the true order", () => {
    const md = section("Business & Management (2), Computer Science & IT (1), Engineering (1).");
    expect(find(md, "BRK-03", courses())).toEqual([]);
  });

  it("catches a smaller item presented as the most demanded", () => {
    const md = section("Engineering led demand, followed by Business & Management.");
    const f = find(md, "BRK-03", courses());
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("Engineering");
    expect(f[0]!.summary).toContain("Business & Management");
  });

  it("does not invent an order between tied items", () => {
    // Computer Science and Engineering both have one. Either order is right.
    const md = section("Business & Management (2) led, then Engineering, then Computer Science & IT.");
    expect(find(md, "BRK-03", courses())).toEqual([]);
  });

  it("says nothing about a breakdown that is not ranked", () => {
    expect(find(section("PGT 1, UG 3"), "BRK-03")).toEqual([]);
  });
});
