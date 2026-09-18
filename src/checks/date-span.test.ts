import { describe, it, expect } from "vitest";
import { dateSpanKept } from "./date-span.js";
import type { CheckContext, DateSpan } from "../types.js";

const ctx = (artifact: string, spans: DateSpan[]): CheckContext =>
  ({
    config: { appId: "test", sections: [] },
    facts: { entities: [], figures: [], links: [], forbidden: [], dateSpans: spans },
    artifact,
  }) as unknown as CheckContext;

const fair = (over: Partial<DateSpan> = {}): DateSpan => ({
  subject: "GSUK Cairo Fair",
  kind: "event",
  start: "2026-10-15",
  end: "2026-10-17",
  ...over,
});

describe("DATE-03: a multi-day span collapsed to one day", () => {
  it("flags a report that names only the first day", () => {
    const f = dateSpanKept.run(ctx("We had a productive visit to the GSUK Cairo Fair on 15 October.", [fair()]));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("GSUK Cairo Fair");
    expect(f[0]!.summary).toContain("2026-10-15");
    expect(f[0]!.summary).toContain("2026-10-17");
  });

  it("says nothing when both ends of the span are stated", () => {
    const artifact = "The GSUK Cairo Fair ran from 15 October to 17 October, and was well attended.";
    expect(dateSpanKept.run(ctx(artifact, [fair()]))).toEqual([]);
  });

  it("recognises the end date in ISO form even when the start is prose", () => {
    const artifact = "GSUK Cairo Fair: 15 October to 2026-10-17.";
    expect(dateSpanKept.run(ctx(artifact, [fair()]))).toEqual([]);
  });

  it("recognises a UK-style numeric date", () => {
    const artifact = "GSUK Cairo Fair ran 15/10/2026 to 17/10/2026.";
    expect(dateSpanKept.run(ctx(artifact, [fair()]))).toEqual([]);
  });

  it("recognises a short month name", () => {
    const artifact = "GSUK Cairo Fair, 15 Oct to 17 Oct 2026.";
    expect(dateSpanKept.run(ctx(artifact, [fair()]))).toEqual([]);
  });

  it("recognises month-first prose", () => {
    const artifact = "GSUK Cairo Fair ran from October 15 to October 17, 2026.";
    expect(dateSpanKept.run(ctx(artifact, [fair()]))).toEqual([]);
  });

  it("tolerates an ordinal suffix on the day", () => {
    const artifact = "GSUK Cairo Fair ran from the 15th to the 17th of October.";
    expect(dateSpanKept.run(ctx(artifact, [fair()]))).toEqual([]);
  });

  it("is silent when the subject is never mentioned at all", () => {
    // Absence is COV-01's finding, not this one -- reporting both would be
    // two findings for one gap.
    expect(dateSpanKept.run(ctx("Nothing about that fair.", [fair()]))).toEqual([]);
  });

  it("is silent when neither date is mentioned near the subject", () => {
    expect(
      dateSpanKept.run(ctx("The GSUK Cairo Fair went well.", [fair()])),
    ).toEqual([]);
  });

  it("does nothing for a single-day span", () => {
    const oneDay = fair({ start: "2026-10-15", end: "2026-10-15" });
    expect(dateSpanKept.run(ctx("Visited on 15 October.", [oneDay]))).toEqual([]);
  });

  it("does nothing when end is before start -- not a real span to check", () => {
    const backwards = fair({ start: "2026-10-17", end: "2026-10-15" });
    expect(dateSpanKept.run(ctx("Visited on 17 October.", [backwards]))).toEqual([]);
  });

  it("does nothing when the app supplies no spans", () => {
    expect(dateSpanKept.run(ctx("Anything at all.", []))).toEqual([]);
  });

  it("reports as a warning, not an error", () => {
    const f = dateSpanKept.run(ctx("Visited the GSUK Cairo Fair on 15 October.", [fair()]));
    expect(f[0]!.severity).toBe("warning");
  });

  it("is scoped to the named section when one is given", () => {
    const scoped = fair({ section: "Recruitment Event Outcomes" });
    const artifact =
      "## Recruitment Event Outcomes\n\nGSUK Cairo Fair, 15 October.\n\n## Notes\n\nAlso ran 17 October per the organiser.\n";
    // The end date only appears outside the named section, so the section
    // itself still reads as collapsed to one day.
    expect(dateSpanKept.run(ctx(artifact, [scoped]))).toHaveLength(1);
  });

  it("falls back to the whole document when the named section is absent", () => {
    const scoped = fair({ section: "Recruitment Event Outcomes" });
    const artifact = "GSUK Cairo Fair ran 15 October to 17 October under a different heading.";
    expect(dateSpanKept.run(ctx(artifact, [scoped]))).toEqual([]);
  });
});
