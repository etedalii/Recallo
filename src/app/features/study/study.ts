import { Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { StoreService } from '../../core/store.service';
import { SpeechService, PronunciationResult } from '../../core/speech.service';
import { RatingPreview } from '../../core/fsrs';
import { AnswerJudgement, WordDiffToken, blankOut, judgeSentence, judgeWord } from '../../core/text-utils';
import { getLanguageName, getLanguageOption, isRtlLanguage } from '../../core/languages';
import { Card, CardMode, PersianDisplay, Rating } from '../../core/models';

type RevealState = 'front' | 'answer';

/** A friendly message for a failed "Say it" attempt, or null when nothing needs saying (e.g. the user cancelled on purpose). */
function sayItErrorMessage(reason: string | null): string | null {
  switch (reason) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow the microphone for this site and try again.';
    case 'no-speech':
      return "Didn't hear anything — tap and speak right away.";
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Speech recognition needs an internet connection.';
    default:
      return "Couldn't understand that — try again.";
  }
}

@Component({
  selector: 'app-study',
  imports: [FormsModule, RouterLink],
  templateUrl: './study.html',
  styleUrl: './study.css',
})
export class Study implements OnDestroy {
  protected readonly store = inject(StoreService);
  private readonly speech = inject(SpeechService);
  private readonly route = inject(ActivatedRoute);

  protected readonly CardMode = CardMode;
  protected readonly PersianDisplay = PersianDisplay;
  protected readonly Rating = Rating;

  protected readonly deck = signal<string | undefined>(undefined);
  protected readonly studyingHard = signal(false);
  protected readonly queue = signal<Card[]>([]);
  protected readonly index = signal(0);
  protected readonly reveal = signal<RevealState>('front');
  protected readonly typedAnswer = signal('');
  protected readonly judgement = signal<AnswerJudgement | null>(null);
  protected readonly diffTokens = signal<WordDiffToken[] | null>(null);
  protected readonly hintRevealed = signal(false);
  protected readonly sayItResult = signal<PronunciationResult | null>(null);
  protected readonly sayItBusy = signal(false);
  protected readonly sayItError = signal<string | null>(null);

  protected readonly sessionReviewed = signal(0);
  protected readonly sessionCorrect = signal(0);
  protected readonly leechMessage = signal<string | null>(null);
  protected readonly canUndo = computed(() => this.store.canUndo());
  private sessionStartedAt = Date.now();

  private startedAt = Date.now();
  /** When the page was last hidden, so backgrounded time isn't counted as study time. */
  private hiddenSince: number | null = null;

  protected readonly current = computed<Card | null>(() => this.queue()[this.index()] ?? null);

  protected readonly clozeInfo = computed(() => {
    const card = this.current();
    if (!card || card.mode !== CardMode.Cloze) return null;
    return blankOut(card.sentence, card.word);
  });

  protected readonly previews = computed<RatingPreview[]>(() => {
    const card = this.current();
    if (!card) return [];
    return this.store.previewForCard(card, new Date());
  });

  protected readonly suggestedRating = computed<Rating | null>(() => {
    const j = this.judgement();
    if (j === 'correct') return Rating.Good;
    if (j === 'almost') return Rating.Hard;
    if (j === 'wrong') return Rating.Again;
    return null;
  });

  protected readonly languageEnabled = computed(() => this.store.settings().secondLanguageEnabled);
  protected readonly languageCode = computed(() => this.store.settings().secondLanguageCode);
  protected readonly languageName = computed(() => getLanguageName(this.languageCode()));
  protected readonly isRtl = computed(() => isRtlLanguage(this.languageCode()));
  protected readonly hasLanguageVoice = computed(
    () => this.speech.getVoiceForLanguage(this.languageCode()) !== null,
  );

  // --- the language being studied (the word itself) ---
  protected readonly studyLanguageCode = computed(() => this.store.settings().studyLanguageCode);
  protected readonly studyLanguageName = computed(() => getLanguageName(this.studyLanguageCode()));

  constructor() {
    const deckParam = this.route.snapshot.paramMap.get('deck');
    this.deck.set(deckParam ?? undefined);
    this.buildQueue();
  }

  private buildQueue(): void {
    const now = new Date();
    const list = this.studyingHard()
      ? this.store.hardCards(this.deck())
      : this.store.buildStudyQueue(now, this.deck());
    this.queue.set(list);
    this.index.set(0);
    this.sessionReviewed.set(0);
    this.sessionCorrect.set(0);
    this.leechMessage.set(null);
    this.sessionStartedAt = Date.now();
    this.store.clearUndo();
    this.resetCardState();
  }

  toggleHardMode(): void {
    this.studyingHard.set(!this.studyingHard());
    this.buildQueue();
  }

  private resetCardState(): void {
    this.speech.stopListening();
    this.reveal.set('front');
    this.typedAnswer.set('');
    this.judgement.set(null);
    this.diffTokens.set(null);
    this.hintRevealed.set(false);
    this.sayItResult.set(null);
    this.sayItError.set(null);
    this.sayItBusy.set(false);
    this.startedAt = Date.now();
    this.hiddenSince = document.visibilityState === 'hidden' ? this.startedAt : null;
  }

  ngOnDestroy(): void {
    this.speech.stopListening();
  }

  showAnswer(): void {
    this.reveal.set('answer');
    this.maybeAutoPlay();
  }

  revealHint(): void {
    this.hintRevealed.set(true);
  }

  hintText(): string {
    const card = this.current();
    if (!card) return '';
    const target = card.mode === CardMode.Cloze ? this.clozeInfo()?.hiddenWord ?? card.word : card.word;
    return this.hintRevealed() ? `First letter: ${target.charAt(0).toUpperCase()}` : '';
  }

  submitTyped(): void {
    const card = this.current();
    if (!card) return;
    const typed = this.typedAnswer();

    if (card.mode === CardMode.Listen) {
      const { judgement, diff } = judgeSentence(card.sentence, typed);
      this.judgement.set(judgement);
      this.diffTokens.set(diff.tokens);
    } else if (card.mode === CardMode.Fix) {
      const { judgement, diff } = judgeSentence(card.answer, typed);
      this.judgement.set(judgement);
      this.diffTokens.set(diff.tokens);
    } else if (card.mode === CardMode.Cloze) {
      const target = this.clozeInfo()?.hiddenWord ?? card.word;
      this.judgement.set(judgeWord(target, typed));
    } else {
      // Type or Persian: the user types the word being studied.
      this.judgement.set(judgeWord(card.word, typed));
    }
    this.reveal.set('answer');
    this.maybeAutoPlay();
  }

  private maybeAutoPlay(): void {
    const card = this.current();
    if (!card || !this.store.settings().autoPlayOnAnswer) return;
    if (card.mode === CardMode.Listen) {
      void this.playSentence(false);
    } else {
      void this.playWord();
    }
  }

  /** Voice + BCP-47 locale for speaking text in the language being studied. */
  private resolveStudyVoice(): { voice: SpeechSynthesisVoice | null; lang: string } {
    const settings = this.store.settings();
    const voice = this.speech.getVoicesForLanguage(settings.studyLanguageCode).find((v) => v.name === settings.voiceName) ?? null;
    return { voice, lang: getLanguageOption(settings.studyLanguageCode).speechLang };
  }

  async playWord(): Promise<void> {
    const card = this.current();
    if (!card) return;
    if (card.audioBlob && (await this.speech.playBlob(card.audioBlob))) {
      return;
    }
    // No recorded audio, or it failed to play — fall back to the voice.
    const { voice, lang } = this.resolveStudyVoice();
    await this.speech.speak(card.word, { voice, rate: this.store.settings().speechRate, lang });
  }

  async playSentence(slow: boolean): Promise<void> {
    const card = this.current();
    if (!card || !card.sentence) return;
    const { voice, lang } = this.resolveStudyVoice();
    await this.speech.speak(card.sentence, { voice, rate: slow ? 0.6 : this.store.settings().speechRate, lang });
  }

  /** Speaks the card's definition aloud, so a learner can hear it read correctly, not just see it. */
  async playDefinition(): Promise<void> {
    const card = this.current();
    if (!card || !card.definition) return;
    const { voice, lang } = this.resolveStudyVoice();
    await this.speech.speak(card.definition, { voice, rate: this.store.settings().speechRate, lang });
  }

  /** Speaks a single synonym or opposite aloud when its chip is tapped. */
  async playWordLike(word: string): Promise<void> {
    const { voice, lang } = this.resolveStudyVoice();
    await this.speech.speak(word, { voice, rate: this.store.settings().speechRate, lang });
  }

  async playSecondLanguage(text: string): Promise<void> {
    const code = this.languageCode();
    const voice = this.speech.getVoiceForLanguage(code);
    await this.speech.speak(text, { voice, lang: getLanguageOption(code).speechLang, rate: 1 });
  }

  async sayIt(): Promise<void> {
    if (this.sayItBusy()) {
      // Already listening - this click means "cancel", not "start again".
      this.speech.stopListening();
      return;
    }
    const card = this.current();
    if (!card) return;
    this.sayItResult.set(null);
    this.sayItError.set(null);
    this.sayItBusy.set(true);
    const target = card.mode === CardMode.Listen || card.mode === CardMode.Fix ? card.sentence : card.word;
    const result = await this.speech.listenAndCompare(target, getLanguageOption(this.studyLanguageCode()).speechLang);
    this.sayItBusy.set(false);
    if (result) {
      this.sayItResult.set(result);
    } else {
      this.sayItError.set(sayItErrorMessage(this.speech.lastListenErrorReason));
    }
  }

  get sayItSupported(): boolean {
    return this.speech.recognitionSupported;
  }

  async rate(rating: Rating): Promise<void> {
    const card = this.current();
    if (!card) return;
    const updated = await this.store.rateCard(card, rating, this.startedAt);
    this.sessionReviewed.set(this.sessionReviewed() + 1);
    if (rating !== Rating.Again) this.sessionCorrect.set(this.sessionCorrect() + 1);
    if (updated.suspended && !card.suspended) {
      this.leechMessage.set(
        `"${updated.word}" was suspended after ${updated.lapses} lapses — it's a leech. Unsuspend it in Browse if you want to keep studying it.`,
      );
    }
    this.index.set(this.index() + 1);
    this.resetCardState();
  }

  /** Puts the just-rated card back exactly as it was, one step only. */
  async undo(): Promise<void> {
    const info = this.store.lastRating();
    if (!info) return;
    await this.store.undoLast();
    this.sessionReviewed.set(Math.max(0, this.sessionReviewed() - 1));
    if (info.log.correct) this.sessionCorrect.set(Math.max(0, this.sessionCorrect() - 1));
    this.index.set(Math.max(0, this.index() - 1));
    this.resetCardState();
  }

  protected sessionAccuracyPct(): number {
    const reviewed = this.sessionReviewed();
    return reviewed > 0 ? Math.round((this.sessionCorrect() / reviewed) * 100) : 0;
  }

  dismissLeechMessage(): void {
    this.leechMessage.set(null);
  }

  protected sessionDurationLabel(): string {
    const totalSeconds = Math.round((Date.now() - this.sessionStartedAt) / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  persianDisplayAllowsHint(): boolean {
    return this.languageEnabled() && this.store.settings().persianDisplay === PersianDisplay.OnAnswerAndHint;
  }

  showsPicture(): boolean {
    const card = this.current();
    if (!card) return false;
    if (this.reveal() === 'answer') return true;
    if (card.mode !== CardMode.Flip) return false;
    return this.store.settings().showPictureOnFront;
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.reveal() !== 'answer') return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const map: Record<string, Rating> = { '1': Rating.Again, '2': Rating.Hard, '3': Rating.Good, '4': Rating.Easy };
    const rating = map[event.key];
    if (rating) {
      event.preventDefault();
      void this.rate(rating);
    }
  }

  ratingLabel(rating: Rating): string {
    return this.previews().find((p) => p.rating === rating)?.label ?? '';
  }

  /**
   * Excludes backgrounded time from the current card's timer — otherwise
   * switching apps, locking the phone or leaving a tab open mid-card would
   * count that whole gap as study time and inflate the stats page's total.
   */
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.hiddenSince = Date.now();
    } else if (this.hiddenSince !== null) {
      this.startedAt += Date.now() - this.hiddenSince;
      this.hiddenSince = null;
    }
  }
}
