import { describe, it, expect } from "vitest";
import { fold, sameName } from "./text.js";
import { normaliseName } from "./parse.js";
import { runChecks } from "./run.js";
import type { AppConfig, Attribution, Breakdown, Entity, SourceFacts } from "./types.js";

const config = { appId: "t", sections: [] } as AppConfig;
const facts = (extra: Partial<SourceFacts>): SourceFacts => ({
  entities: [],
  figures: [],
  links: [],
  forbidden: [],
  ...extra,
});
const ids = (md: string, f: SourceFacts, id: string) =>
  runChecks(md, f, config).findings.filter((x) => x.checkId === id);

describe("fold", () => {
  it("removes accents and keeps length", () => {
    for (const s of ["Lycée Français", "São Paulo", "Côte d'Ivoire", "Türkiye", "Diyarbakır", "Łódź"]) {
      expect(fold(s)).toHaveLength(s.normalize("NFC").length);
    }
    expect(fold("Lycée Français")).toBe("Lycee Francais");
    expect(fold("Diyarbakır")).toBe("Diyarbakir");
    expect(fold("Łódź")).toBe("Lodz");
  });

  it("treats decomposed and composed input alike", () => {
    expect(fold("José")).toBe("Jose");
  });

  it("leaves other scripts alone", () => {
    expect(fold("القاهرة")).toBe("القاهرة");
  });

  it("compares names without case or accents", () => {
    expect(sameName("José Ruiz", "jose ruiz")).toBe(true);
    expect(sameName("José Ruiz", "Josh Ruiz")).toBe(false);
  });

  it("normaliseName keeps dotless i and non-Latin letters as letters", () => {
    expect(normaliseName("Diyarbakır")).toBe(normaliseName("Diyarbakir"));
    expect(normaliseName("القاهرة")).not.toBe("");
  });
});

describe("ATTR-01 with accented names", () => {
  const TEAM = ["José Ruiz", "Zoë Hart", "Tom Bright"];
  const visit = (subject: string, expected: string | null): Attribution => ({
    subject,
    expected,
    candidates: TEAM,
  });

  it("does not accuse anyone when the report drops the accent", () => {
    const md = "Jose Ruiz visited Agência Lusa and agreed a new intake target.";
    expect(ids(md, facts({ attributions: [visit("Agência Lusa", "José Ruiz")] }), "ATTR-01")).toEqual([]);
  });

  it("finds a name that ends in an accented letter", () => {
    const md = "Zoë visited Agência Lusa. Zoë Hart agreed a new intake target there.";
    const f = ids(md, facts({ attributions: [visit("Agencia Lusa", "Tom Bright")] }), "ATTR-01");
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("Zoë Hart");
  });
});

describe("COV-01 with accented names", () => {
  const school: Entity = { id: "s", kind: "school", label: "Lycée Français du Caire" };

  it("counts the unaccented spelling as a mention", () => {
    const md = "We visited Lycee Francais du Caire on Tuesday.";
    expect(ids(md, facts({ entities: [school] }), "COV-01")).toEqual([]);
  });

  it("still reports a school that is not mentioned", () => {
    expect(ids("We visited no schools.", facts({ entities: [school] }), "COV-01")).toHaveLength(1);
  });
});

describe("BRK-02 with accented labels", () => {
  const byCountry = (): Breakdown => ({
    id: "leads-by-country",
    label: "leads by country",
    total: 5,
    totalLabel: "total leads",
    parts: [
      { label: "Türkiye", value: 3 },
      { label: "Côte d'Ivoire", value: 2 },
    ],
  });

  it("reads a figure against an accented label, either spelling", () => {
    const md = "Total leads: 5\n\n- Turkiye: 3\n- Côte d'Ivoire: 2";
    expect(ids(md, facts({ breakdowns: [byCountry()] }), "BRK-02")).toEqual([]);
  });

  it("catches a wrong figure and quotes the report as written", () => {
    const md = "Total leads: 5\n\n- Türkiye: 4\n- Côte d'Ivoire: 2";
    const f = ids(md, facts({ breakdowns: [byCountry()] }), "BRK-02");
    expect(f.length).toBeGreaterThan(0);
    expect(f.map((x) => x.evidence ?? "").join(" ")).toContain("Türkiye");
  });
});
