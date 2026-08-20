/**
 * Generate a report from real trip data and check it.
 *
 * This is a **validation script, not part of the engine**. It is the only file
 * in the repo allowed to know where Orbis's source lives, and it exists to
 * answer one question: do the checks hold up against a real model writing about
 * real, messy data?
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/check-live.ts fixtures/orbis-trip-live.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runChecks, formatFindings } from "../src/run.js";
import { toSourceFacts, type OrbisTripInput } from "../src/adapters/orbis-trip-report.js";
import orbisConfig from "../config/orbis.json" with { type: "json" };
import type { AppConfig } from "../src/types.js";

const ORBIS_REPORT_FN = "G:/Projects/orbis-io-buddy/src/lib/trip-report.functions.ts";

/**
 * Read the system prompt out of the deployed source rather than copying it
 * here. A copy would drift, and a report generated from a stale prompt would
 * test nothing.
 */
function liveSystemPrompt(): string {
  const src = readFileSync(ORBIS_REPORT_FN, "utf8");
  // Whitespace-tolerant: the file is CRLF on Windows and the prompt is indented.
  const m = /system:\s*"/.exec(src);
  if (!m) throw new Error("Could not find the system prompt in the Orbis source.");
  const from = m.index + m[0].length - 1;
  let out = "";
  let i = from + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      const next = src[i + 1];
      out += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i++;
  }
  if (out.length < 200) throw new Error("Extracted system prompt looks wrong (too short).");
  return out;
}

type Row = Record<string, any>;

/**
 * PowerShell 5.1 serialises collections as { value: [...], Count: n } rather
 * than a bare array. Unwrap it here so fixtures pulled on Windows just work.
 */
function asArray<T = Row>(v: any): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && Array.isArray(v.value)) return v.value as T[];
  if (v == null) return [];
  return [v as T];
}

/** The fixture is flat SQL rows; the adapter takes the app's nested shape. */
function toAdapterInput(fixture: Row): OrbisTripInput {
  return {
    trip: asArray(fixture.trip)[0] ?? fixture.trip,
    activities: asArray(fixture.activities).map((a) => ({
      ...a,
      agents: a.agent_trading_name ? { trading_name: a.agent_trading_name, hq_country: a.agent_hq_country } : null,
      agent_branches: a.branch_name || a.branch_city
        ? { branch_name: a.branch_name, city: a.branch_city, country: a.branch_country }
        : null,
      schools: a.school_name ? { name: a.school_name, city: a.school_city, country: a.school_country } : null,
    })),
    hotels: asArray(fixture.hotels),
    contacts: asArray(fixture.contacts),
    accountCurrency: fixture.accountCurrency ?? "GBP",
    // Supplied by the fixture, already aggregated by the app's own
    // computeLeadMetrics. Absent for a trip with no mapped lead form, which is
    // the normal case and simply leaves BRK-01..03 nothing to check.
    leads: fixture.leads ?? null,
  };
}

/** A faithful copy of the app's context builder, for a faithful report. */
function buildContext(input: OrbisTripInput): string {
  const { trip, activities, hotels } = input;
  const label = (c?: string | null) => c ?? "";
  let ctx = `# Trip: ${trip.title}\n`;
  ctx += `Dates: ${trip.start_date} to ${trip.end_date}\n`;
  ctx += `Destinations: ${(trip.destinations ?? []).join(", ") || "—"}\n`;
  if ((trip as any).objectives) ctx += `\n## Trip Objectives\n${(trip as any).objectives}\n`;
  if ((trip as any).notes) ctx += `Notes: ${(trip as any).notes}\n`;

  const totals: Record<string, Record<string, number>> = { travel: {}, hotel: {}, events: {}, total: {} };
  const costCategory = (type: string) => (type === "travel" ? "travel" : "events");
  for (const a of activities) {
    if (a.cost == null) continue;
    const cur = a.cost_currency || "GBP";
    const amt = Number(a.cost);
    totals.total![cur] = (totals.total![cur] ?? 0) + amt;
    const cat = costCategory(a.type);
    totals[cat]![cur] = (totals[cat]![cur] ?? 0) + amt;
  }
  for (const h of hotels) {
    if (h.cost == null) continue;
    const cur = h.cost_currency || "GBP";
    const amt = Number(h.cost);
    totals.total![cur] = (totals.total![cur] ?? 0) + amt;
    totals.hotel![cur] = (totals.hotel![cur] ?? 0) + amt;
  }
  const fmt = (m: Record<string, number>) =>
    Object.entries(m).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(", ") || "—";
  ctx += `\n## Cost Totals\n- Travel: ${fmt(totals.travel!)}\n- Hotels: ${fmt(totals.hotel!)}\n- Events: ${fmt(
    totals.events!,
  )}\n- Total: ${fmt(totals.total!)}\n`;

  ctx += `\n## Activities (${activities.length})\n`;
  for (const a of activities as any[]) {
    ctx += `\n### ${a.day_date}${a.start_time ? ` ${String(a.start_time).slice(0, 5)}` : ""} — ${a.title} [${a.type}]\n`;
    if (a.type === "travel") {
      const isAir = a.transport_mode === "Air travel";
      const from = isAir ? [label(a.from_country), a.from_city].filter(Boolean).join(" — ") : a.from_city;
      const to = isAir ? [label(a.to_country), a.to_city].filter(Boolean).join(" — ") : a.to_city;
      if (from) ctx += `From: ${from}\n`;
      if (to) ctx += `To: ${to}\n`;
      if (a.transport_mode) ctx += `Mode: ${a.transport_mode}\n`;
      if (a.airline) ctx += `Airline: ${a.airline}${a.flight_number ? ` ${a.flight_number}` : ""}\n`;
    }
    if (a.location) ctx += `Location: ${a.location}\n`;
    const branchLabel = a.agent_branches
      ? [a.agent_branches.branch_name, a.agent_branches.city, label(a.agent_branches.country)]
          .filter(Boolean)
          .join(", ")
      : null;
    const agentRole = a.type === "recruitment_event" ? "Organiser" : "Agent";
    if (a.agents && a.agent_id) {
      ctx += a.type === "agent_visit"
        ? `Agent card: [${a.agents.trading_name}](/agents/${a.agent_id}) _(requires login)_\n`
        : `${agentRole}: [${a.agents.trading_name}](/agents/${a.agent_id})\n`;
    } else if (a.manual_agent) {
      ctx += `${agentRole}: ${a.manual_agent} (${
        a.type === "recruitment_event" ? "third-party operator" : "not in the directory"
      } — no agent card exists, do NOT invent a link)\n`;
    }
    if (branchLabel) ctx += `Branch: ${branchLabel}\n`;
    if (a.schools && a.school_id) ctx += `School: [${a.schools.name}](/schools) (${a.schools.city}, ${a.schools.country})\n`;
    if (a.notes) ctx += `Notes: ${a.notes}\n`;
    if (a.objectives) ctx += `Objectives: ${a.objectives}\n`;
    if (a.visit_notes) ctx += `Notes during visit: ${a.visit_notes}\n`;
    if (a.cost != null) ctx += `Cost: ${a.cost_currency || "GBP"} ${Number(a.cost).toFixed(2)}\n`;
  }
  return ctx;
}

async function generateReport(system: string, prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      // Streamed, like the app. A non-streaming request at this ceiling died
      // with ECONNRESET after ten minutes — the exact failure the app's move
      // to streamText prevents.
      stream: true,
      // Mirrors the app: report writing runs the more capable model with a
      // ceiling large enough that truncation is not the limiting factor.
      model: process.env.AI_MODEL || "claude-opus-5",
      max_tokens: 64000,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  if (!res.body) throw new Error("No response body to stream.");

  const started = Date.now();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason = "unknown";
  let usage: any = {};
  let lastLog = Date.now();

  for await (const chunk of res.body as any) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        text += event.delta.text;
      } else if (event.type === "message_delta") {
        stopReason = event.delta?.stop_reason ?? stopReason;
        usage = { ...usage, ...event.usage };
      } else if (event.type === "message_start") {
        usage = { ...usage, ...event.message?.usage };
      }
    }
    // Long thinking looks like a hang otherwise.
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      console.log(`  …still generating (${Math.round((Date.now() - started) / 1000)}s, ${text.length} chars)`);
    }
  }

  console.log(
    `stop_reason=${stopReason} in=${usage.input_tokens} out=${usage.output_tokens} elapsed=${Math.round(
      (Date.now() - started) / 1000,
    )}s`,
  );
  return text;
}

const fixturePath = process.argv[2];
if (!fixturePath) throw new Error("Pass the fixture path.");

// PowerShell writes UTF-8 with a BOM, which JSON.parse rejects.
const fixture = JSON.parse(readFileSync(fixturePath, "utf8").replace(/^﻿/, ""));
const input = toAdapterInput(fixture);
const facts = toSourceFacts(input);

mkdirSync("out", { recursive: true });

let report: string;
if (process.env.REPORT_FILE) {
  report = readFileSync(process.env.REPORT_FILE, "utf8");
  console.log(`Checking existing report: ${process.env.REPORT_FILE}`);
} else {
  console.log(`Generating a report for "${input.trip.title}" (${input.activities.length} activities)…`);
  report = await generateReport(liveSystemPrompt(), buildContext(input));
  writeFileSync("out/report.md", report, "utf8");
  console.log("Report written to out/report.md");
}

/**
 * Mirror of the app's table rendering, so the artifact we check is the report
 * the user actually receives — not the model's half of it. Deliberately kept
 * crude: its only job is to fill the placeholders with the same facts the app
 * fills them with. The real rendering, and its tests, live in Orbis.
 */
function spliceForCheck(md: string, input: OrbisTripInput, facts: SourceFactsLike): string {
  const rows = [...input.activities].sort((a: any, b: any) =>
    String(a.day_date).localeCompare(String(b.day_date)),
  );
  const itinerary = [
    "| Date | Type | Title | Location |",
    "| --- | --- | --- | --- |",
    ...rows.map((a: any) => {
      const title =
        a.type === "agent_visit" && a.agent_id && a.agents?.trading_name
          ? `[${a.title}](/agents/${a.agent_id}) _(requires login)_`
          : a.title;
      const location =
        a.location || a.agent_branches?.city || a.schools?.city || a.to_city || "—";
      return `| ${a.day_date} | ${a.type} | ${title} | ${location} |`;
    }),
  ].join("\n");

  const fig = (id: string) => facts.figures.find((f) => f.id === id)?.value ?? 0;
  const cur = input.accountCurrency;
  const cost = [
    "| Category | Amount |",
    "| --- | --- |",
    `| Travel | ${cur} ${fig("travel").toFixed(2)} |`,
    `| Hotels | ${cur} ${fig("hotels").toFixed(2)} |`,
    `| Events | ${cur} ${fig("events").toFixed(2)} |`,
    `| **Total** | **${cur} ${fig("total").toFixed(2)}** |`,
  ].join("\n");

  return md.split("{{ITINERARY_TABLE}}").join(itinerary).split("{{COST_TABLE}}").join(cost);
}

type SourceFactsLike = { figures: Array<{ id: string; value: number }> };

const checkedReport = spliceForCheck(report, input, facts);
writeFileSync("out/report-final.md", checkedReport, "utf8");
const result = runChecks(checkedReport, facts, orbisConfig as unknown as AppConfig);

console.log("\n=== FACTS DERIVED FROM THE DATABASE ===");
console.log(`entities: ${facts.entities.length}  figures: ${facts.figures.length}  links: ${facts.links.length}  forbidden strings: ${facts.forbidden.length}`);
for (const f of facts.figures) console.log(`  ${f.label}: ${f.value.toFixed(2)} ${f.currency ?? ""}`);

// The app renders these two tables from data and splices them in where the
// model leaves a placeholder. Verify the model left them exactly once each —
// that is what makes the report complete regardless of trip size.
console.log("\n=== STRUCTURE ===");
const placeholdersOk = ["{{COST_TABLE}}", "{{ITINERARY_TABLE}}"].every(
  (t) => report.split(t).length - 1 === 1,
);
if (!placeholdersOk) console.log("  ⚠ placeholder problem — see counts below");
for (const token of ["{{COST_TABLE}}", "{{ITINERARY_TABLE}}"]) {
  const count = report.split(token).length - 1;
  console.log(`  ${token}: ${count === 1 ? "present once ✓" : `${count} occurrences ✗`}`);
}
const headings = report.match(/^#{1,3}\s+.*$/gm) ?? [];
console.log(`  headings: ${headings.length}`);
for (const h of headings) console.log(`    ${h.trim()}`);

console.log("\n=== CHECK RESULT ===");
console.log(`checks run: ${result.ran.join(", ")}`);
if (result.skipped.length) console.log(`skipped: ${result.skipped.map((s) => s.id).join(", ")}`);
console.log("");
console.log(formatFindings(result));
