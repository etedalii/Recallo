import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { StoreService } from '../../core/store.service';
import { BackupService, backupFileName, shouldShowBackupReminder } from '../../core/backup.service';
import { FilesService } from '../../core/files.service';
import { DbService } from '../../core/db.service';
import { CardState } from '../../core/models';

interface DeckSummary {
  name: string;
  due: number;
  fresh: number;
  hard: number;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  protected readonly store = inject(StoreService);
  private readonly backup = inject(BackupService);
  private readonly files = inject(FilesService);
  private readonly db = inject(DbService);
  private readonly router = inject(Router);

  protected readonly showBanner = signal(false);
  protected readonly streak = signal(0);

  protected readonly deckSummaries = computed<DeckSummary[]>(() => {
    const decks = this.store.decks();
    const now = new Date();
    const all: DeckSummary[] = decks.map((name) => ({
      name,
      due: this.store.dueCards(now, name).filter((c) => c.state !== CardState.New).length,
      fresh: this.store.newCardsWaiting(now, name).length,
      hard: this.store.hardCards(name).length,
    }));
    if (decks.length === 0) return [];
    return all;
  });

  protected readonly totalDue = computed(() => this.store.buildStudyQueue(new Date()).length);

  protected readonly goalProgress = computed(() => {
    const goal = this.store.settings().dailyGoal;
    const done = this.store.effectiveCounters(new Date()).reviewsShown;
    return { done, goal, pct: goal > 0 ? Math.min(100, Math.round((done / goal) * 100)) : 0 };
  });

  constructor() {
    void this.refreshBanner();
    void this.computeStreak();
  }

  private async refreshBanner(): Promise<void> {
    const [lastBackup, snoozeUntil] = await Promise.all([
      this.backup.getLastBackup(),
      this.backup.getBannerSnoozeUntil(),
    ]);
    this.showBanner.set(shouldShowBackupReminder(this.store.cards().length, lastBackup, snoozeUntil, new Date()));
  }

  private async computeStreak(): Promise<void> {
    const reviews = await this.db.getAllReviews();
    const days = new Set(reviews.map((r) => new Date(r.t).toDateString()));
    let count = 0;
    const cursor = new Date();
    while (days.has(cursor.toDateString())) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    this.streak.set(count);
  }

  async backUpNow(): Promise<void> {
    const file = await this.backup.buildBackup(this.store.settings());
    const shared = await this.files.shareOrDownload({
      name: backupFileName(),
      mimeType: 'application/json',
      content: JSON.stringify(file, null, 2),
    });
    if (shared) {
      await this.backup.recordBackup(file.cards.length);
      this.showBanner.set(false);
    }
  }

  async later(): Promise<void> {
    await this.backup.snoozeBanner(2);
    this.showBanner.set(false);
  }

  studyDeck(name?: string): void {
    void this.router.navigate(name ? ['/study', name] : ['/study']);
  }
}
