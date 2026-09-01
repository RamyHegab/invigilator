import { describe, it, expect } from "vitest";
import { declaredButUnused, usedButUndeclared } from "./scope.js";
import type { CheckContext, Declaration, SourceFacts } from "../types.js";

const facts = (declarations: Declaration[]): SourceFacts => ({
  entities: [],
  figures: [],
  links: [],
  forbidden: [],
  declarations,
});

// These two checks never read the artifact -- they compare the source against
// itself -- so every case here passes an empty one deliberately.
const ctx = (declarations: Declaration[]): CheckContext =>
  ({
    config: { appId: "test", sections: [] },
    facts: facts(declarations),
    artifact: "",
  }) as unknown as CheckContext;

const countries = (declared: string[], observed: string[]): Declaration[] => [
  { kind: "destination country", declared, observed, where: "the trip's destinations" },
];

describe("COV-06: declared but nothing recorded in it", () => {
  it("says nothing when every declared country was visited", () => {
    const f = declaredButUnused.run(ctx(countries(["Egypt", "Algeria"], ["Algeria", "Egypt"])));
    expect(f).toEqual([]);
  });

  it("flags a country that was planned and never happened", () => {
    const f = declaredButUnused.run(ctx(countries(["Egypt", "Algeria"], ["Egypt"])));
    expect(f).toHaveLength(1);
    expect(f[0]!.checkId).toBe("COV-06");
    expect(f[0]!.summary).toContain("Algeria");
    expect(f[0]!.evidence).toBe("Algeria");
  });

  it("warns rather than errors, because a spelling difference reads the same", () => {
    const f = declaredButUnused.run(ctx(countries(["Algeria"], [])));
    expect(f[0]!.severity).toBe("warning");
    expect(f[0]!.detail).toContain("spelled differently");
  });

  it("points at where the declaration lives", () => {
    const f = declaredButUnused.run(ctx(countries(["Algeria"], [])));
    expect(f[0]!.detail).toContain("the trip's destinations");
  });

  it("quotes the spelling a person actually typed", () => {
    const f = declaredButUnused.run(ctx(countries(["  Algeria  "], [])));
    expect(f[0]!.evidence).toBe("Algeria");
  });
});

describe("COV-07: recorded somewhere never declared", () => {
  it("flags work in a country outside the declared scope", () => {
    const f = usedButUndeclared.run(ctx(countries(["Egypt"], ["Egypt", "Morocco"])));
    expect(f).toHaveLength(1);
    expect(f[0]!.checkId).toBe("COV-07");
    expect(f[0]!.summary).toContain("Morocco");
  });

  it("says nothing when the itinerary stays inside the declared scope", () => {
    expect(usedButUndeclared.run(ctx(countries(["Egypt", "Morocco"], ["Egypt"])))).toEqual([]);
  });

  it("reports each undeclared place once, however many activities happened there", () => {
    const f = usedButUndeclared.run(ctx(countries(["Egypt"], ["Morocco", "Morocco", "morocco"])));
    expect(f).toHaveLength(1);
  });
});

describe("matching tolerates how people type", () => {
  const cases: Array<[string, string, string]> = [
    ["case", "EGYPT", "egypt"],
    ["surrounding space", " Egypt ", "Egypt"],
    ["accents", "Cote d'Ivoire", "Côte d'Ivoire"],
    ["a full stop", "St. Lucia", "St Lucia"],
    ["a leading 'the'", "The Gambia", "Gambia"],
  ];

  for (const [what, declared, observed] of cases) {
    it(`ignores ${what}`, () => {
      expect(declaredButUnused.run(ctx(countries([declared], [observed])))).toEqual([]);
      expect(usedButUndeclared.run(ctx(countries([declared], [observed])))).toEqual([]);
    });
  }

  it("reports a missing apostrophe, because the letters differ", () => {
    // "Cote d'Ivoire" and "Cote dIvoire" normalise to "cote d ivoire" and
    // "cote divoire". Reported, not smoothed: the check's job is to notice
    // that the two places disagree, and a person can dismiss it in a second.
    expect(declaredButUnused.run(ctx(countries(["Cote d'Ivoire"], ["Cote dIvoire"])))).toHaveLength(
      1,
    );
  });

  it("still reports a genuinely different name", () => {
    // "UAE" and "United Arab Emirates" are the same country and will be
    // flagged. That is the intended trade: smoothing it away needs a
    // synonym list, and a wrong synonym list hides real gaps silently.
    expect(declaredButUnused.run(ctx(countries(["United Arab Emirates"], ["UAE"])))).toHaveLength(1);
  });
});

describe("nothing to compare", () => {
  it("is silent when the app supplies no declarations", () => {
    expect(declaredButUnused.run(ctx([]))).toEqual([]);
    expect(usedButUndeclared.run(ctx([]))).toEqual([]);
  });

  it("ignores blank entries rather than flagging an empty name", () => {
    const f = declaredButUnused.run(ctx(countries(["Egypt", "", "   "], ["Egypt"])));
    expect(f).toEqual([]);
  });
});
