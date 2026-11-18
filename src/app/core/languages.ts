// Catalogue of "second language" choices for translation (meaning, sentence
// translation, and the Persian->English style card). Pure data + pure
// helpers, no Angular imports, so it can be unit tested directly.

export interface LanguageOption {
  /** ISO 639-1 code, also used as MyMemory's target `langpair` code. */
  code: string;
  name: string;
  rtl: boolean;
  /** A full BCP-47 tag for speechSynthesis, e.g. "fa-IR". */
  speechLang: string;
}

export const SECOND_LANGUAGE_OPTIONS: readonly LanguageOption[] = [
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

const BY_CODE = new Map(SECOND_LANGUAGE_OPTIONS.map((l) => [l.code, l]));

export function getLanguageOption(code: string): LanguageOption {
  return BY_CODE.get(code) ?? SECOND_LANGUAGE_OPTIONS[0];
}

export function getLanguageName(code: string): string {
  return getLanguageOption(code).name;
}

export function isRtlLanguage(code: string): boolean {
  return getLanguageOption(code).rtl;
}
