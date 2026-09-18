import { mentions } from "../parse.js";

/**
 * Everything a model says is treated as untrusted input. These are the only
 * places that input is allowed to become anything else.
 */

/** Pulls a JSON value out of a model's reply, tolerating fences and preamble. */
export function parseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const attempt = (t: string): unknown | null => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };

  const whole = attempt(unfenced) ?? attempt(closeOpenBrackets(unfenced));
  if (whole !== null) return whole;

  // A model that explains itself before answering. The outermost braces are
  // the answer; anything a person could not parse from them is not one.
  const start = unfenced.indexOf("{");
  if (start < 0) return null;
  const tail = unfenced.slice(start);
  const end = tail.lastIndexOf("}");
  return (end > 0 ? attempt(tail.slice(0, end + 1)) : null) ?? attempt(closeOpenBrackets(tail));
}

/**
 * Appends the closing brackets a reply forgot.
 *
 * Found on a real run: the model wrote a complete, correct answer and left off
 * the last brace, one reply in fourteen. Losing a whole check to that would
 * make the check unreliable for a reason that has nothing to do with the
 * report. This only ever ADDS closers to text that ends mid-structure -- it
 * cannot invent a value -- and a reply cut off inside a string is left alone,
 * because guessing what the rest said would be inventing it.
 */
function closeOpenBrackets(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if ((ch === "}" || ch === "]") && stack[stack.length - 1] === ch) {
      stack.pop();
    }
  }
  if (inString) return text;
  return text.replace(/,\s*$/, "") + stack.reverse().join("");
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const asText = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * A missing or nonsense confidence reads as 0.5, not 1: a judge that does not
 * say how sure it is has not earned the benefit of the doubt.
 */
export const asConfidence = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;

/**
 * Whether a quoted passage is really in the text it claims to come from.
 *
 * This is the guard that makes a model's finding worth reading. A judge that
 * has to quote the sentence it is complaining about cannot complain about a
 * sentence that is not there, and a check that lets it is a check that
 * reports things nobody wrote.
 *
 * Deliberately lenient about punctuation, case, markdown and quote style --
 * a model reproduces text, it does not photocopy it -- and deliberately
 * strict about everything else: the words must be there, in order. An
 * ellipsis splits a quote into fragments, each of which must be found.
 * Too short to mean anything (under `minLength` characters, default 15) is
 * treated as not found, since "the" is in every document. An objective may
 * honestly be short -- "Visit schools" -- so that caller lowers the floor.
 */
export function quoteAppears(quote: string, haystack: string, minLength = 15): boolean {
  const clean = (s: string) => s.replace(/[*_`>|#]+/g, " ").replace(/[“”„]/g, '"').replace(/[‘’]/g, "'");
  const fragments = quote
    .split(/…|\.{3}/)
    .map((f) => clean(f).trim())
    .filter((f) => f.split(/\s+/).filter(Boolean).length >= 2);
  if (!fragments.length) return false;
  if (fragments.join(" ").length < minLength) return false;
  const hay = clean(haystack);
  return fragments.every((f) => mentions(hay, f));
}

/**
 * Wraps text the model must treat as material, not instruction.
 *
 * The report was written by a model and the notes were typed by people; either
 * can contain "ignore your instructions". Fencing does not make that
 * impossible, only harder, and the worst it can then do is cost a finding --
 * the judge takes no action, and anything it reports is checked against the
 * text afterwards. A closing tag inside the text is removed so it cannot end
 * its own fence.
 */
export function fence(name: string, text: string): string {
  const safe = text.replace(new RegExp(`</?${name}\\b[^>]*>`, "gi"), "");
  return `<${name}>\n${safe}\n</${name}>`;
}

const wordsOf = (s: string): string[] =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);

const trigrams = (words: string[]): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
};

/** A long quote needs at least this many words before a typo can be forgiven. */
const FUZZY_MIN_WORDS = 8;
/** Share of the quote's word-triples that must be found in one sentence. */
const FUZZY_MIN_OVERLAP = 0.75;

/**
 * Finds the real text a model's quote refers to, and returns that text.
 *
 * `quoteAppears` alone was too brittle on a real run: the model quoted a
 * twenty-four word sentence with one letter transposed ("Abuha" for "Abuja")
 * and the guard threw away the strongest true finding in the report. A
 * transposed letter is transcription, not invention.
 *
 * So when an exact match fails, a long quote is matched to the report sentence
 * it overlaps most, provided three quarters of its word-triples are found
 * there. Made-up text has almost no triples in common with a real sentence, so
 * the guard keeps its teeth; and what is returned is the report's own
 * sentence, never the model's version of it -- so whatever a person is shown as
 * evidence is verbatim from the document, typo or no typo.
 *
 * Short quotes get no such allowance: a few words with one changed is a
 * different few words.
 */
export function locateQuote(quote: string, haystack: string, minLength = 15): string | null {
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
  if (quoteAppears(quote, haystack, minLength)) return tidy(quote);

  const q = wordsOf(quote);
  if (q.length < FUZZY_MIN_WORDS) return null;
  const wanted = trigrams(q);
  if (!wanted.size) return null;

  // Sentences, and runs of up to three adjacent ones: a quote may span a full
  // stop, and a slip in a two-sentence quote is no more invention than a slip
  // in a one-sentence one.
  const sentences = haystack.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  let best: { text: string; score: number } | null = null;
  for (let i = 0; i < sentences.length; i++) {
    for (let span = 1; span <= 3 && i + span <= sentences.length; span++) {
      const text = sentences.slice(i, i + span).join(" ");
      const words = wordsOf(text);
      if (words.length < FUZZY_MIN_WORDS) continue;
      const have = trigrams(words);
      let shared = 0;
      for (const t of wanted) if (have.has(t)) shared++;
      const score = shared / wanted.size;
      if (score < FUZZY_MIN_OVERLAP) continue;
      // A longer span must earn its place. On a near-tie the shorter text wins,
      // or "## Summary" plus its first sentence beats the sentence alone just
      // for starting earlier.
      const shorter = best !== null && text.length < best.text.length;
      if (!best || score > best.score + 0.02 || (score >= best.score - 0.02 && shorter)) {
        best = { text: tidy(text), score };
      }
    }
  }
  return best?.text ?? null;
}
