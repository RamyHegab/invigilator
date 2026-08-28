import { describe, it, expect } from "vitest";
import { runChecks } from "../run.js";
import type { AppConfig, SourceFacts } from "../types.js";

const config: AppConfig = {
  appId: "t",
  sections: [
    {
      name: "Action Items / Follow-ups",
      required: true,
      tableColumns: ["#", "Action", "Owner", "Due"],
      noPlaceholderColumns: ["Owner", "Due"],
      allowDatesOutsidePeriod: true,
    },
  ],
};

const facts = (): SourceFacts => ({ entities: [], figures: [], links: [], forbidden: [] });

const report = (rows: string) =>
  `## Action Items / Follow-ups\n\n| # | Action | Owner | Due |\n| --- | --- | --- | --- |\n${rows}\n`;

const find = (md: string) => runChecks(md, facts(), config).findings.filter((f) => f.checkId === "STR-05");

describe("STR-05: a commitment nobody made", () => {
  it("passes a row with a real owner and date", () => {
    expect(find(report("| 1 | Send the prospectus | Ramy | 2026-11-30 |"))).toEqual([]);
  });

  it("catches TBC in an owner", () => {
    const f = find(report("| 1 | Send the prospectus | TBC | 2026-11-30 |"));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("Owner");
    expect(f[0]!.detail).toContain("not an action");
  });

  it("catches an empty due date and a dash alike", () => {
    expect(find(report("| 1 | Chase the invoice | Ramy |  |"))).toHaveLength(1);
    expect(find(report("| 1 | Chase the invoice | Ramy | — |"))).toHaveLength(1);
    expect(find(report("| 1 | Chase the invoice | Ramy | n/a |"))).toHaveLength(1);
  });

  it("reports each bad row separately, and names the row", () => {
    const f = find(
      report("| 1 | Send prospectus | TBC | 2026-11-30 |\n| 2 | Book stand | Ramy | TBD |"),
    );
    expect(f).toHaveLength(2);
    expect(f[0]!.summary).toContain("Row 1");
    expect(f[1]!.summary).toContain("Row 2");
  });

  it("does not judge an answer merely for being vague", () => {
    // "The agent" is imprecise but it is an answer. Flagging vagueness would
    // make this a judgement check, which it is deliberately not.
    expect(find(report("| 1 | Confirm the stand | The agent | Before the fair |"))).toEqual([]);
  });

  it("says nothing about columns not marked as needing an answer", () => {
    expect(find(report("| 1 | TBC | Ramy | 2026-11-30 |"))).toEqual([]);
  });
});
