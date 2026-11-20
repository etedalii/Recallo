import { Injectable, inject } from '@angular/core';
import { DictionaryDefinition, DictionaryLookupResult, ImageCredit, PictureResult, TranslationChoice } from './models';
import { FilesService } from './files.service';

// ---------------------------------------------------------------------------
// Pure response parsers. These take already-fetched JSON (or saved sample
// JSON in tests) and never touch the network themselves, so they can be
// unit tested without a connection.
// ---------------------------------------------------------------------------

/** Shape of one entry returned by https://api.dictionaryapi.dev/api/v2/entries/en/<word>. */
export interface DictionaryApiEntry {
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
  meanings?: {
    partOfSpeech: string;
    // The API puts the richer synonym/antonym list on the meaning itself;
    // each definition *also* has its own (usually empty) synonyms/antonyms.
    synonyms?: string[];
    antonyms?: string[];
    definitions: { definition: string; example?: string; synonyms?: string[]; antonyms?: string[] }[];
  }[];
}

export function parseDictionaryResponse(entries: DictionaryApiEntry[]): DictionaryLookupResult {
  const definitions: DictionaryDefinition[] = [];
  let phonetic = '';
  let audioUrl: string | null = null;

  for (const entry of entries) {
    phonetic = phonetic || entry.phonetic || '';
    // Prefer a single phonetics entry that has both the transcription and
    // the audio together, so they're the same accent (e.g. both UK, or
    // both US) rather than mixing an AU audio clip with a UK transcription.
    const matchedPair = (entry.phonetics ?? []).find((p) => p.text && p.audio);
    if (matchedPair) {
      if (!phonetic) phonetic = matchedPair.text ?? '';
      if (!audioUrl) audioUrl = matchedPair.audio ?? null;
    } else {
      for (const p of entry.phonetics ?? []) {
        if (!phonetic && p.text) phonetic = p.text;
        if (!audioUrl && p.audio) audioUrl = p.audio;
      }
    }
    for (const meaning of entry.meanings ?? []) {
      for (const def of meaning.definitions) {
        if (definitions.length >= 8) break;
        // Prefer the definition's own synonyms/antonyms; fall back to the
        // ones listed on the whole meaning, since the API usually puts
        // them there instead.
        const synonyms = def.synonyms?.length ? def.synonyms : meaning.synonyms ?? [];
        const antonyms = def.antonyms?.length ? def.antonyms : meaning.antonyms ?? [];
        definitions.push({
          partOfSpeech: meaning.partOfSpeech,
          definition: def.definition,
          example: def.example ?? '',
          synonyms,
          antonyms,
        });
      }
    }
  }

  return { phonetic, audioUrl, definitions: definitions.slice(0, 8) };
}

/**
 * Shape of https://en.wiktionary.org/api/rest_v1/page/definition/<word> —
 * the fallback dictionary for every studied language other than English.
 * dictionaryapi.dev only ever serves English (every other language code
 * 404s), but English Wiktionary documents words from most languages on one
 * page per spelling, grouped by ISO 639-1 code (e.g. the "chat" page has
 * both an "en" section — the verb "to chat" — and an "fr" section — the
 * French noun for "cat").
 */
export interface WiktionaryDefinitionSection {
  partOfSpeech: string;
  definitions: {
    definition: string;
    examples?: string[];
    parsedExamples?: { example: string; translation?: string }[];
  }[];
}
export type WiktionaryResponse = Record<string, WiktionaryDefinitionSection[]>;

function stripWiktionaryHtml(html: string | undefined): string {
  return (html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWiktionaryResponse(response: WiktionaryResponse, langCode: string): DictionaryLookupResult {
  const sections = response[langCode] ?? [];
  const definitions: DictionaryDefinition[] = [];

  for (const section of sections) {
    for (const def of section.definitions) {
      if (definitions.length >= 8) break;
      const example = def.parsedExamples?.[0]?.example ?? def.examples?.[0] ?? '';
      definitions.push({
        partOfSpeech: section.partOfSpeech,
        definition: stripWiktionaryHtml(def.definition),
        example: stripWiktionaryHtml(example),
        synonyms: [],
        antonyms: [],
      });
    }
  }

  // No phonetic transcription or audio in this endpoint's response shape —
  // the "missing phonetic" messaging the form already shows covers that.
  return { phonetic: '', audioUrl: null, definitions: definitions.slice(0, 8) };
}

/** Shape of https://api.datamuse.com/words?rel_bga=<word> / rel_bgb=<word>. */
export interface DatamuseWord {
  word: string;
}

/** Turns Datamuse "words that follow/precede" results into phrases like "make a decision". */
export function parseCollocations(word: string, wordsAfter: DatamuseWord[], wordsBefore: DatamuseWord[]): string[] {
  const after = wordsAfter.slice(0, 6).map((w) => `${word} ${w.word}`);
  const before = wordsBefore.slice(0, 6).map((w) => `${w.word} ${word}`);
  return [...before, ...after];
}

/** Shape of https://api.mymemory.translated.net/get?q=<word>&langpair=<source>|<target> */
export interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  matches?: { translation: string; quality?: string | number }[];
  responseStatus?: number | string;
}

/**
 * Turns a MyMemory response into ranked translation choices. When
 * `sourceText` is given, a candidate that is identical to it (MyMemory's
 * crowd-sourced memory sometimes "translates" a word as itself) is sorted
 * after every genuinely different candidate — an untranslated echo is
 * almost never what the user wants, even when MyMemory scored it highest.
 */
export function parseTranslation(response: MyMemoryResponse, sourceText?: string): TranslationChoice[] {
  const choices = new Map<string, number>();
  const best = response.responseData?.translatedText;
  if (best) choices.set(best, 100);

  for (const match of response.matches ?? []) {
    const quality = typeof match.quality === 'string' ? parseFloat(match.quality) : match.quality ?? 0;
    const existing = choices.get(match.translation);
    if (existing === undefined || quality > existing) {
      choices.set(match.translation, quality);
    }
  }

  const sourceNormalized = sourceText?.trim().toLowerCase();
  const isUntranslated = (text: string): boolean => sourceNormalized !== undefined && text.trim().toLowerCase() === sourceNormalized;

  return [...choices.entries()]
    .map(([text, quality]) => ({ text, quality }))
    .sort((a, b) => Number(isUntranslated(a.text)) - Number(isUntranslated(b.text)) || b.quality - a.quality)
    .slice(0, 5);
}

export function isTranslationQuotaExceeded(response: MyMemoryResponse | null, httpStatus: number): boolean {
  if (httpStatus === 429) return true;
  const status = response?.responseStatus;
  return status === 403 || status === '403' || typeof status === 'string' && status.toLowerCase().includes('quota');
}

// --- Picture search parsers -------------------------------------------------

export interface WikipediaQueryResponse {
  query?: {
    pages?: Record<string, { title?: string; pageimage?: string; thumbnail?: { source?: string; width?: number } }>;
  };
}

export function parseWikipediaImages(response: WikipediaQueryResponse, limit = 6): PictureResult[] {
  const pages = Object.values(response.query?.pages ?? {});
  const results: PictureResult[] = [];
  for (const page of pages) {
    if (!page.thumbnail?.source) continue;
    const title = page.title ?? 'Wikipedia image';
    results.push({
      thumbUrl: page.thumbnail.source,
      fullUrl: page.thumbnail.source,
      credit: {
        title,
        author: 'Wikipedia contributors',
        licence: 'See Wikipedia page',
        sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      },
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface CommonsQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: {
          url?: string;
          thumburl?: string;
          descriptionurl?: string;
          extmetadata?: {
            Artist?: { value?: string };
            LicenseShortName?: { value?: string };
          };
        }[];
      }
    >;
  };
}

function stripHtml(html: string | undefined): string {
  return (html ?? '').replace(/<[^>]*>/g, '').trim();
}

export function parseCommonsImages(response: CommonsQueryResponse, limit = 8): PictureResult[] {
  const pages = Object.values(response.query?.pages ?? {});
  const results: PictureResult[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;
    const title = (page.title ?? 'Wikimedia Commons image').replace(/^File:/, '');
    results.push({
      thumbUrl: info.thumburl ?? info.url,
      fullUrl: info.url,
      credit: {
        title,
        author: stripHtml(info.extmetadata?.Artist?.value) || 'Unknown author',
        licence: info.extmetadata?.LicenseShortName?.value ?? 'See source',
        sourceUrl: info.descriptionurl ?? info.url,
      },
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface OpenverseResponse {
  results?: {
    title?: string;
    creator?: string;
    license?: string;
    foreign_landing_url?: string;
    url?: string;
    thumbnail?: string;
  }[];
}

export function parseOpenverseImages(response: OpenverseResponse, limit = 8): PictureResult[] {
  const results: PictureResult[] = [];
  for (const item of response.results ?? []) {
    if (!item.url) continue;
    results.push({
      thumbUrl: item.thumbnail ?? item.url,
      fullUrl: item.url,
      credit: {
        title: item.title ?? 'Openverse image',
        author: item.creator ?? 'Unknown author',
        licence: item.license ?? 'See source',
        sourceUrl: item.foreign_landing_url ?? item.url,
      },
    });
    if (results.length >= limit) break;
  }
  return results;
}

/** Removes duplicate pictures (same full-size URL) while keeping the first occurrence. */
export function dedupePictures(results: PictureResult[]): PictureResult[] {
  const seen = new Set<string>();
  const out: PictureResult[] = [];
  for (const r of results) {
    if (seen.has(r.fullUrl)) continue;
    seen.add(r.fullUrl);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The injectable service: does the actual fetch() calls, in the order and
// with the limits described in the spec, then hands off to the pure parsers
// above. Every method is network-safe: a failed or blocked request results
// in an empty/fallback value, never a thrown error that reaches the UI.
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class LookupService {
  private readonly files = inject(FilesService);

  /**
   * Looks up a word's definition for the given ISO 639-1 language (see
   * core/languages.ts's STUDY_LANGUAGE_OPTIONS). English uses
   * dictionaryapi.dev (it has phonetics and real pronunciation audio);
   * every other language falls back to Wiktionary, since dictionaryapi.dev
   * doesn't actually serve them.
   */
  async lookupWord(word: string, langCode = 'en'): Promise<DictionaryLookupResult | null> {
    if (langCode === 'en') {
      const entries = await fetchJson<DictionaryApiEntry[]>(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      );
      if (!entries) return null;
      return parseDictionaryResponse(entries);
    }

    const wiktionary = await fetchJson<WiktionaryResponse>(
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
    );
    if (!wiktionary) return null;
    return parseWiktionaryResponse(wiktionary, langCode);
  }

  async lookupCollocations(word: string): Promise<string[]> {
    const [after, before] = await Promise.all([
      fetchJson<DatamuseWord[]>(`https://api.datamuse.com/words?rel_bga=${encodeURIComponent(word)}&max=6`),
      fetchJson<DatamuseWord[]>(`https://api.datamuse.com/words?rel_bgb=${encodeURIComponent(word)}&max=6`),
    ]);
    return parseCollocations(word, after ?? [], before ?? []);
  }

  /**
   * Translates a word or sentence from `sourceLangCode` into `targetLangCode`
   * (ISO 639-1 codes — see core/languages.ts). Resolves `null` on
   * quota/offline, not an error.
   */
  async lookupTranslation(
    text: string,
    targetLangCode: string,
    sourceLangCode = 'en',
  ): Promise<TranslationChoice[] | null> {
    try {
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(sourceLangCode)}|${encodeURIComponent(targetLangCode)}`,
      );
      const json = (await res.json().catch(() => null)) as MyMemoryResponse | null;
      if (!res.ok || isTranslationQuotaExceeded(json, res.status)) return null;
      if (!json) return null;
      return parseTranslation(json, text);
    } catch {
      return null;
    }
  }

  /** Looks up free pictures, trying sources in order until there are at least `limit` results. */
  async searchPictures(query: string, limit = 6): Promise<PictureResult[]> {
    let results: PictureResult[] = [];

    const wiki = await fetchJson<WikipediaQueryResponse>(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=0&gsrsearch=${encodeURIComponent(
        query,
      )}&gsrlimit=6&prop=pageimages&piprop=thumbnail&pithumbsize=500`,
    );
    if (wiki) results = dedupePictures([...results, ...parseWikipediaImages(wiki, 6)]);

    if (results.length < limit) {
      const commons = await fetchJson<CommonsQueryResponse>(
        `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(
          query,
        )}&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=500`,
      );
      if (commons) results = dedupePictures([...results, ...parseCommonsImages(commons, 8)]);
    }

    if (results.length < limit) {
      const openverse = await fetchJson<OpenverseResponse>(
        `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=8&mature=false`,
      );
      if (openverse) results = dedupePictures([...results, ...parseOpenverseImages(openverse, 8)]);
    }

    return results.slice(0, limit);
  }

  /** Downloads a picture and resizes it to a JPEG data URL, so it works offline. */
  async downloadPicture(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await this.files.resizeImageToDataUrl(blob);
    } catch {
      return null;
    }
  }

  /** Downloads dictionary pronunciation audio as a Blob, so it plays offline. */
  async downloadAudio(url: string): Promise<Blob | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  buildImageCredit(result: PictureResult): ImageCredit {
    return result.credit;
  }
}
