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
| `CNT-01` | A count the report asserts about itself that the data contradicts — COV-05 in the Orbis domain model is the Trip Overview's own "total activities" figure, checked the same way |
| `BRK-01` | The whole of a breakdown — a stated total that is not the total |
| `BRK-02` | A part of a breakdown that is wrong, **or one the report never states at all** |
| `BRK-03` | A ranked breakdown presented in the wrong order — a smaller item named as the largest |
| `ATTR-01` | A person credited with something the record gives to someone else, or to nobody |
| `QUAL-01` | A sub-name attached to a real thing that the record never gave it — "Agency — Branch" where the branch does not exist |
| `COV-02` | A city the trip actually visited that the report never mentions |
| `DATE-03` | A multi-day activity collapsed to its first day — the report gives 15 October for a fair that ran 15–17 |
| `COV-06` | Scope declared and never used — a country on the trip that nothing ever happened in |
| `COV-07` | Scope used and never declared — work recorded somewhere the trip never said it was going |

`COV-06/07`, the Orbis adapter's `COV-02` city entities, and `DATE-03` are the
deliberate exception to "incapable of a false positive", and report as
**warnings** for that reason. The first two read free-typed fields, so "UAE"
against "United Arab Emirates" is flagged — and so is "Casablanca" against
"Casablanaca", found on a real trip and almost certainly one place typed two
ways. Smoothing that away needs a synonym list, and a wrong synonym list hides
real gaps in silence — a worse failure than a finding a person dismisses in a
second. `DATE-03` is a warning for a related but different reason: it can only
look for specific date strings, and a report can correctly convey a span
without ever repeating the end date literally — "over three days from
15 October" is honest and would still be flagged.

`COV-02` shares its mechanism with `COV-01` rather than being a separate
check: an `Entity` now carries an optional `checkId` and `severity`, so two
kinds of "something that must be mentioned" can be numbered, disabled and
scored differently while running through the same one function. The trade-off
is that `disabledChecks` gates a whole `Check` before it runs, so `COV-01` and
`COV-02` cannot currently be turned off independently of each other — only of
every other check. Splitting them into two `Check` objects, each filtering
`facts.entities` by kind, is the fix if that is ever needed.

Cities can only be found where the source structurally records one: a travel
leg's own city columns, or a linked agent branch's or school's city. A city
named only inside a free-typed activity title -- "AHZ — New Cairo" is a Cairo
district, "Global Study — Sheraton Office" is a hotel, neither literally says
a city -- is not read, on purpose. Guessing which titles contain a city name
would be inventing a fact the source does not have, which is the exact mistake
`QUAL-01` exists to catch elsewhere.

`BRK-01..03` are what the Orbis domain model calls `LEAD-01..03`. The engine has
no notion of a lead: a breakdown is any whole with labelled parts, so the same
three checks serve an invoice's line items or a cohort's age bands unchanged.

`BRK-02`'s omission finding is the only check here that looks for something that
is *not* in the report. It exists because of a real failure that every other
check passed: a report stated five leads captured and then said no study-level
split had been recorded, while the database held three UG and one PGT.

`QUAL-01` is `LINK-03` in the Orbis domain model, and has the clearest cause of
any check here: the report prompt required agent-visit titles to read
"Agency - Branch" while the branch was never included in the context, so the
model invented plausible ones. An invented branch is unfalsifiable by reading --
the agency is real, the format is right, and the branch simply does not exist.

`PII-04` (a third party's address in the report) is deterministic after all. The
report writer is never given addresses, so a leak is either free text pasted from
a note -- matched exactly against the addresses the app holds, an error -- or an
address the model invented, matched by pattern, a warning.

### The judgement pass

Three checks need a reader, not a lookup, and run in a separate pass
(`runJudgement`), deliberately **not** in the registry above:

- `QUA-01` -- does the executive summary say anything about each stated objective?
  Lenient by design: "we did not reach X" addresses X. Only silence is reported.
- `QUA-02` -- does the report assert a result, quantity or attributed statement the
  source does not support? Three inventions are hunted: an objective turned into an
  outcome, a hedge ("might", "keen to") turned into a commitment, and an added
  detail. Interpretation is not reported.
- `BRIEF-01` -- does a summary derived from a note (a visit brief) add a fact or
  reverse the note? A shorter brief is fine; leaving things out is what a brief is for.

How it stays safe to run:

- **The engine never calls a model.** The caller passes a `judge` function, so the
  model, the key and the spend stay in the consuming app.
- **Every finding must quote text that is really in the artifact.** A finding whose
  quote cannot be found is discarded (and logged), so the judge cannot complain
  about a sentence nobody wrote. A quote with a single slipped letter is matched to
  the report's own sentence and *that* is shown as the evidence.
- **Every finding is a warning**, never an error, and worded as a reader's
  judgement. When unsure the judge is told not to report: accusing a correct
  sentence is worse than missing a faulty one.
- **A check that could not read the judge's answer is skipped, not passed.** It is
  listed in `skipped` with the reason. An empty or truncated reply used to look
  exactly like a clean report.
- Report and notes are fenced as untrusted material, so a note reading "ignore your
  instructions" costs at most a finding; the judge takes no action.

What the caller must know:

- **Give the judge a generous output limit (16 000 tokens worked) or turn thinking
  off.** On Sonnet 5 the limit covers thinking *and* the answer; at 4 096 one
  report used it all thinking and returned nothing.
- **Judge against what the report writer saw**, not the raw database. In Orbis that
  is `buildTripContext(...).text`. Judging against more than the writer had would
  flag correct omissions; against less would flag correct facts.
- **Cost and data flow.** One report is roughly 5 000 tokens in and 3 000 out per
  check, and the report and its source text go to the model provider -- the same
  data the report writer already sends.
- **Results vary between runs.** The same report can yield slightly different
  findings twice. Treat one run as a good reader's first pass.

How far it has been trusted: seven model-written reports from the demo data, a
hand-built answer key on the one fully seeded report (every planted error was
found, no supported sentence was accused), and synthetic cases for `QUA-01` and
`BRIEF-01` (silent and partly silent summaries; reversed, invented and hedged
briefs). It has **not** seen a real generated brief or a real production report,
and `BRIEF-01` has only been measured on hand-made pairs. That is why every
finding is a warning.

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
owner as a notification and an email. The judgement pass is built and tested but
**not yet wired into Orbis**. 281 tests.

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

Every check in the Orbis domain model is now built. What remains is wiring the
judgement pass into Orbis's nightly run.

### A note on false positives

Every check here has produced at least one, and each was found by running against a
real generated report rather than a fixture. A table row's number binding to the row
beneath it; a ratio read as a count; a figure in parentheses read as absent; a name
with an em dash read as a different name; a whole table read as one paragraph; a
trip's flight home read as a country it never declared it was visiting.

The last of those was found before the check had ever run in production, by
pointing it at the four real trips in the database instead of at its own
fixtures. It would have fired on every trip any of them ever took.

`QUAL-01` was caught the same way and is worth stating plainly, because the
first version of it would have been unusable. It read the branch only from the
linked `agent_branches` row — but on live data that row is null on most
activities while the title still reads "Global Study — Zamalek Office", which
the app composes deliberately and the report reproduces verbatim. It would have
reported roughly twenty correct titles per trip as invented.

**`QUAL-01` has never been run against a real generated report**, because none
are stored any more — they were deleted with the trips they described. It was
validated against the live itinerary titles instead, which is the same text a
faithful report contains, and against an invented branch spliced into them. That
is weaker evidence than the other checks have, and the one-off sweep for
invented branches that the domain model asked for can no longer be done.

`COV-02` was caught the same way, on the same real trips: the Morocco trip
records the same city as both "Casablanca" and "Casablanaca". Reported as a
warning rather than an error for exactly that reason -- the real gap is the
typo, not something a report can be asked to fix. Also validated: the flight
home and its layovers do not appear as cities the report must mention, the
same fix `COV-06/07` needed for countries, applied at city grain.

`CNT-01`, wired up for `COV-05`, had never actually run against Orbis data before
-- it existed with nothing supplying it a count scoped to the Trip Overview
table. The bug it found was in the check itself, not the data: it only ever
looked for a number *before* the phrase it matched ("Eight sectors of air
travel"), and a markdown table states the label first and the number after it
-- "| Total Activities | 25 |". Checked backward only, it would have run
silently and caught nothing, on the exact table format the report prompt asks
for. It now checks both directions, nearest number wins. Fixing that surfaced
a second bug: a count with a label and an alias that both match the same table
cell -- "activities" and "total activities" both matching "| Total Activities
| 25 |" -- reported the one wrong number twice, as though there were two
separate mistakes. Now one finding per count per line, however many of its
wordings match there.

**`DATE-03` has never seen a real multi-day activity**, stated plainly rather
than glossed over: `end_date` on an activity is a real, validated field in the
trip form, but not one row in the live database has it set. Checked against
every real trip before trusting the wiring -- zero findings, zero errors,
because there is nothing yet for it to find. Built and tested against
hand-written cases shaped like the real form instead, including the exact
trap the other checks here keep finding: a title that already carries a month
and year ("GSUK Cairo Fair October 2026") is stripped to its bare name before
being used as the subject, the same alias every other entity in this adapter
gets, so the date already inside the title cannot be mistaken for the report
having stated it.

Fixtures agree with whoever wrote them. Before trusting a new check, run it over real
output and read every finding — a checker's first findings are as likely to be its own
bugs as the app's.
