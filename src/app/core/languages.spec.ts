import { describe, expect, it } from 'vitest';
import { getLanguageName, isRtlLanguage, SECOND_LANGUAGE_OPTIONS } from './languages';

describe('languages', () => {
  it('knows Persian and Arabic are right-to-left', () => {
    expect(isRtlLanguage('fa')).toBe(true);
    expect(isRtlLanguage('ar')).toBe(true);
  });

  it('knows French and Spanish are left-to-right', () => {
    expect(isRtlLanguage('fr')).toBe(false);
    expect(isRtlLanguage('es')).toBe(false);
  });

  it('falls back to the first option for an unknown code', () => {
    expect(getLanguageName('xx')).toBe(SECOND_LANGUAGE_OPTIONS[0].name);
  });

  it('returns the display name for a known code', () => {
    expect(getLanguageName('fr')).toBe('French');
  });
});
