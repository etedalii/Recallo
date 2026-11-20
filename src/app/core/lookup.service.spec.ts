import { describe, expect, it } from 'vitest';
import {
  CommonsQueryResponse,
  OpenverseResponse,
  WikipediaQueryResponse,
  WiktionaryResponse,
  dedupePictures,
  parseCollocations,
  parseCommonsImages,
  parseDictionaryResponse,
  parseOpenverseImages,
  parseTranslation,
  parseWikipediaImages,
  parseWiktionaryResponse,
} from './lookup.service';

describe('parseDictionaryResponse', () => {
  it('flattens phonetic, audio and up to 8 definitions', () => {
    const result = parseDictionaryResponse([
      {
        phonetic: '/əˈpɪl/',
        phonetics: [{ text: '/əˈpɪl/', audio: 'https://example.com/apple.mp3' }],
        meanings: [
          {
            partOfSpeech: 'noun',
            definitions: [
              { definition: 'A round fruit.', example: 'I ate an apple.', synonyms: ['fruit'], antonyms: [] },
            ],
          },
        ],
      },
    ]);
    expect(result.phonetic).toBe('/əˈpɪl/');
    expect(result.audioUrl).toBe('https://example.com/apple.mp3');
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].example).toBe('I ate an apple.');
  });

  it('pairs the phonetic text with audio from the same accent, not just the first of each', () => {
    // Mirrors the real dictionaryapi.dev shape for "happy": an AU entry
    // with audio but no text, then a UK entry with both.
    const result = parseDictionaryResponse([
      {
        phonetics: [
          { audio: 'https://example.com/happy-au.mp3' },
          { text: '/ˈhæpiː/', audio: 'https://example.com/happy-uk.mp3' },
          { text: '/ˈhæpi/', audio: 'https://example.com/happy-us.mp3' },
        ],
        meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Glad.' }] }],
      },
    ]);
    // Text and audio must come from the SAME phonetics entry.
    expect(result.phonetic).toBe('/ˈhæpiː/');
    expect(result.audioUrl).toBe('https://example.com/happy-uk.mp3');
  });

  it('falls back to the meaning-level synonyms/antonyms, which is where the real API puts them', () => {
    // dictionaryapi.dev's actual response leaves def.synonyms/antonyms empty
    // and lists the real synonyms/antonyms once on the whole meaning.
    const result = parseDictionaryResponse([
      {
        phonetic: '/dɪˈsaɪd/',
        meanings: [
          {
            partOfSpeech: 'verb',
            synonyms: ['choose', 'determine', 'pick'],
            antonyms: [],
            definitions: [
              { definition: 'To make a choice.', example: 'She decided to leave.', synonyms: [], antonyms: [] },
            ],
          },
        ],
      },
    ]);
    expect(result.definitions[0].synonyms).toEqual(['choose', 'determine', 'pick']);
  });
});

describe('parseWiktionaryResponse', () => {
  // Mirrors the real shape of https://en.wiktionary.org/api/rest_v1/page/definition/chat,
  // which lists an English section (the verb "to chat") and a French
  // section (the noun "cat") on the same page.
  const sample: WiktionaryResponse = {
    en: [
      { partOfSpeech: 'Verb', definitions: [{ definition: 'To be <a href="/wiki/engage">engaged</a> in conversation.' }] },
    ],
    fr: [
      {
        partOfSpeech: 'Noun',
        definitions: [
          {
            definition: '<a href="/wiki/cat">cat</a> <span class="mention-gloss-paren">(</span>feline<span class="mention-gloss-paren">)</span>',
            parsedExamples: [{ example: 'Le <b>chat</b> dort.', translation: 'The cat is sleeping.' }],
          },
          { definition: '(male) cat, tom, tomcat' },
        ],
      },
    ],
  };

  it('picks the requested language section and strips the markup', () => {
    const result = parseWiktionaryResponse(sample, 'fr');
    expect(result.definitions).toHaveLength(2);
    expect(result.definitions[0].partOfSpeech).toBe('Noun');
    expect(result.definitions[0].definition).toBe('cat (feline)');
    expect(result.definitions[0].example).toBe('Le chat dort.');
  });

  it('has no phonetic or audio - this endpoint does not provide them', () => {
    const result = parseWiktionaryResponse(sample, 'fr');
    expect(result.phonetic).toBe('');
    expect(result.audioUrl).toBeNull();
  });

  it('returns no definitions for a language section the page does not have', () => {
    const result = parseWiktionaryResponse(sample, 'de');
    expect(result.definitions).toEqual([]);
  });

  it('strips an inline <style> block instead of leaving its CSS text behind', () => {
    const withStyle: WiktionaryResponse = {
      fr: [
        {
          partOfSpeech: 'Noun',
          definitions: [{ definition: 'a computer. <style>.mw-parser-output .defdate{font-size:smaller}</style>' }],
        },
      ],
    };
    expect(parseWiktionaryResponse(withStyle, 'fr').definitions[0].definition).toBe('a computer.');
  });
});

describe('parseCollocations', () => {
  it('builds phrases from words that come before and after', () => {
    const phrases = parseCollocations('decision', [{ word: 'quickly' }], [{ word: 'make' }]);
    expect(phrases).toContain('make decision');
    expect(phrases).toContain('decision quickly');
  });
});

describe('parseTranslation', () => {
  it('ranks matches by quality, best first, deduped, max 5', () => {
    const choices = parseTranslation({
      responseData: { translatedText: 'سیب' },
      matches: [
        { translation: 'سیب', quality: '90' },
        { translation: 'میوه', quality: '50' },
        { translation: 'درخت سیب', quality: '10' },
        { translation: 'سیب قرمز', quality: '5' },
        { translation: 'سیب سبز', quality: '1' },
      ],
    });
    expect(choices[0].text).toBe('سیب');
    expect(choices.length).toBeLessThanOrEqual(5);
  });

  it('sorts an untranslated echo of the source word after real translations, even if it scores higher', () => {
    // Mirrors a real MyMemory response for "apple" -> French, where its
    // top "translatedText" pick is literally the English word "Apple".
    const choices = parseTranslation(
      {
        responseData: { translatedText: 'Apple' },
        matches: [
          { translation: 'Apple', quality: '74' },
          { translation: 'Pomme', quality: '67' },
          { translation: 'pomme', quality: '68' },
        ],
      },
      'apple',
    );
    expect(choices[0].text.toLowerCase()).not.toBe('apple');
    expect(choices.some((c) => c.text.toLowerCase() === 'apple')).toBe(true);
  });
});

describe('parseWikipediaImages', () => {
  it('turns a Wikipedia generator=search response into picture results', () => {
    const sample: WikipediaQueryResponse = {
      query: {
        pages: {
          '1': { title: 'Apple', pageimage: 'Apple.jpg', thumbnail: { source: 'https://upload.wikimedia.org/apple-thumb.jpg', width: 500 } },
          '2': { title: 'No Image Page' },
        },
      },
    };
    const results = parseWikipediaImages(sample, 6);
    expect(results).toHaveLength(1);
    expect(results[0].thumbUrl).toBe('https://upload.wikimedia.org/apple-thumb.jpg');
    expect(results[0].credit.sourceUrl).toContain('en.wikipedia.org/wiki/Apple');
  });
});

describe('parseCommonsImages', () => {
  it('turns a Commons generator=search response into picture results with credit', () => {
    const sample: CommonsQueryResponse = {
      query: {
        pages: {
          '1': {
            title: 'File:Apple.jpg',
            imageinfo: [
              {
                url: 'https://upload.wikimedia.org/apple-full.jpg',
                thumburl: 'https://upload.wikimedia.org/apple-thumb.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Apple.jpg',
                extmetadata: { Artist: { value: '<a href="#">Jane Doe</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
              },
            ],
          },
        },
      },
    };
    const results = parseCommonsImages(sample, 8);
    expect(results).toHaveLength(1);
    expect(results[0].credit.title).toBe('Apple.jpg');
    expect(results[0].credit.author).toBe('Jane Doe');
    expect(results[0].credit.licence).toBe('CC BY-SA 4.0');
  });
});

describe('parseOpenverseImages', () => {
  it('turns an Openverse response into picture results', () => {
    const sample: OpenverseResponse = {
      results: [
        {
          title: 'Red apple',
          creator: 'Someone',
          license: 'cc0',
          foreign_landing_url: 'https://openverse.org/image/123',
          url: 'https://example.com/apple-full.jpg',
          thumbnail: 'https://example.com/apple-thumb.jpg',
        },
      ],
    };
    const results = parseOpenverseImages(sample, 8);
    expect(results).toHaveLength(1);
    expect(results[0].fullUrl).toBe('https://example.com/apple-full.jpg');
  });
});

describe('dedupePictures', () => {
  it('removes duplicates by full-size URL, keeping the first occurrence', () => {
    const credit = { title: 't', author: 'a', licence: 'l', sourceUrl: 's' };
    const results = dedupePictures([
      { thumbUrl: 'a-thumb', fullUrl: 'https://example.com/a.jpg', credit },
      { thumbUrl: 'b-thumb', fullUrl: 'https://example.com/b.jpg', credit },
      { thumbUrl: 'a-thumb-2', fullUrl: 'https://example.com/a.jpg', credit },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].thumbUrl).toBe('a-thumb');
  });
});
