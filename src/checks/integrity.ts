import type { Check, Finding } from "../types.js";
import { mentions, normaliseHeading, parseLinks, parseSections, parseTables } from "../parse.js";

/**
 * No link the source did not supply, and none of the required ones missing.
 *
 * A model told to link agent names will happily invent a plausible id when it
 * has none — the link renders, resolves to nothing, and reads as authoritative.
 */
export const links: Check = {
  id: "LINK-01",
  title: "Links are real and complete",
  run: ({ facts, artifact }) => {
    const findings: Finding[] = [];
    const allowed = new Set(facts.links.map((l) => l.href));
    const inArtifact = parseLinks(artifact);

    for (const l of inArtifact) {
      // External links are the writer's business; internal ones must be sourced.
      if (/^https?:\/\//i.test(l.href)) continue;
      if (allowed.has(l.href)) continue;
      findings.push({
        checkId: "LINK-01",
        severity: "error",
        summary: `The report links to ${l.href}, which is not in the source data.`,
        detail: "An invented link resolves to nothing but reads as authoritative.",
        evidence: `[${l.label}](${l.href})`,
      });
    }

    const hrefs = new Set(inArtifact.map((l) => l.href));
    for (const required of facts.links.filter((l) => l.required)) {
      if (hrefs.has(required.href)) continue;
      findings.push({
        checkId: "LINK-02",
        severity: "warning",
        summary: `The report does not link "${required.label}" as it should.`,
        detail: `Expected a link to ${required.href}.`,
      });
    }
    return findings;
  },
};

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Deliberately conservative: long digit runs with separators, not any number.
const PHONE = /(?:\+\d[\d\s().-]{7,}\d)|(?:\b0\d[\d\s().-]{7,}\d\b)/g;

/**
 * No third-party personal data.
 *
 * `forbidden` holds exact strings taken from the app's own contact records, so
 * matches are facts rather than guesses. Own-team names are not in that list —
 * naming a colleague as the owner of a follow-up is not the risk this guards.
 */
export const noPersonalData: Check = {
  id: "PII-01",
  title: "No contact details or third-party names",
  run: ({ facts, artifact }) => {
    const findings: Finding[] = [];

    for (const m of artifact.matchAll(EMAIL)) {
      findings.push({
        checkId: "PII-01",
        severity: "error",
        summary: "The report contains an email address.",
        evidence: m[0],
      });
    }
    for (const m of artifact.matchAll(PHONE)) {
      findings.push({
        checkId: "PII-02",
        severity: "error",
        summary: "The report contains what looks like a phone number.",
        evidence: (m[0] ?? "").trim(),
      });
    }
    for (const name of facts.forbidden) {
      if (!mentions(artifact, name)) continue;
      findings.push({
        checkId: "PII-03",
        severity: "error",
        summary: `The report names "${name}", a third-party contact from your records.`,
        detail:
          "Most likely lifted from a free-text note. Contact details are never sent to the model, so this reached the report through someone's typing.",
        evidence: name,
      });
    }
    return findings;
  },
};

/**
 * The artifact has the shape this app's template calls for.
 *
 * Section structure is per-app configuration, never hardcoded: one
 * institution's report template is not another's.
 */
export const structure: Check = {
  id: "STR-01",
  title: "Required sections and tables are present",
  run: ({ config, artifact }) => {
    const findings: Finding[] = [];
    const sections = parseSections(artifact);
    const names = sections.map((s) => s.name.toLowerCase());

    for (const spec of config.sections) {
      if (!spec.required) continue;
      if (names.includes(spec.name.toLowerCase())) continue;
      findings.push({
        checkId: "STR-01",
        severity: "error",
        summary: `The report is missing the "${spec.name}" section.`,
      });
    }

    // Order, judged only over the sections that are actually present.
    const expectedOrder = config.sections
      .map((s) => s.name.toLowerCase())
      .filter((n) => names.includes(n));
    const actualOrder = names.filter((n) => expectedOrder.includes(n));
    if (expectedOrder.join("|") !== actualOrder.join("|")) {
      findings.push({
        checkId: "STR-02",
        severity: "warning",
        summary: "The report's sections are out of order.",
        detail: `Expected ${expectedOrder.join(" → ")}, found ${actualOrder.join(" → ")}.`,
      });
    }

    for (const spec of config.sections) {
      if (!spec.tableColumns?.length) continue;
      const section = sections.find((s) => s.name.toLowerCase() === spec.name.toLowerCase());
      if (!section) continue; // already reported as missing
      const tables = parseTables(section.body);
      const match = tables.find((t) =>
        spec.tableColumns!.every((c) =>
          t.columns.some((actual) => normaliseHeading(actual).toLowerCase() === c.toLowerCase()),
        ),
      );
      if (match) continue;
      findings.push({
        checkId: "STR-03",
        severity: "warning",
        summary: `"${spec.name}" does not contain the table it should.`,
        detail: `Expected columns: ${spec.tableColumns.join(" | ")}. Found ${
          tables.length ? tables.map((t) => t.columns.join(" | ")).join(" ; ") : "no table"
        }.`,
      });
    }

    for (const spec of config.sections) {
      if (!spec.required) continue;
      const section = sections.find((s) => s.name.toLowerCase() === spec.name.toLowerCase());
      if (!section) continue;
      if (section.body.replace(/[\s*_-]/g, "").length === 0) {
        findings.push({
          checkId: "STR-04",
          severity: "error",
          summary: `The "${spec.name}" section is empty.`,
        });
      }
    }
    return findings;
  },
};
