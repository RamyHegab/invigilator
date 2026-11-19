/**
 * Accent-blind text matching.
 *
 * Reports and the records behind them disagree about accents all the time:
 * a record holds "Lycée Français" or "José", the report writes "Lycee
 * Francais" or "Jose", and the reverse. Those are the same name. Before these
 * helpers, checks compared them as different strings, and JavaScript's \b
 * treats an accented letter as a non-word character, so a name starting or
 * ending in one was never found at all.
 */

const MARKS = /\p{Diacritic}/gu;

/**
 * Letters that carry their mark in the letter itself, so decomposing them
 * removes nothing: Turkish dotless i ("Diyarbakır"), Danish and Norwegian ø,
 * Polish ł, and the rest. One letter each, so length is still kept.
 */
const SINGLE: Record<string, string> = {
  ı: "i", İ: "I", ø: "o", Ø: "O", ł: "l", Ł: "L", đ: "d", Đ: "D", ħ: "h", Ħ: "H",
};

/**
 * The text with accents removed, keeping its length.
 *
 * Length is kept so a match found in the folded text can be cut out of the
 * original at the same position, and evidence quotes the report as written.
 * The input is put in composed form (NFC) first, so "é" is one character
 * before folding as well as after.
 */
export function fold(text: string): string {
  const composed = text.normalize("NFC");
  let out = "";
  for (const ch of composed) {
    const base = SINGLE[ch] ?? ch.normalize("NFD").replace(MARKS, "");
    // A letter folds to one letter. Anything that would change length (a
    // stray combining mark, a ligature) stays as it is.
    out += base.length === ch.length ? base : ch;
  }
  return out;
}

/** Composed form, so positions in fold(text) line up with this string. */
export const composed = (text: string) => text.normalize("NFC");

/** Lower-case and accent-free, for comparing two names. */
export const foldKey = (text: string) => fold(text).toLowerCase().trim();

/** Two names equal apart from case and accents. */
export const sameName = (a: string, b: string) => foldKey(a) === foldKey(b);

/**
 * Word boundaries that know accented letters are letters. Use with the "u"
 * flag. \b does not: in "José Ruiz", \b finds no boundary after the "é".
 */
const WORD = "[\\p{L}\\p{N}_]";
export const START = `(?<!${WORD})`;
export const END = `(?!${WORD})`;
