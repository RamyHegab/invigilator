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
| `COV-01` | Something in the data the report never mentions — or, for an entity tied to a section, mentions but not where a reader will look |
| `DATE-01` | A date outside the period covered (sections may be exempted — follow-up due dates are meant to be later) |
| `FIG-01` | A figure missing or altered rather than copied |
| `FIG-02` | Categories that do not sum to the total they break down |
| `CUR-01` | A second currency, where the app enforces one |
| `LINK-01` | A link that is not in the source data — an invented link resolves to nothing but reads as authoritative |
| `LINK-02` | A required link the report failed to include |
| `PII-01/02/03` | Email addresses, phone numbers, third-party contact names |
| `STR-01..04` | Missing sections, wrong order, a mandated table absent, an empty section |
| `CNT-01` | A count the report asserts about itself that the data contradicts |
| `BRK-01` | The whole of a breakdown — a stated total that is not the total |
| `BRK-02` | A part of a breakdown that is wrong, **or one the report never states at all** |
| `BRK-03` | A ranked breakdown presented in the wrong order — a smaller item named as the largest |
| `ATTR-01` | A person credited with something the record gives to someone else, or to nobody |
| `COV-06` | Scope declared and never used — a country on the trip that nothing ever happened in |
| `COV-07` | Scope used and never declared — work recorded somewhere the trip never said it was going |

`COV-06/07` are the one deliberate exception to "incapable of a false positive",
and they report as **warnings** for that reason. Both sides are free-typed, so
"UAE" against "United Arab Emirates" is flagged. Smoothing that away needs a
synonym list, and a wrong synonym list hides real gaps in silence — a worse
failure than a finding a person dismisses in a second.

`BRK-01..03` are what the Orbis domain model calls `LEAD-01..03`. The engine has
no notion of a lead: a breakdown is any whole with labelled parts, so the same
three checks serve an invoice's line items or a cohort's age bands unchanged.

`BRK-02`'s omission finding is the only check here that looks for something that
is *not* in the report. It exists because of a real failure that every other
check passed: a report stated five leads captured and then said no study-level
split had been recorded, while the database held three UG and one PGT.

Judgement checks — does the summary address the stated objectives, is a claim
supported by the data — need a model and run in a separate pass. They are
deliberately **not** in this registry.

## Behavioural checks

The other half. Reports are checked against the data they describe; behaviour is
checked against itself, because nobody supplies a "correct" answer for how an
application should feel. `runSignals()` takes a window of events and looks for
shapes that only appear when something is wrong.

| Id | What it catches |
|---|---|
| `SIG-01` | A control several people click and get nothing from |
| `SIG-02` | An error that keeps happening and is never reported |
| `SIG-03` | A request that keeps failing behind a spinner |

Every one asks the same question first: **did this happen to several different
people?** One person clicking a button eleven times has had a bad afternoon;
three people clicking it means the button is lying about being clickable. Both a
minimum number of people and a minimum number of occurrences must be met —
either alone reports coincidences.

## Tallies

Figures an artifact presents as fact. AGG-01..03 in the Orbis domain model.

| Id | What it catches |
|---|---|
| TAL-01 | A stated figure a recount does not support |
| TAL-02 | A breakdown that does not add up to the whole it breaks down |
| TAL-03 | Source records that fell into no category and vanished from both |

These exist because *computed in code, therefore correct* is not true. Calculating
a figure rather than writing it removes one failure and not the other: the sums can
still be wrong, the categories can still fail to cover everything, and nobody thinks
to check arithmetic the way they check prose.

The app recounts, because only the app knows what its records mean. The value is
not that the engine counts better — it is that counting twice by two routes catches
the case where one route is wrong.

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

**Report checks run in production.** Orbis imports this package and checks every new
report overnight, and its aggregate briefing as it is generated; findings reach the
owner as a notification and an email. 136 tests.

The checks run inside the consuming app, not here. That is deliberate: no trip data,
no report text and no third-party contact details have to leave an application to be
checked.

Two of them never read the report at all. `COV-06` and `COV-07` compare a trip's
declared destinations against the countries its activities actually happened in
— a disagreement inside the source, which a faithful report reproduces
faithfully and no reader can catch.

**The behavioural checks have never seen real traffic.** Capture went live on
2026-08-26; the first events of consequence will come from trips in September and
October. Until then `SIG-01..03` are fixture-tested only, and the note below says why
that is worth being nervous about.

Most of the deterministic report checks in the Orbis domain model are implemented.
Still to come: `COV-02` and `COV-05`, `DATE-03`, `LINK-03`, and the judgement pass.

### A note on false positives

Every check here has produced at least one, and each was found by running against a
real generated report rather than a fixture. A table row's number binding to the row
beneath it; a ratio read as a count; a figure in parentheses read as absent; a name
with an em dash read as a different name; a whole table read as one paragraph.

Fixtures agree with whoever wrote them. Before trusting a new check, run it over real
output and read every finding — a checker's first findings are as likely to be its own
bugs as the app's.
