import { describe, it, expect } from "vitest";
import { qualifiers } from "./qualifier.js";
import type { CheckContext, Qualifier } from "../types.js";

const ctx = (artifact: string, qs: Qualifier[]): CheckContext =>
  ({
    config: { appId: "test", sections: [] },
    facts: { entities: [], figures: [], links: [], forbidden: [], qualifiers: qs },
    artifact,
  }) as unknown as CheckContext;

const agency = (permitted: string[]): Qualifier[] => [
  { subject: "Edvoy", kind: "branch", permitted },
];

describe("QUAL-01: a sub-name the record never gave", () => {
  it("flags a branch that does not exist on the trip", () => {
    const f = qualifiers.run(
      ctx("| Edvoy — Alexandria | Met the team |", agency(["Cairo Office"])),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("Alexandria");
    expect(f[0]!.detail).toContain("Cairo Office");
    expect(f[0]!.evidence).toBe("Alexandria");
  });

  it("accepts the branch the record does give", () => {
    expect(
      qualifiers.run(ctx("Edvoy — Cairo Office was visited.", agency(["Cairo Office"]))),
    ).toEqual([]);
  });

  // The report writing a shorter form of the recorded name is correct, and was
  // the first thing that would have made this check unusable.
  it("accepts a shortened form of the recorded name", () => {
    expect(qualifiers.run(ctx("Edvoy — Cairo", agency(["Cairo Office"])))).toEqual([]);
    expect(qualifiers.run(ctx("Edvoy — Cairo Office", agency(["Cairo"])))).toEqual([]);
  });

  it("says something different when the record gives no sub-name at all", () => {
    const f = qualifiers.run(ctx("Edvoy — Alexandria", agency([])));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("the record gives it none");
  });

  it("reports one fault however many rows repeat it", () => {
    const artifact = [
      "| Edvoy — Alexandria | Mon |",
      "| Edvoy — Alexandria | Tue |",
      "| Edvoy - alexandria | Wed |",
    ].join("\n");
    expect(qualifiers.run(ctx(artifact, agency(["Cairo"])))).toHaveLength(1);
  });

  it("reports two different invented names separately", () => {
    const artifact = "| Edvoy — Alexandria |\n| Edvoy — Luxor |";
    expect(qualifiers.run(ctx(artifact, agency(["Cairo"])))).toHaveLength(2);
  });

  it("handles every dash a report might use", () => {
    for (const dash of ["-", "–", "—"]) {
      expect(qualifiers.run(ctx(`Edvoy ${dash} Alexandria`, agency(["Cairo"])))).toHaveLength(1);
    }
  });
});

describe("QUAL-01 stays quiet on ordinary prose", () => {
  // Every case here produced a false positive in an earlier draft, or would
  // have. A check that fires on well-written prose is worse than no check.
  it("ignores a dash used as punctuation mid-sentence", () => {
    const artifact = "Edvoy — a strong first meeting — agreed to send us their pipeline.";
    expect(qualifiers.run(ctx(artifact, agency(["Cairo"])))).toEqual([]);
  });

  it("does not read across a line break", () => {
    expect(qualifiers.run(ctx("Edvoy —\nAlexandria was not visited", agency(["Cairo"])))).toEqual([]);
  });

  it("does not read across a table cell wall", () => {
    expect(qualifiers.run(ctx("| Edvoy — | Alexandria |", agency(["Cairo"])))).toEqual([]);
  });

  it("stops at sentence punctuation", () => {
    expect(qualifiers.run(ctx("Edvoy — Cairo. Alexandria is next year.", agency(["Cairo"])))).toEqual(
      [],
    );
  });

  it("ignores a subject that never appears", () => {
    expect(qualifiers.run(ctx("No agencies were met.", agency(["Cairo"])))).toEqual([]);
  });

  it("is silent when the app supplies no qualifiers", () => {
    expect(qualifiers.run(ctx("Edvoy — Alexandria", []))).toEqual([]);
  });

  it("ignores an agency name containing a dash of its own", () => {
    const f = qualifiers.run(
      ctx("Study-Link — Cairo Office", [
        { subject: "Study-Link", kind: "branch", permitted: ["Cairo Office"] },
      ]),
    );
    expect(f).toEqual([]);
  });
});
