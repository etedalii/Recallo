import { describe, expect, it } from 'vitest';
import { detectDelimiter, importDuplicateKey, parseCsv, parseDelimited, toCsv } from './csv';

describe('detectDelimiter', () => {
  it('detects commas', () => {
    expect(detectDelimiter('word,definition,sentence')).toBe(',');
  });
  it('detects tabs', () => {
    expect(detectDelimiter('word\tdefinition\tsentence')).toBe('\t');
  });
});

describe('parseDelimited', () => {
  it('handles quoted commas inside a field', () => {
    const rows = parseDelimited('a,"b, c",d\n', ',');
    expect(rows).toEqual([['a', 'b, c', 'd']]);
  });

  it('handles escaped quotes', () => {
    const rows = parseDelimited('a,"he said ""hi""",c\n', ',');
    expect(rows).toEqual([['a', 'he said "hi"', 'c']]);
  });

  it('handles tab-delimited rows', () => {
    const rows = parseDelimited('a\tb\tc\n', '\t');
    expect(rows).toEqual([['a', 'b', 'c']]);
  });
});

describe('parseCsv', () => {
  it('parses a header file including the persian column', () => {
    const text = 'word,definition,persian,sentence,persian_sentence\napple,a fruit,سیب,I ate an apple.,من یک سیب خوردم.';
    const rows = parseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('apple');
    expect(rows[0].persian).toBe('سیب');
    expect(rows[0].persianSentence).toBe('من یک سیب خوردم.');
  });

  it('parses a no-header file as word, definition, sentence', () => {
    const text = 'apple,a fruit,I ate an apple.\nbanana,a fruit,I ate a banana.';
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ word: 'apple', definition: 'a fruit', sentence: 'I ate an apple.' });
    expect(rows[1]).toMatchObject({ word: 'banana', definition: 'a fruit', sentence: 'I ate a banana.' });
  });

  it('does not mistake a no-header data row for a header just because one word matches a column name', () => {
    // "example" is itself a recognised header alias, but this file has no
    // header row — it's teaching the vocabulary word "example".
    const text = 'example,a sample given as an illustration\nword,a single unit of language';
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ word: 'example', definition: 'a sample given as an illustration' });
    expect(rows[1]).toMatchObject({ word: 'word', definition: 'a single unit of language' });
  });

  it('parses an Anki "Notes in Plain Text" style tab export with a header', () => {
    const text = 'word\tdefinition\tsentence\ndecide\tto make a choice\tShe decided to leave.';
    const rows = parseCsv(text);
    expect(rows[0]).toMatchObject({ word: 'decide', definition: 'to make a choice', sentence: 'She decided to leave.' });
  });

  it('splits tag/synonym/collocation lists on ; or |', () => {
    const text = 'word,definition,persian,sentence,persian_sentence,deck,tags,synonyms,collocations,style\napple,a fruit,,,,,fruit|food,fruit;snack,eat an apple,flip';
    const rows = parseCsv(text);
    expect(rows[0].tags).toEqual(['fruit', 'food']);
    expect(rows[0].synonyms).toEqual(['fruit', 'snack']);
    expect(rows[0].collocations).toEqual(['eat an apple']);
  });
});

describe('importDuplicateKey', () => {
  it('matches regardless of case or surrounding whitespace', () => {
    expect(importDuplicateKey(' Apple ', 'Fruit', 'flip')).toBe(importDuplicateKey('apple', 'fruit', 'FLIP'));
  });

  it('treats different decks or styles as distinct', () => {
    expect(importDuplicateKey('apple', 'Fruit', 'flip')).not.toBe(importDuplicateKey('apple', 'Food', 'flip'));
    expect(importDuplicateKey('apple', 'Fruit', 'flip')).not.toBe(importDuplicateKey('apple', 'Fruit', 'type'));
  });
});

describe('toCsv', () => {
  it('round-trips word/definition/persian/sentence data through import and export', () => {
    const csv = toCsv([
      {
        word: 'apple',
        definition: 'a fruit',
        persian: 'سیب',
        sentence: 'I ate an apple.',
        persianSentence: 'من یک سیب خوردم.',
        deck: 'Fruit',
        tags: ['food'],
        synonyms: [],
        collocations: [],
        style: 'flip',
        answer: '',
      },
    ]);
    const parsed = parseCsv(csv);
    expect(parsed[0]).toMatchObject({
      word: 'apple',
      definition: 'a fruit',
      persian: 'سیب',
      sentence: 'I ate an apple.',
      persianSentence: 'من یک سیب خوردم.',
      deck: 'Fruit',
      tags: ['food'],
      style: 'flip',
    });
  });

  it('quotes fields that contain commas', () => {
    const csv = toCsv([
      {
        word: 'make a decision',
        definition: 'to decide, finally',
        persian: '',
        sentence: '',
        persianSentence: '',
        deck: '',
        tags: [],
        synonyms: [],
        collocations: [],
        style: 'flip',
        answer: '',
      },
    ]);
    expect(csv).toContain('"to decide, finally"');
  });

  it('round-trips a Fix card\'s corrected sentence through the answer column', () => {
    const csv = toCsv([
      {
        word: 'I went to school yesterday.',
        definition: '',
        persian: '',
        sentence: 'I am go to school yesterday.',
        persianSentence: '',
        deck: 'Mistakes',
        tags: [],
        synonyms: [],
        collocations: [],
        style: 'fix',
        answer: 'I went to school yesterday.',
      },
    ]);
    const parsed = parseCsv(csv);
    expect(parsed[0]).toMatchObject({
      sentence: 'I am go to school yesterday.',
      answer: 'I went to school yesterday.',
      style: 'fix',
    });
  });
});
