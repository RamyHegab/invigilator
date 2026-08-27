import type { CountFact, SourceFacts } from "../types.js";

/**
 * Orbis aggregate report → SourceFacts.
 *
 * The aggregate report is two different things bolted together, and only one of
 * them needs checking. Its counts and per-country tables are computed in code
 * and are correct by construction. Its **AI summary is written by a model from
 * the prose of other reports** — told to "pull concrete numbers if present" —
 * and until now nothing looked at it at all.
 *
 * That is the least supervised text in the product and the most senior audience
 * for it: a portfolio briefing goes to whoever asks how the year is going.
 *
 * A second adapter rather than an extension of the trip one, because the
 * artifact is a different shape with different sections. Same engine, same
 * checks.
 */

export type OrbisAggregateInput = {
  startDate: string;
  endDate: string;
  totals: {
    trips: number;
    events: number;
    agentVisits: number;
    schoolVisits: number;
    otherActivities: number;
  };
  /** Contact strings that must never reach an executive briefing. */
  forbidden?: string[];
};

/**
 * Portfolio totals are claims about the whole, so they are only checked where
 * claims about the whole belong. The briefing's last section is organised by
 * country, and "3 agent visits" there is a true statement about Egypt that
 * would otherwise be measured against a portfolio total of ten.
 */
const WHOLE = "Key Takeaways";

export function toAggregateFacts(input: OrbisAggregateInput): SourceFacts {
  const t = input.totals;

  const counts: CountFact[] = [
    { label: "trips", value: t.trips, aliases: ["trips completed", "recruitment trips"], section: WHOLE },
    {
      label: "recruitment events",
      value: t.events,
      aliases: ["fairs", "recruitment fairs", "fair days", "events"],
      section: WHOLE,
    },
    { label: "agent visits", value: t.agentVisits, aliases: ["agent meetings"], section: WHOLE },
    { label: "school visits", value: t.schoolVisits, aliases: ["schools visited"], section: WHOLE },
  ];

  return {
    period: { start: input.startDate, end: input.endDate },
    entities: [],
    figures: [],
    links: [],
    // Emails and phone numbers are caught by pattern regardless; named contacts
    // need the list, which the caller supplies when it has one.
    forbidden: input.forbidden ?? [],
    counts,
  };
}
