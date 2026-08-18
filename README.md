# Invigilator

Checks generated reports against the data they claim to describe, and says what is
wrong with them.

Built for Orbis first, but **Orbis is a config file, not a dependency**. Nothing in
`src/` imports from any app, and nothing in it knows what a trip, an invoice or a
patient is.

## Why it exists

AI-written reports fail quietly. They are fluent, well-formatted, and confidently
wrong in ways nobody catches in review. Four examples, all real, all found in
production reports on 2026-08-16:

- The report was **instructed to name a branch it was never given** — so the model
  invented plausible ones.
- A cost table showed **four numbers where the first three did not sum to the fourth**,
  with nothing on the page to say why.
- An invitation priced **EUR 450 was stored as if it were GBP** — a silent 20% error
  in every total it reached.
- Reports could be generated for **trips that had not happened yet**, in the past
  tense, describing outcomes that did not exist.

Every one of those reads perfectly. None would survive a check against the source
data, which is all this does.

## The design

One idea: **checks are generic, facts are not.**

An app supplies two things:

1. **An `AppConfig`** — what a correct report looks like for that app: its sections,
   the tables they must contain, whether one currency is enforced, which checks are
   disabled and why. This is the machine-readable twin of the app's domain model —
   the document its owner reads, corrects and signs off.
2. **An adapter** — a pure function mapping the app's rows into `SourceFacts`:
   entities that must be mentioned, figures that must reconcile, links that must
   resolve, strings that must never appear.

Every check then works on those two shapes alone. That is what lets the same engine
run against a second app without being rewritten.

```
app rows ──adapter──▶ SourceFacts ─┐
                                   ├─▶ runChecks() ──▶ Finding[]
app domain model ──▶ AppConfig ────┘
```

## Checks

Deterministic only — free, instant, and incapable of a false positive, so that a
finding is always worth reading.

| Id | What it catches |
|---|---|
| `COV-01` | Something in the data the report never mentions |
| `DATE-01` | A date outside the period covered (sections may be exempted — follow-up due dates are meant to be later) |
| `FIG-01` | A figure missing or altered rather than copied |
| `FIG-02` | Categories that do not sum to the total they break down |
| `CUR-01` | A second currency, where the app enforces one |
| `LINK-01` | A link that is not in the source data — an invented link resolves to nothing but reads as authoritative |
| `LINK-02` | A required link the report failed to include |
| `PII-01/02/03` | Email addresses, phone numbers, third-party contact names |
| `STR-01..04` | Missing sections, wrong order, a mandated table absent, an empty section |

Judgement checks — does the summary address the stated objectives, is a claim
supported by the data — need a model and run in a separate pass. They are
deliberately **not** in this registry.

## Adding an app

1. Write its domain model as prose and **have its owner correct it**. This step is the
   product, not paperwork: every check is derived from it, and an error here becomes a
   permanently wrong checker.
2. Turn the agreed structure into a config file (see `config/orbis.json`).
3. Write an adapter (see `src/adapters/orbis-trip-report.ts`) — a pure function over
   rows the caller has already fetched. No client, no network, no import from the app.

## Running

```bash
npm install
npm run typecheck
npm test
```

## Status

Engine and deterministic checks: working, 25 tests. Not yet wired to a live database —
the Orbis adapter is written and unit-testable but nothing calls it in production yet.
Telemetry capture and the email alerting agent are the next two pieces.
