import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StoreService } from '../../core/store.service';
import { CardKind, CardMode } from '../../core/models';

@Component({
  selector: 'app-mistake-form',
  imports: [FormsModule],
  templateUrl: './mistake-form.html',
  styleUrl: './mistake-form.css',
})
export class MistakeForm {
  private readonly store = inject(StoreService);
  private readonly router = inject(Router);

  protected deck = 'Mistakes';
  protected wrongSentence = '';
  protected correctedSentence = '';
  protected note = '';

  deckOptions(): string[] {
    return this.store.decks();
  }

  async save(): Promise<void> {
    if (!this.wrongSentence.trim() || !this.correctedSentence.trim()) return;
    await this.store.addNote({
      deck: this.deck.trim() || 'Mistakes',
      kind: CardKind.Phrase,
      word: this.correctedSentence.trim(),
      phonetic: '',
      definition: '',
      persian: '',
      sentence: this.wrongSentence.trim(),
      persianSentence: '',
      note: this.note.trim(),
      synonyms: [],
      antonyms: [],
      collocations: [],
      tags: [],
      image: null,
      imageCredit: null,
      audioUrl: null,
      audioBlob: null,
      modes: [CardMode.Fix],
      answer: this.correctedSentence.trim(),
    });
    await this.router.navigate(['/home']);
  }
}
