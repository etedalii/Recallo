import { Component, computed, inject, signal } from '@angular/core';
import { StoreService } from '../../core/store.service';
import { DbService } from '../../core/db.service';
import { Card, CardState, ReviewLog } from '../../core/models';

interface DayCount {
  date: string;
  label: string;
  count: number;
}

interface StageCount {
  stage: string;
  count: number;
}

const MATURE_STABILITY_DAYS = 21;

function dateKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

@Component({
  selector: 'app-stats',
  templateUrl: './stats.html',
  styleUrl: './stats.css',
})
export class Stats {
  protected readonly store = inject(StoreService);
  private readonly db = inject(DbService);

  protected readonly reviews = signal<ReviewLog[]>([]);

  protected readonly reviewsPerDay = computed<DayCount[]>(() => this.buildDayCounts(14));
  protected readonly accuracyPct = computed(() => this.computeAccuracy(30));
  protected readonly totalStudyMinutes = computed(() =>
    Math.round(this.reviews().reduce((sum, r) => sum + r.ms, 0) / 60000),
  );
  protected readonly stageCounts = computed<StageCount[]>(() => this.computeStageCounts(this.store.cards()));
  protected readonly weakWords = computed<Card[]>(() =>
    [...this.store.cards()]
      .filter((c) => c.lapses > 0 || c.D > 0)
      .sort((a, b) => b.lapses - a.lapses || b.D - a.D)
      .slice(0, 15),
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.reviews.set(await this.db.getAllReviews());
  }

  private buildDayCounts(days: number): DayCount[] {
    const reviews = this.reviews();
    const now = new Date();
    const result: DayCount[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = dateKey(d.getTime());
      const count = reviews.filter((r) => dateKey(r.t) === key).length;
      result.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, count });
    }
    return result;
  }

  private computeAccuracy(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    const recent = this.reviews().filter((r) => r.t >= cutoff);
    if (recent.length === 0) return 0;
    const notAgain = recent.filter((r) => r.correct).length;
    return Math.round((notAgain / recent.length) * 100);
  }

  private computeStageCounts(cards: Card[]): StageCount[] {
    let fresh = 0;
    let learning = 0;
    let young = 0;
    let mature = 0;
    for (const c of cards) {
      if (c.state === CardState.New) fresh++;
      else if (c.state === CardState.Learning || c.state === CardState.Relearning) learning++;
      else if (c.S >= MATURE_STABILITY_DAYS) mature++;
      else young++;
    }
    return [
      { stage: 'New', count: fresh },
      { stage: 'Learning', count: learning },
      { stage: 'Young', count: young },
      { stage: 'Mature', count: mature },
    ];
  }

  maxDayCount(): number {
    return Math.max(1, ...this.reviewsPerDay().map((d) => d.count));
  }

  maxStageCount(): number {
    return Math.max(1, ...this.stageCounts().map((s) => s.count));
  }

  barHeight(count: number, max: number): number {
    return Math.round((count / max) * 100);
  }
}
