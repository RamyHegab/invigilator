import { describe, it, expect } from "vitest";
import { postalAddress } from "./address.js";
import type { CheckContext } from "../types.js";

const ctx = (artifact: string, addresses: string[] = []): CheckContext =>
  ({
    config: { appId: "t", sections: [] },
    facts: { entities: [], figures: [], links: [], forbidden: [], addresses },
    artifact,
  }) as unknown as CheckContext;

const run = (artifact: string, addresses: string[] = []) => postalAddress.run(ctx(artifact, addresses));

describe("PII-04: an address the app holds", () => {
  const held = "Remzi Oguz Arik Mahallesi, 06680 Cankaya, Ankara";

  it("is an error when a held address appears in the report", () => {
    const f = run(`We met at ${held} on the second day.`, [held]);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("error");
    expect(f[0]!.summary).toContain("held in your records");
  });

  it("still finds it when punctuation and case differ", () => {
    const f = run("Office: remzi oguz arik mahallesi 06680 cankaya ankara.", [held]);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("error");
  });

  it("ignores a held value too short to be an address", () => {
    expect(run("We flew to Cairo.", ["Cairo"])).toEqual([]);
  });

  it("says nothing when the address is not in the report", () => {
    expect(run("A productive visit to Ankara.", [held])).toEqual([]);
  });

  it("reports one held address once", () => {
    expect(run(`${held}. Again: ${held}.`, [held])).toHaveLength(1);
  });
});

describe("PII-04: something shaped like an address", () => {
  it("warns on a UK postcode", () => {
    const f = run("Their head office is at L3 5UA.");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("warning");
    expect(f[0]!.evidence).toBe("L3 5UA");
  });

  it("warns on a longer postcode written without a space", () => {
    expect(run("Sent to SW1A1AA today.")[0]!.evidence).toBe("SW1A1AA");
  });

  it("warns on a PO box in any spelling", () => {
    expect(run("Write to P.O. Box 4471 for details.")).toHaveLength(1);
    expect(run("Write to PO Box 4471.")).toHaveLength(1);
  });

  it("warns on a house number and street", () => {
    const f = run("Meridian Education is at 12 Baker Street, London.");
    expect(f).toHaveLength(1);
    expect(f[0]!.evidence).toContain("12 Baker Street");
  });

  it("copes with a flat letter, a range and a longer street name", () => {
    expect(run("221B Baker Street")).toHaveLength(1);
    expect(run("14-16 Sheikh Zayed Road")).toHaveLength(1);
    expect(run("3 Rue Hassan Sabry Avenue")).toHaveLength(1);
  });

  it("warns rather than errors, because a venue is not a leak", () => {
    expect(run("The fair was held at 1 Sheikh Zayed Road.")[0]!.severity).toBe("warning");
  });
});

describe("PII-04: things that are not addresses", () => {
  // Every one of these is ordinary report text that a careless pattern reads
  // as an address, and a check that cries wolf gets ignored.
  const clean: Array<[string, string]> = [
    ["a date range", "The fair ran 12 September to 20 September 2026."],
    ["an ISO date", "Due 2026-10-20."],
    ["a table row", "| 1 | Send revised commission schedule to Meridian | Priya Raman | 2025-10-20 |"],
    ["a cost", "| Total | £4,083 |"],
    ["a count of days", "Nine days across Lagos and Abuja."],
    ["days on the road", "We spent 3 days on the road between fairs."],
    ["a lower-case phrase", "12 new leads by the way we asked."],
    ["a lead figure", "96 leads were captured at the Lagos fair."],
    ["a month abbreviation", "Arrived 20 Sep Way ahead of schedule."],
    ["a trip title", "GSUK Morocco Fair - OCT 2026 - Tangier"],
    ["a currency code", "Costs of GBP 1200 and EUR 340."],
    ["a section id", "See COV-01 and PII-04 for details."],
  ];
  for (const [what, text] of clean) {
    it(`does not fire on ${what}`, () => {
      expect(run(text)).toEqual([]);
    });
  }

  it("does nothing when the app holds no addresses and the report has none", () => {
    expect(run("An ordinary report about a trip.", [])).toEqual([]);
  });
});
