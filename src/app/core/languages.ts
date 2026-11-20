// Catalogue of languages Recallo knows about: which one the user is
// studying (the word on the front of the card — drives the dictionary
// Lookup button, pronunciation and audio) and which one shows the meaning
// ("second language" — translation, sentence translation, and the
// second-language-to-target style card). Pure data + pure helpers, no
// Angular imports, so it can be unit tested directly.

export interface LanguageOption {
  /** ISO 639-1 code, also used as MyMemory's `langpair` code and dictionaryapi.dev's path segment. */
  code: string;
  name: string;
  rtl: boolean;
  /** A full BCP-47 tag for speechSynthesis / SpeechRecognition, e.g. "fa-IR". */
  speechLang: string;
}

export const LANGUAGE_CATALOG: readonly LanguageOption[] = [
  { code: 'en', name: 'English', rtl: false, speechLang: 'en-US' },
  { code: 'fa', name: 'Persian', rtl: true, speechLang: 'fa-IR' },
  { code: 'ar', name: 'Arabic', rtl: true, speechLang: 'ar-SA' },
  { code: 'ur', name: 'Urdu', rtl: true, speechLang: 'ur-PK' },
  { code: 'he', name: 'Hebrew', rtl: true, speechLang: 'he-IL' },
  { code: 'fr', name: 'French', rtl: false, speechLang: 'fr-FR' },
  { code: 'es', name: 'Spanish', rtl: false, speechLang: 'es-ES' },
  { code: 'de', name: 'German', rtl: false, speechLang: 'de-DE' },
  { code: 'it', name: 'Italian', rtl: false, speechLang: 'it-IT' },
  { code: 'pt', name: 'Portuguese', rtl: false, speechLang: 'pt-PT' },
  { code: 'tr', name: 'Turkish', rtl: false, speechLang: 'tr-TR' },
  { code: 'ru', name: 'Russian', rtl: false, speechLang: 'ru-RU' },
  { code: 'zh', name: 'Chinese', rtl: false, speechLang: 'zh-CN' },
  { code: 'ja', name: 'Japanese', rtl: false, speechLang: 'ja-JP' },
  { code: 'ko', name: 'Korean', rtl: false, speechLang: 'ko-KR' },
  { code: 'hi', name: 'Hindi', rtl: false, speechLang: 'hi-IN' },
];

const BY_CODE = new Map(LANGUAGE_CATALOG.map((l) => [l.code, l]));

export function getLanguageOption(code: string): LanguageOption {
  return BY_CODE.get(code) ?? LANGUAGE_CATALOG[0];
}

export function getLanguageName(code: string): string {
  return getLanguageOption(code).name;
}

export function isRtlLanguage(code: string): boolean {
  return getLanguageOption(code).rtl;
}

/**
 * Languages the main word on a card can be studied in. Picking one of these
 * (Settings -> "What are you learning?") changes which language the
 * dictionary Lookup button, pronunciation practice and audio use. Limited to
 * languages dictionaryapi.dev actually covers well — not every language in
 * `LANGUAGE_CATALOG` has a free dictionary API behind it.
 */
export const STUDY_LANGUAGE_OPTIONS: readonly LanguageOption[] = LANGUAGE_CATALOG.filter(
  (l) => l.code === 'en' || l.code === 'fr',
);

/** Meaning/translation language choices (Settings -> "Second language"). */
export const SECOND_LANGUAGE_OPTIONS: readonly LanguageOption[] = LANGUAGE_CATALOG;

/**
 * Datamuse (the free API behind "Collocations") only indexes English. There
 * is no free equivalent for other languages, so the feature is hidden
 * rather than silently returning nothing for a French word.
 */
export function collocationsSupported(studyLanguageCode: string): boolean {
  return studyLanguageCode === 'en';
}
