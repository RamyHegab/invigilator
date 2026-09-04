import { describe, it, expect } from "vitest";
import { runChecks } from "../run.js";
import type { AppConfig, Entity, SourceFacts } from "../types.js";

const config = { appId: "t", sections: [] } as AppConfig;

const facts = (...entities: Entity[]): SourceFacts => ({
  entities,
  figures: [],
  links: [],
  forbidden: [],
});

const engagement = (label: string): Entity => ({
  id: label,
  kind: "agent visit",
  label,
  section: "Key Agent & School Engagements",
});

const find = (md: string, ...e: Entity[]) =>
  runChecks(md, facts(...e), config).findings.filter((f) => f.checkId === "COV-01");

const report = (engagements: string) =>
  `# Trip\n\n## Executive Summary\n\nA productive week in Cairo.\n\n` +
  `## Key Agent & School Engagements\n\n${engagements}\n\n## Conclusion\n\nDone.\n`;

describe("COV-01 scoped to a section", () => {
  it("accepts a visit written up where it belongs", () => {
    expect(find(report("Met Cairo Study Abroad; strong pipeline."), engagement("Cairo Study Abroad"))).toEqual([]);
  });

  it("catches a visit that never appears at all", () => {
    const f = find(report("Met Nile Education."), engagement("Cairo Study Abroad"));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("never mentions");
  });

  it("catches a visit mentioned elsewhere but missing from its section", () => {
    // The failure worth having: it reads fine, and a reader looking up that
    // agent finds nothing where they look.
    const md =
      `# Trip\n\n## Executive Summary\n\nA productive week; Cairo Study Abroad was a highlight.\n\n` +
      `## Key Agent & School Engagements\n\nMet Nile Education.\n\n## Conclusion\n\nDone.\n`;
    const f = find(md, engagement("Cairo Study Abroad"));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("not in");
    expect(f[0]!.detail).toContain("find nothing");
  });

  it("looks inside subsections of the section", () => {
    const md =
      `## Key Agent & School Engagements\n\n### Cairo\n\nMet Cairo Study Abroad.\n`;
    expect(find(md, engagement("Cairo Study Abroad"))).toEqual([]);
  });

  it("falls back to the whole report when the section is absent", () => {
    // A university template has different headings. Reporting every visit as
    // missing because our heading is not there would be twenty findings for
    // one fact -- and the missing section is COV-01's own separate finding.
    const md = `# Trip\n\n## Partner Meetings\n\nMet Cairo Study Abroad.\n`;
    expect(find(md, engagement("Cairo Study Abroad"))).toEqual([]);
  });

  it("still checks unscoped entities anywhere in the report", () => {
    const md = report("Met Nile Education.");
    const country: Entity = { id: "c", kind: "country", label: "Egypt" };
    expect(find(md, country)).toHaveLength(1);
    expect(find(md + "\nEgypt was the destination.", country)).toEqual([]);
  });
});

describe("checkId override", () => {
  it("stamps COV-01 by default", () => {
    const md = `# Trip\n\nMet Nile Education.\n`;
    const country: Entity = { id: "c", kind: "country", label: "Egypt" };
    const f = runChecks(md, facts(country), config).findings;
    expect(f).toHaveLength(1);
    expect(f[0]!.checkId).toBe("COV-01");
  });

  it("stamps whatever checkId the entity carries", () => {
    // Same mechanism, different row in the domain model's checklist: a
    // missing city is worth naming and reasoning about separately from a
    // missing country, even though both are found the same way.
    const md = `# Trip\n\nMet Nile Education.\n`;
    const city: Entity = { id: "ci", kind: "city", label: "Alexandria", checkId: "COV-02" };
    const f = runChecks(md, facts(city), config).findings;
    expect(f).toHaveLength(1);
    expect(f[0]!.checkId).toBe("COV-02");
  });

  it("keeps entities of different kinds independently reportable in one run", () => {
    const md = `# Trip\n\nMet Nile Education.\n`;
    const country: Entity = { id: "c", kind: "country", label: "Egypt" };
    const city: Entity = { id: "ci", kind: "city", label: "Alexandria", checkId: "COV-02" };
    const ids = runChecks(md, facts(country, city), config).findings.map((f) => f.checkId).sort();
    expect(ids).toEqual(["COV-01", "COV-02"]);
  });
});

describe("severity override", () => {
  it("is an error by default", () => {
    const md = `# Trip\n\nMet Nile Education.\n`;
    const country: Entity = { id: "c", kind: "country", label: "Egypt" };
    expect(runChecks(md, facts(country), config).findings[0]!.severity).toBe("error");
  });

  it("is a warning when the entity says so", () => {
    // A free-typed field where two spellings of the same place are a live
    // risk -- see the adapter's city entities for the real case that forced
    // this.
    const md = `# Trip\n\nMet Nile Education.\n`;
    const city: Entity = { id: "ci", kind: "city", label: "Casablanaca", severity: "warning" };
    expect(runChecks(md, facts(city), config).findings[0]!.severity).toBe("warning");
  });
});
