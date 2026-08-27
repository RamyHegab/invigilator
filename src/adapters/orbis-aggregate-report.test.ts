import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runChecks } from "../run.js";
import { toAggregateFacts } from "./orbis-aggregate-report.js";
import type { AppConfig } from "../types.js";

const config = JSON.parse(readFileSync(new URL("../../config/orbis-aggregate.json", import.meta.url), "utf8")) as AppConfig;

const facts = () =>
  toAggregateFacts({
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    totals: { trips: 5, events: 9, agentVisits: 12, schoolVisits: 4, otherActivities: 2 },
    forbidden: ["Jordan Rivera"],
  });

const summary = (takeaways: string, byCountry = "- Egypt: strong pipeline.") =>
  `## Key Takeaways\n\n${takeaways}\n\n## Leads Generated\n\nA healthy volume across the year.\n\n## Notable Outcomes by Country\n\n${byCountry}\n`;

const find = (md: string, id?: string) => {
  const f = runChecks(md, facts(), config).findings;
  return id ? f.filter((x) => x.checkId === id) : f;
};

describe("the aggregate briefing", () => {
  it("passes a summary whose numbers match", () => {
    expect(find(summary("- 5 trips delivered 9 recruitment events and 12 agent visits."))).toEqual([]);
  });

  it("catches a miscount in the takeaways", () => {
    const f = find(summary("- 5 trips delivered 14 recruitment events."), "CNT-01");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("14");
    expect(f[0]!.summary).toContain("9");
  });

  it("does not measure a per-country figure against the portfolio total", () => {
    // "3 agent visits" is true of Egypt and false of the year. The country
    // section is where parts are discussed, so totals are not checked there.
    expect(find(summary("- A productive year.", "- Egypt: 3 agent visits, 2 fairs."), "CNT-01")).toEqual([]);
  });

  it("catches a section the briefing promised and did not write", () => {
    const md = "## Key Takeaways\n\n- A good year.\n\n## Leads Generated\n\nPlenty.\n";
    const f = find(md, "STR-01");
    expect(f.some((x) => x.summary.includes("Notable Outcomes by Country"))).toBe(true);
  });

  it("catches a contact detail reaching an executive briefing", () => {
    const withEmail = find(summary("- Follow up with someone at partner@example.invalid."));
    expect(withEmail.some((x) => x.checkId.startsWith("PII"))).toBe(true);

    const withName = find(summary("- Jordan Rivera was especially helpful."));
    expect(withName.some((x) => x.checkId.startsWith("PII"))).toBe(true);
  });
});
