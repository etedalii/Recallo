import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StoreService } from '../../core/store.service';
import { normalize } from '../../core/text-utils';
import { isRtlLanguage } from '../../core/languages';
import { Card } from '../../core/models';

@Component({
  selector: 'app-browse',
  imports: [FormsModule],
  templateUrl: './browse.html',
  styleUrl: './browse.css',
})
export class Browse {
  protected readonly store = inject(StoreService);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly deckFilter = signal('');
  protected readonly tagFilter = signal('');

  protected readonly results = computed<Card[]>(() => {
    const q = normalize(this.query());
    const deckFilter = this.deckFilter();
    const tagFilter = this.tagFilter();
    return this.store
      .cards()
      .filter((c) => !deckFilter || c.deck === deckFilter)
      .filter((c) => !tagFilter || c.tags.includes(tagFilter))
      .filter((c) => {
        if (!q) return true;
        const haystack = normalize(`${c.word} ${c.definition} ${c.persian} ${c.tags.join(' ')}`);
        return haystack.includes(q);
      })
      .sort((a, b) => a.word.localeCompare(b.word));
  });

  protected readonly isRtl = computed(() => isRtlLanguage(this.store.settings().secondLanguageCode));
  protected readonly languageCode = computed(() => this.store.settings().secondLanguageCode);

  deckOptions(): string[] {
    return this.store.decks();
  }

  tagOptions(): string[] {
    return this.store.allTags();
  }

  edit(card: Card): void {
    void this.router.navigate(['/edit', card.id]);
  }

  async remove(card: Card): Promise<void> {
    if (!window.confirm(`Delete "${card.word}" (${card.mode})?`)) return;
    await this.store.deleteCard(card.id);
  }

  async toggleSuspend(card: Card): Promise<void> {
    await this.store.setSuspended(card.id, !card.suspended);
  }
}
