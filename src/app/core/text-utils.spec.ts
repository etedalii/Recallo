import { describe, expect, it } from 'vitest';
import { blankOut, judgeSentence, judgeWord, levenshtein, normalize, wordDiff } from './text-utils';

describe('normalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalize("Don't worry!")).toBe("don't worry");
  });

  it('treats a curly apostrophe the same as a straight one', () => {
    // Dictionary-sourced text (e.g. Wiktionary) often uses U+2019.
    expect(normalize('Don’t worry!')).toBe(normalize("Don't worry!"));
  });
});

describe('levenshtein', () => {
  it('is 0 for identical strings', () => {
    expect(levenshtein('decide', 'decide')).toBe(0);
  });
  it('is 1 for a single-letter typo', () => {
    expect(levenshtein('decide', 'decode')).toBe(1);
  });
});

describe('judgeWord', () => {
  it('is correct for an exact match', () => {
    expect(judgeWord('decide', 'decide')).toBe('correct');
  });
  it('is almost for a one-letter typo on a 5+ letter word', () => {
    expect(judgeWord('decide', 'decede')).toBe('almost');
  });
  it('is wrong for a short word with any typo', () => {
    expect(judgeWord('cat', 'cot')).toBe('wrong');
  });
});

describe('wordDiff', () => {
  it('gives a score of 1.0 for identical sentences', () => {
    const result = wordDiff('The cat sat on the mat.', 'The cat sat on the mat.');
    expect(result.score).toBe(1);
    expect(result.tokens.every((t) => t.kind === 'match')).toBe(true);
  });

  it('gives a lower score when words are missing', () => {
    const result = wordDiff('The cat sat on the mat.', 'The cat on the mat.');
    expect(result.score).toBeLessThan(1);
    expect(result.tokens.some((t) => t.kind === 'missing')).toBe(true);
  });

  it('marks extra words as struck-through tokens', () => {
    const result = wordDiff('I like apples.', 'I really like apples.');
    expect(result.tokens.some((t) => t.kind === 'extra' && t.word === 'really')).toBe(true);
  });
});

describe('judgeSentence', () => {
  it('is correct at or above 0.98', () => {
    expect(judgeSentence('one two three four five', 'one two three four five').judgement).toBe('correct');
  });
  it('is almost between 0.8 and 0.98', () => {
    // 4 of 5 words match -> score 0.8
    expect(judgeSentence('one two three four five', 'one two three four').judgement).toBe('almost');
  });
  it('is wrong below 0.8', () => {
    expect(judgeSentence('one two three four five', 'one').judgement).toBe('wrong');
  });
});

describe('blankOut', () => {
  it('hides the exact target word', () => {
    const { blanked, hiddenWord } = blankOut('I will decide tomorrow.', 'decide');
    expect(blanked).toBe('I will _____ tomorrow.');
    expect(hiddenWord).toBe('decide');
  });

  it('matches simple word forms (decide -> decided)', () => {
    const { blanked, hiddenWord } = blankOut('She decided to leave.', 'decide');
    expect(blanked).toBe('She _____ to leave.');
    expect(hiddenWord.toLowerCase()).toBe('decided');
  });
});
