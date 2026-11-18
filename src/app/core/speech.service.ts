import { Injectable } from '@angular/core';
import { levenshtein, normalize } from './text-utils';

/** Minimal typing for the non-standard SpeechRecognition API. */
interface SpeechRecognitionResultLike {
  transcript: string;
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeakOptions {
  voice?: SpeechSynthesisVoice | null;
  rate?: number;
  lang?: string;
}

export interface PronunciationResult {
  heard: string;
  similarity: number;
}

/**
 * Text-to-speech (speechSynthesis), recorded-audio playback, and speech
 * recognition for the "Say it" pronunciation check. Every method fails
 * gracefully (never throws) when a browser feature is missing.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  get ttsSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  get recognitionSupported(): boolean {
    return typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null;
  }

  getEnglishVoices(): SpeechSynthesisVoice[] {
    if (!this.ttsSupported) return [];
    return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  }

  /** A system voice for the given ISO 639-1 language code, if the phone has one. */
  getVoiceForLanguage(langCode: string): SpeechSynthesisVoice | null {
    if (!this.ttsSupported) return null;
    return window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(langCode.toLowerCase())) ?? null;
  }

  /** Speaks text with speechSynthesis. Resolves even if speech is unsupported. */
  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (!this.ttsSupported || !text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options.rate ?? 1;
      utterance.lang = options.lang ?? 'en-US';
      if (options.voice) utterance.voice = options.voice;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Plays a previously downloaded pronunciation Blob. Always revokes the
   * object URL once playback ends (or immediately, if it never started)
   * and never throws — returns false on failure so the caller can fall
   * back to speechSynthesis instead.
   */
  async playBlob(blob: Blob): Promise<boolean> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    try {
      await audio.play();
      return true;
    } catch {
      URL.revokeObjectURL(url);
      return false;
    }
  }

  /**
   * Listens for one short utterance and compares it with `targetText`.
   * Resolves `null` if speech recognition is not supported, so callers can
   * show a friendly message instead of a broken button.
   */
  listenAndCompare(targetText: string, lang = 'en-US'): Promise<PronunciationResult | null> {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return Promise.resolve(null);

    return new Promise((resolve) => {
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        const heard = event.results[0]?.[0]?.transcript ?? '';
        resolve({ heard, similarity: this.similarity(targetText, heard) });
      };
      recognition.onerror = () => resolve(null);
      recognition.onend = () => resolve(null);

      try {
        recognition.start();
      } catch {
        resolve(null);
      }
    });
  }

  /** 0..1 similarity score between two short phrases, based on edit distance. */
  similarity(expected: string, heard: string): number {
    const a = normalize(expected);
    const b = normalize(heard);
    if (a.length === 0 && b.length === 0) return 1;
    const distance = levenshtein(a, b);
    return Math.max(0, 1 - distance / Math.max(a.length, b.length, 1));
  }
}
