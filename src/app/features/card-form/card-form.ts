import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { StoreService } from '../../core/store.service';
import { LookupService } from '../../core/lookup.service';
import { FilesService } from '../../core/files.service';
import { getLanguageName, isRtlLanguage } from '../../core/languages';
import {
  Card,
  CardKind,
  CardMode,
  DictionaryDefinition,
  DictionaryLookupResult,
  ImageCredit,
  PictureResult,
  TranslationChoice,
} from '../../core/models';

interface ModeOption {
  mode: CardMode;
  selected: boolean;
}

@Component({
  selector: 'app-card-form',
  imports: [FormsModule],
  templateUrl: './card-form.html',
  styleUrl: './card-form.css',
})
export class CardForm {
  protected readonly store = inject(StoreService);
  private readonly lookup = inject(LookupService);
  private readonly files = inject(FilesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly CardKind = CardKind;
  protected readonly CardMode = CardMode;

  // --- editing an existing note vs. creating a new one -----------------
  protected readonly editingCard = signal<Card | null>(null);
  protected readonly isEditing = signal(false);

  // --- shared note fields ------------------------------------------------
  protected deck = '';
  protected kind: CardKind = CardKind.Word;
  protected word = '';
  protected phonetic = '';
  protected definition = '';
  protected persian = '';
  protected sentence = '';
  protected persianSentence = '';
  protected note = '';
  protected tagsText = '';
  protected synonymsText = '';
  protected antonymsText = '';
  protected collocationsText = '';
  protected image = signal<string | null>(null);
  protected imageCredit = signal<ImageCredit | null>(null);
  protected audioUrl: string | null = null;
  protected audioBlob = signal<Blob | null>(null);

  protected readonly modeOptions = signal<ModeOption[]>([
    { mode: CardMode.Flip, selected: true },
    { mode: CardMode.Type, selected: false },
    { mode: CardMode.Cloze, selected: false },
    { mode: CardMode.Listen, selected: false },
    { mode: CardMode.Persian, selected: false },
  ]);

  // --- second-language settings (name kept generic; the field is called
  // "Persian" in the data model for CSV/backup compatibility, but the
  // actual language is whatever Settings -> Second language picks) --------
  protected readonly languageEnabled = computed(() => this.store.settings().secondLanguageEnabled);
  protected readonly languageCode = computed(() => this.store.settings().secondLanguageCode);
  protected readonly languageName = computed(() => getLanguageName(this.languageCode()));
  protected readonly isRtl = computed(() => isRtlLanguage(this.languageCode()));

  // --- lookup state --------------------------------------------------------
  protected readonly looking = signal(false);
  protected readonly definitions = signal<DictionaryDefinition[]>([]);
  protected readonly lookupMessage = signal('');

  protected readonly collocationChips = signal<string[]>([]);
  protected readonly collocationsLoading = signal(false);

  protected readonly persianChoices = signal<TranslationChoice[]>([]);
  protected readonly persianSentenceChoices = signal<TranslationChoice[]>([]);
  protected readonly translateMessage = signal('');

  protected pictureQuery = '';
  protected readonly pictureResults = signal<PictureResult[]>([]);
  protected readonly pictureLoading = signal(false);
  protected readonly pictureMessage = signal('');

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadForEdit(id);
    }
  }

  private loadForEdit(id: string): void {
    const card = this.store.cards().find((c) => c.id === id);
    if (!card) {
      // Stale link (card was deleted) or a bad URL — there's nothing to
      // edit, so don't silently fall back to a blank "Add a card" form.
      window.alert("That card couldn't be found — it may have been deleted.");
      void this.router.navigate(['/browse']);
      return;
    }
    this.editingCard.set(card);
    this.isEditing.set(true);
    this.deck = card.deck;
    this.kind = card.kind;
    this.word = card.word;
    this.phonetic = card.phonetic;
    this.definition = card.definition;
    this.persian = card.persian;
    this.sentence = card.sentence;
    this.persianSentence = card.persianSentence;
    this.note = card.note;
    this.tagsText = card.tags.join(', ');
    this.synonymsText = card.synonyms.join(', ');
    this.antonymsText = card.antonyms.join(', ');
    this.collocationsText = card.collocations.join(', ');
    this.image.set(card.image);
    this.imageCredit.set(card.imageCredit);
    this.audioUrl = card.audioUrl;
    this.audioBlob.set(card.audioBlob);
    this.pictureQuery = card.word;
  }

  toggleMode(mode: CardMode): void {
    this.modeOptions.set(
      this.modeOptions().map((m) => (m.mode === mode ? { ...m, selected: !m.selected } : m)),
    );
  }

  /**
   * One tap fetches everything the form can auto-fill: English definition
   * + example, Persian meaning (+ Persian sentence once an example is
   * picked), collocations, pronunciation audio, and picture suggestions.
   *
   * Pressing it again for a different word always replaces the previous
   * results — it would be surprising for "Look up" to silently do nothing
   * just because a field already has text in it from the last word.
   */
  async lookupWord(): Promise<void> {
    const word = this.word.trim();
    if (!word) return;
    this.looking.set(true);
    this.lookupMessage.set('');
    this.translateMessage.set('');
    this.pictureQuery = word;

    // Clear the previous word's results so stale chips/pictures/text don't
    // linger while the new ones load. (pickDefinition() below merges
    // synonyms/antonyms onto whatever is already there, which is handy
    // when tapping several chips for the *same* word — so it needs to
    // start from empty here, for a different word.)
    this.definitions.set([]);
    this.persianChoices.set([]);
    this.persianSentenceChoices.set([]);
    this.collocationChips.set([]);
    this.pictureResults.set([]);
    this.synonymsText = '';
    this.antonymsText = '';

    const [dictResult] = await Promise.all([
      this.runDictionaryLookup(word),
      this.languageEnabled() ? this.runPersianWordLookup(word) : Promise.resolve(),
      this.runCollocationsLookup(word),
      this.runPictureSearch(word),
    ]);
    this.looking.set(false);

    if (!dictResult) {
      this.lookupMessage.set('Could not look up this word. You can still type everything by hand.');
      return;
    }

    // Auto-pick a definition so the form fills itself; the user can tap
    // any other chip to change the choice. The dictionary groups senses by
    // part of speech (noun, verb, adjective, ...) in whatever order it has
    // them, not by which is most common — so definition #1 is sometimes a
    // rare sense with no example or antonyms while a later one (often the
    // adjective sense) has both. Prefer the first definition that actually
    // has something extra to show, and only fall back to #1 if none do.
    const bestDef =
      dictResult.definitions.find((d) => d.example || d.antonyms.length) ?? dictResult.definitions[0];
    if (bestDef) {
      this.pickDefinition(bestDef);
    }
    this.sentence = bestDef?.example ?? '';
    if (this.sentence && this.languageEnabled()) {
      await this.runPersianSentenceLookup(this.sentence);
    } else {
      this.persianSentence = '';
    }

    // The free dictionary simply doesn't have everything for every word
    // (phonetic, example sentences and antonyms are often missing for
    // less common words) — say so plainly instead of leaving fields
    // blank with no explanation.
    const missing: string[] = [];
    if (!this.phonetic) missing.push('phonetic');
    if (!this.sentence) missing.push('an example sentence');
    if (!this.antonymsText) missing.push('antonyms');
    if (missing.length) {
      this.lookupMessage.set(
        `The dictionary didn't have ${missing.join(', ')} for this word — type them by hand if you'd like.`,
      );
    }
  }

  private async runDictionaryLookup(word: string): Promise<DictionaryLookupResult | null> {
    const result = await this.lookup.lookupWord(word);
    this.phonetic = result?.phonetic ?? '';
    this.audioUrl = result?.audioUrl ?? null;
    this.audioBlob.set(null);
    if (result) {
      this.definitions.set(result.definitions);
      if (result.audioUrl) {
        const blob = await this.lookup.downloadAudio(result.audioUrl);
        if (blob) this.audioBlob.set(blob);
      }
    }
    return result;
  }

  private async runPersianWordLookup(word: string): Promise<void> {
    const choices = await this.lookup.lookupTranslation(word, this.languageCode());
    if (!choices) {
      this.translateMessage.set(`${this.languageName()} translation is unavailable right now (offline or daily limit reached). Type it by hand.`);
      return;
    }
    this.persianChoices.set(choices);
    this.persian = choices[0]?.text ?? '';
  }

  private async runPersianSentenceLookup(sentence: string): Promise<void> {
    if (!sentence) return;
    const choices = await this.lookup.lookupTranslation(sentence, this.languageCode());
    if (!choices) return;
    this.persianSentenceChoices.set(choices);
    this.persianSentence = choices[0]?.text ?? '';
  }

  private async runCollocationsLookup(word: string): Promise<void> {
    this.collocationsLoading.set(true);
    const results = await this.lookup.lookupCollocations(word);
    this.collocationChips.set(results);
    this.collocationsLoading.set(false);
    // Pre-fill the field with the top few so there's something to see and
    // edit right away; the rest stay as tappable chips to add more.
    this.collocationsText = results.slice(0, 3).join(', ');
  }

  private async runPictureSearch(word: string): Promise<void> {
    this.pictureLoading.set(true);
    const results = await this.lookup.searchPictures(this.pictureQuery.trim() || word, 6);
    this.pictureLoading.set(false);
    this.pictureResults.set(results);
  }

  pickDefinition(def: DictionaryDefinition): void {
    this.definition = def.definition;
    if (def.synonyms.length) this.synonymsText = [...new Set([...this.synonymsFromText(), ...def.synonyms])].join(', ');
    if (def.antonyms.length) this.antonymsText = [...new Set([...this.antonymsFromText(), ...def.antonyms])].join(', ');
  }

  async pickExample(def: DictionaryDefinition): Promise<void> {
    if (!def.example) return;
    this.sentence = def.example;
    // The old Persian sentence (if any) belongs to the previous example —
    // re-translate so it doesn't go stale/mismatched.
    this.persianSentence = '';
    this.persianSentenceChoices.set([]);
    if (this.languageEnabled()) {
      await this.runPersianSentenceLookup(this.sentence);
    }
  }

  private synonymsFromText(): string[] {
    return this.synonymsText.split(',').map((s) => s.trim()).filter(Boolean);
  }
  private antonymsFromText(): string[] {
    return this.antonymsText.split(',').map((s) => s.trim()).filter(Boolean);
  }

  async findCollocations(): Promise<void> {
    if (!this.word.trim()) return;
    this.collocationsLoading.set(true);
    const results = await this.lookup.lookupCollocations(this.word.trim());
    this.collocationChips.set(results);
    this.collocationsLoading.set(false);
  }

  addCollocation(phrase: string): void {
    const current = this.collocationsFromText();
    if (!current.includes(phrase)) {
      this.collocationsText = [...current, phrase].join(', ');
    }
  }

  private collocationsFromText(): string[] {
    return this.collocationsText.split(',').map((s) => s.trim()).filter(Boolean);
  }

  async translateWord(): Promise<void> {
    if (!this.word.trim()) return;
    this.translateMessage.set('');
    const choices = await this.lookup.lookupTranslation(this.word.trim(), this.languageCode());
    if (!choices) {
      this.translateMessage.set('Translation is unavailable right now (offline or daily limit reached). Type it by hand.');
      return;
    }
    this.persianChoices.set(choices);
  }

  async translateSentence(): Promise<void> {
    if (!this.sentence.trim()) return;
    this.translateMessage.set('');
    const choices = await this.lookup.lookupTranslation(this.sentence.trim(), this.languageCode());
    if (!choices) {
      this.translateMessage.set('Translation is unavailable right now (offline or daily limit reached). Type it by hand.');
      return;
    }
    this.persianSentenceChoices.set(choices);
  }

  pickPersian(choice: TranslationChoice): void {
    this.persian = choice.text;
  }

  pickPersianSentence(choice: TranslationChoice): void {
    this.persianSentence = choice.text;
  }

  async findPictures(): Promise<void> {
    const query = this.pictureQuery.trim() || this.word.trim();
    if (!query) return;
    this.pictureLoading.set(true);
    this.pictureMessage.set('');
    const results = await this.lookup.searchPictures(query, 6);
    this.pictureLoading.set(false);
    if (results.length === 0) {
      this.pictureMessage.set('No pictures found. You can add your own instead.');
    }
    this.pictureResults.set(results);
  }

  async pickPicture(result: PictureResult): Promise<void> {
    this.pictureMessage.set('Downloading picture…');
    const dataUrl = await this.lookup.downloadPicture(result.fullUrl);
    if (!dataUrl) {
      this.pictureMessage.set('That picture could not be downloaded. Try another one.');
      return;
    }
    this.image.set(dataUrl);
    this.imageCredit.set(result.credit);
    this.pictureMessage.set('');
  }

  async onOwnPicture(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const dataUrl = await this.files.resizeImageToDataUrl(file);
    this.image.set(dataUrl);
    this.imageCredit.set(null);
    input.value = '';
  }

  removePicture(): void {
    this.image.set(null);
    this.imageCredit.set(null);
  }

  async save(): Promise<void> {
    if (!this.word.trim()) return;
    const tags = this.splitList(this.tagsText);
    const kindTag = this.kind;
    const tagsWithKind = Array.from(new Set([...tags.filter((t) => !Object.values(CardKind).includes(t as CardKind)), kindTag]));

    const existing = this.editingCard();
    if (existing) {
      const updated: Card = {
        ...existing,
        deck: this.deck.trim() || 'Default',
        kind: this.kind,
        word: this.word.trim(),
        phonetic: this.phonetic.trim(),
        definition: this.definition.trim(),
        persian: this.persian.trim(),
        sentence: this.sentence.trim(),
        persianSentence: this.persianSentence.trim(),
        note: this.note.trim(),
        synonyms: this.splitList(this.synonymsText),
        antonyms: this.splitList(this.antonymsText),
        collocations: this.splitList(this.collocationsText),
        tags: tagsWithKind,
        image: this.image(),
        imageCredit: this.imageCredit(),
        audioUrl: this.audioUrl,
        audioBlob: this.audioBlob(),
      };
      await this.store.updateCard(updated);
      await this.router.navigate(['/browse']);
      return;
    }

    const modes = this.modeOptions().filter((m) => m.selected).map((m) => m.mode);
    if (modes.length === 0) modes.push(CardMode.Flip);

    await this.store.addNote({
      deck: this.deck.trim() || 'Default',
      kind: this.kind,
      word: this.word.trim(),
      phonetic: this.phonetic.trim(),
      definition: this.definition.trim(),
      persian: this.persian.trim(),
      sentence: this.sentence.trim(),
      persianSentence: this.persianSentence.trim(),
      note: this.note.trim(),
      synonyms: this.splitList(this.synonymsText),
      antonyms: this.splitList(this.antonymsText),
      collocations: this.splitList(this.collocationsText),
      tags: tagsWithKind,
      image: this.image(),
      imageCredit: this.imageCredit(),
      audioUrl: this.audioUrl,
      audioBlob: this.audioBlob(),
      modes,
    });
    await this.router.navigate(['/home']);
  }

  private splitList(text: string): string[] {
    return text.split(',').map((s) => s.trim()).filter(Boolean);
  }

  deckOptions(): string[] {
    return this.store.decks();
  }

  modeLabel(mode: CardMode): string {
    switch (mode) {
      case CardMode.Flip:
        return 'Flip (word + audio)';
      case CardMode.Type:
        return 'Type the word';
      case CardMode.Cloze:
        return 'Cloze (fill the blank)';
      case CardMode.Listen:
        return 'Listen & type';
      case CardMode.Persian:
        return `${this.languageName()} → English`;
      case CardMode.Fix:
        return 'Fix the sentence';
    }
  }
}
