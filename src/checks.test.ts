import { describe, it, expect } from "vitest";
import { runChecks, formatFindings } from "./run.js";
import type { AppConfig, SourceFacts } from "./types.js";
import orbisConfig from "../config/orbis.json" with { type: "json" };

const config = orbisConfig as unknown as AppConfig;

/**
 * The fixtures below are the real defects found in Orbis's trip reports on
 * 2026-08-16, reproduced as reports. Each one shipped, read plausibly, and was
 * invisible in review — which is the whole argument for this engine.
 */

const facts = (over: Partial<SourceFacts> = {}): SourceFacts => ({
  period: { start: "2026-03-01", end: "2026-03-10" },
  entities: [
    { id: "c1", kind: "country", label: "Nigeria" },
    { id: "c2", kind: "country", label: "Ghana" },
    { id: "a1", kind: "agent", label: "Lagos Study Group" },
  ],
  figures: [
    { id: "travel", label: "Travel", value: 1200, currency: "GBP", partOfTotal: "total" },
    { id: "hotels", label: "Hotels", value: 800, currency: "GBP", partOfTotal: "total" },
    { id: "events", label: "Events", value: 500, currency: "GBP", partOfTotal: "total" },
    { id: "total", label: "Total", value: 2500, currency: "GBP" },
  ],
  links: [{ href: "/agents/a1", label: "Lagos Study Group", required: true }],
  forbidden: ["Jordan Rivera", "contact@example.invalid"],
  ...over,
});

const goodReport = `
# Trip Report

## Executive Summary
The objectives were met across Nigeria and Ghana.

## Trip Overview
| Field | Detail |
| --- | --- |
| Dates | 2026-03-01 to 2026-03-10 |

## Cost Summary
| Category | Amount |
| --- | --- |
| Travel | 1200.00 |
| Hotels | 800.00 |
| Events | 500.00 |
| Total | 2500.00 |

## Itinerary at a Glance
| Date | Type | Title | Location |
| --- | --- | --- | --- |
| 2026-03-02 | Agent visit | [Lagos Study Group](/agents/a1) | Lagos |

## Highlights by Country / City
Strong interest in Lagos and Accra.

## Key Agent & School Engagements
[Lagos Study Group](/agents/a1) — a productive meeting.

## Recruitment Event Outcomes
The Lagos fair went well.

## Action Items / Follow-ups
| # | Action | Owner | Due |
| --- | --- | --- | --- |
| 1 | Send prospectus | Ramy | 2026-03-20 |

## Conclusion
A useful trip.
`;

describe("a report that matches its data", () => {
  it("produces no findings", () => {
    const result = runChecks(goodReport, facts(), config);
    expect(result.findings).toEqual([]);
  });

  it("records what ran and what was skipped, so a clean result is evidence", () => {
    const result = runChecks(goodReport, facts(), config);
    expect(result.ran.length).toBeGreaterThan(0);
    expect(formatFindings(result)).toContain("No problems found");
  });
});

describe("coverage", () => {
  it("catches a country the report never mentions", () => {
    const report = goodReport.replace("and Ghana", "").replace("and Accra", "");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((f) => f.checkId === "COV-01" && f.summary.includes("Ghana"))).toBe(true);
  });

  it("accepts an alias as a mention", () => {
    const f = facts({
      entities: [{ id: "c1", kind: "country", label: "United Arab Emirates", aliases: ["UAE"] }],
    });
    const report = goodReport.replace("Nigeria and Ghana", "the UAE");
    expect(runChecks(report, f, config).findings.filter((x) => x.checkId === "COV-01")).toEqual([]);
  });

  it("stays silent for an entity that need not appear", () => {
    const f = facts({
      entities: [{ id: "x", kind: "agent", label: "Typed Agency", mustAppear: false }],
    });
    expect(runChecks(goodReport, f, config).findings.filter((x) => x.checkId === "COV-01")).toEqual([]);
  });
});

describe("figures", () => {
  it("catches categories that do not sum to their total", () => {
    // The real Orbis defect: costs on agent and school visits fed Total but no
    // category, so three numbers never made the fourth.
    const f = facts({
      figures: [
        { id: "travel", label: "Travel", value: 1200, partOfTotal: "total" },
        { id: "hotels", label: "Hotels", value: 800, partOfTotal: "total" },
        { id: "events", label: "Events", value: 200, partOfTotal: "total" },
        { id: "total", label: "Total", value: 2500 },
      ],
    });
    const found = runChecks(goodReport, f, config).findings;
    const recon = found.find((x) => x.checkId === "FIG-02");
    expect(recon).toBeDefined();
    expect(recon!.detail).toContain("difference of 300.00");
  });

  it("catches a figure the report altered", () => {
    const report = goodReport.replace("| Total | 2500.00 |", "| Total | 2400.00 |");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "FIG-01" && x.summary.includes("Total"))).toBe(true);
  });

  it("does not mistake a year for a missing figure", () => {
    expect(runChecks(goodReport, facts(), config).findings.filter((x) => x.checkId === "FIG-01")).toEqual([]);
  });

  it("catches an amount quoted in another currency", () => {
    // The extraction defect: an invitation priced EUR 450 written up as if GBP.
    const report = goodReport.replace("| Events | 500.00 |", "| Events | EUR 450 |");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "CUR-01")).toBe(true);
  });
});

describe("links", () => {
  it("catches an invented link", () => {
    // The branch defect: the model was told to write a link it had no id for.
    const report = goodReport.replace("(/agents/a1)", "(/agents/made-up-id)");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "LINK-01")).toBe(true);
  });

  it("notices a required link that never appears", () => {
    const report = goodReport.replaceAll("[Lagos Study Group](/agents/a1)", "Lagos Study Group");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "LINK-02")).toBe(true);
  });

  it("leaves external links alone", () => {
    const report = goodReport.replace("A useful trip.", "See [the fair](https://example.com/fair).");
    expect(runChecks(report, facts(), config).findings.filter((x) => x.checkId === "LINK-01")).toEqual([]);
  });
});

describe("personal data", () => {
  it("catches an email address", () => {
    const report = goodReport.replace("a productive meeting", "contact contact@example.invalid");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "PII-01")).toBe(true);
  });

  it("catches a third-party contact name lifted from a note", () => {
    const report = goodReport.replace("a productive meeting", "met Jordan Rivera, who will send figures");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "PII-03")).toBe(true);
  });

  it("does not flag a colleague named as an action owner", () => {
    // Own-team names are permitted; only third-party contacts are forbidden.
    const found = runChecks(goodReport, facts(), config).findings;
    expect(found.filter((x) => x.checkId.startsWith("PII"))).toEqual([]);
  });
});

describe("structure", () => {
  it("catches a missing section", () => {
    const report = goodReport.replace("## Conclusion\nA useful trip.", "");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "STR-01" && x.summary.includes("Conclusion"))).toBe(true);
  });

  it("catches a mandated table that is not there", () => {
    const report = goodReport.replace(
      "| Category | Amount |\n| --- | --- |\n| Travel | 1200.00 |\n| Hotels | 800.00 |\n| Events | 500.00 |\n| Total | 2500.00 |",
      "Travel 1200.00, Hotels 800.00, Events 500.00, Total 2500.00",
    );
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "STR-03")).toBe(true);
  });

  it("catches an empty section", () => {
    const report = goodReport.replace("The Lagos fair went well.", "");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "STR-04")).toBe(true);
  });

  it("does not call a section empty when its content sits in sub-headings", () => {
    // Found on the first live run: a real report opened "Highlights by
    // Country / City" straight into ### per-country sub-sections, and the
    // check called it empty. Content one level down is still content.
    const report = goodReport.replace(
      "## Highlights by Country / City\nStrong interest in Lagos and Accra.",
      "## Highlights by Country / City\n\n### Nigeria — Lagos\nStrong interest in Lagos.\n\n### Ghana — Accra\nGood turnout in Accra.",
    );
    const found = runChecks(report, facts(), config).findings;
    expect(found.filter((x) => x.checkId === "STR-04")).toEqual([]);
  });

  it("still catches a section with neither body nor sub-headings", () => {
    const report = goodReport.replace("Strong interest in Lagos and Accra.", "");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "STR-04")).toBe(true);
  });

  it("reads numbered and bold headings as the same section", () => {
    const report = goodReport.replace("## Conclusion", "## 9. **Conclusion**");
    const found = runChecks(report, facts(), config).findings;
    expect(found.filter((x) => x.checkId === "STR-01")).toEqual([]);
  });
});

describe("dates", () => {
  it("catches a date outside the period", () => {
    const report = goodReport.replace("2026-03-02", "2026-04-15");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "DATE-01" && x.evidence === "2026-04-15")).toBe(true);
  });

  it("does not flag a follow-up due date after the trip", () => {
    // Caught by this suite on its first run: an action item's deadline is
    // meant to fall after the trip, so checking the whole document blindly
    // made the check fire on every correct report.
    const found = runChecks(goodReport, facts(), config).findings;
    expect(found.filter((x) => x.checkId === "DATE-01")).toEqual([]);
  });

  it("still flags a bad date inside an otherwise exempt report", () => {
    const report = goodReport.replace("| 2026-03-02 | Agent visit", "| 2025-01-01 | Agent visit");
    const found = runChecks(report, facts(), config).findings;
    expect(found.some((x) => x.checkId === "DATE-01" && x.evidence === "2025-01-01")).toBe(true);
  });
});

describe("the runner", () => {
  it("skips disabled checks with their reason instead of silently passing", () => {
    const cfg = { ...config, disabledChecks: { "COV-01": "no entity data yet" } };
    const result = runChecks(goodReport, facts(), cfg);
    expect(result.skipped).toEqual([{ id: "COV-01", reason: "no entity data yet" }]);
    expect(result.ran).not.toContain("COV-01");
  });

  it("reports a broken check rather than losing the whole run", () => {
    const exploding = {
      id: "BOOM-01",
      title: "Always throws",
      run: () => {
        throw new Error("kaboom");
      },
    };
    const result = runChecks(goodReport, facts(), config, [exploding]);
    expect(result.findings[0]?.checkId).toBe("BOOM-01");
    expect(result.findings[0]?.detail).toBe("kaboom");
  });

  it("puts errors before warnings", () => {
    const report = goodReport.replace("## Conclusion", "## Zonclusion");
    const result = runChecks(report, facts(), config);
    const severities = result.findings.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => (a === "error" ? -1 : 1)));
  });
});
