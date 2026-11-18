// Pure text helpers: normalising, edit distance, word diff and simple
// English morphology for cloze blanking. No Angular imports.

/** Lowercase, trim, and collapse punctuation/whitespace for comparisons. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    // Curly/typographic apostrophes (common in dictionary-sourced text,
    // e.g. Wiktionary's "don't") must become a straight one instead of
    // being stripped below — otherwise "don't" (curly) normalizes to
    // "dont" while a user typing it on a real keyboard gets "don't",
    // and the two compare as different (and even score as "wrong"
    // outright, since "dont" is short enough to fail judgeWord's
    // one-letter-typo allowance).
    .replace(/[‘’ʼ]/g, "'")
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s']/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Classic Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array<number>(n + 1);
  let currRow = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + cost);
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
}

export type WordDiffToken =
  | { kind: 'match'; word: string }
  | { kind: 'missing'; word: string }
  | { kind: 'extra'; word: string };

export interface WordDiffResult {
  score: number;
  tokens: WordDiffToken[];
}

function splitWords(text: string): string[] {
  return normalize(text).split(' ').filter((w) => w.length > 0);
}

/**
 * Word-by-word diff between the expected sentence and what the user typed,
 * using the longest-common-subsequence of words. Score is
 * (matched words) / (expected word count).
 */
export function wordDiff(expected: string, typed: string): WordDiffResult {
  const a = splitWords(expected);
  const b = splitWords(typed);
  const n = a.length;
  const m = b.length;

  if (n === 0) {
    return { score: m === 0 ? 1 : 0, tokens: b.map((word) => ({ kind: 'extra', word })) };
  }

  // Standard LCS table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const tokens: WordDiffToken[] = [];
  let i = 0;
  let j = 0;
  let matched = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      tokens.push({ kind: 'match', word: a[i] });
      matched++;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ kind: 'missing', word: a[i] });
      i++;
    } else {
      tokens.push({ kind: 'extra', word: b[j] });
      j++;
    }
  }
  while (i < n) {
    tokens.push({ kind: 'missing', word: a[i] });
    i++;
  }
  while (j < m) {
    tokens.push({ kind: 'extra', word: b[j] });
    j++;
  }

  return { score: matched / n, tokens };
}

export type AnswerJudgement = 'correct' | 'almost' | 'wrong';

/** Checks a single typed word against the target word. */
export function judgeWord(expected: string, typed: string): AnswerJudgement {
  const e = normalize(expected);
  const t = normalize(typed);
  if (e === t) return 'correct';
  if (e.length >= 5 && levenshtein(e, t) === 1) return 'almost';
  return 'wrong';
}

/** Checks a typed sentence against the target sentence using the word diff score. */
export function judgeSentence(expected: string, typed: string): { judgement: AnswerJudgement; diff: WordDiffResult } {
  const diff = wordDiff(expected, typed);
  const judgement: AnswerJudgement = diff.score >= 0.98 ? 'correct' : diff.score >= 0.8 ? 'almost' : 'wrong';
  return { judgement, diff };
}

/** Very small set of English inflection endings, enough for simple cloze matching. */
function wordForms(base: string): string[] {
  const lower = base.toLowerCase();
  const forms = new Set<string>([lower]);

  // decide -> decided, decides, deciding; drop final 'e' before -ed/-ing.
  const stem = lower.endsWith('e') ? lower.slice(0, -1) : lower;
  forms.add(`${stem}ed`);
  forms.add(`${stem}ing`);
  forms.add(`${lower}ed`);
  forms.add(`${lower}ing`);
  forms.add(`${lower}s`);
  forms.add(`${lower}es`);

  // Double the final consonant for short CVC verbs: stop -> stopped, stopping.
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(lower)) {
    const doubled = lower + lower[lower.length - 1];
    forms.add(`${doubled}ed`);
    forms.add(`${doubled}ing`);
  }

  // y -> ied: try -> tried.
  if (lower.endsWith('y')) {
    forms.add(`${lower.slice(0, -1)}ied`);
  }

  return [...forms];
}

/**
 * Replaces the target word (in any of its simple forms) inside a sentence
 * with a blank, for cloze cards. Returns the blanked sentence and the exact
 * substring that was hidden (so the answer can be checked against it).
 */
export function blankOut(sentence: string, targetWord: string): { blanked: string; hiddenWord: string } {
  const forms = wordForms(targetWord).sort((a, b) => b.length - a.length);
  const pattern = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\b(${pattern})\\b`, 'i');
  const match = re.exec(sentence);
  if (!match) {
    return { blanked: sentence, hiddenWord: targetWord };
  }
  const hiddenWord = match[0];
  const blanked = sentence.slice(0, match.index) + '_____' + sentence.slice(match.index + hiddenWord.length);
  return { blanked, hiddenWord };
}
