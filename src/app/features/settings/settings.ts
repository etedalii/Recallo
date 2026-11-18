import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../../core/store.service';
import { BackupService, backupFileName } from '../../core/backup.service';
import { FilesService } from '../../core/files.service';
import { SpeechService } from '../../core/speech.service';
import { CardKind, CardMode, LastBackupInfo, PersianDisplay, ThemePreference } from '../../core/models';
import { defaultCardKindFromTags } from '../../core/store.service';
import { SECOND_LANGUAGE_OPTIONS } from '../../core/languages';

const STYLE_TO_MODE: Record<string, CardMode> = {
  flip: CardMode.Flip,
  type: CardMode.Type,
  cloze: CardMode.Cloze,
  listen: CardMode.Listen,
  fix: CardMode.Fix,
  persian: CardMode.Persian,
};

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function checkboxValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  protected readonly store = inject(StoreService);
  private readonly backup = inject(BackupService);
  private readonly files = inject(FilesService);
  private readonly speech = inject(SpeechService);

  protected readonly ThemePreference = ThemePreference;
  protected readonly PersianDisplay = PersianDisplay;
  protected readonly languageOptions = SECOND_LANGUAGE_OPTIONS;

  protected readonly lastBackup = signal<LastBackupInfo | undefined>(undefined);
  protected readonly backupMessage = signal('');
  protected readonly voices = signal<SpeechSynthesisVoice[]>([]);
  protected readonly reminderMessage = signal('');

  protected readonly reminderHours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly reminderMinutes = [0, 15, 30, 45];

  constructor() {
    void this.refreshLastBackup();
    this.loadVoices();
  }

  private loadVoices(): void {
    const update = () => this.voices.set(this.speech.getEnglishVoices());
    update();
    if (this.speech.ttsSupported) {
      window.speechSynthesis.onvoiceschanged = update;
    }
  }

  private async refreshLastBackup(): Promise<void> {
    this.lastBackup.set(await this.backup.getLastBackup());
  }

  async updateNewPerDay(event: Event): Promise<void> {
    const value = inputValue(event);
    await this.store.saveSettings({ newCardsPerDay: Math.max(0, parseInt(value, 10) || 0) });
  }

  async updateReviewsPerDay(event: Event): Promise<void> {
    const value = inputValue(event);
    await this.store.saveSettings({ reviewsPerDay: Math.max(0, parseInt(value, 10) || 0) });
  }

  async updateDailyGoal(event: Event): Promise<void> {
    const value = inputValue(event);
    await this.store.saveSettings({ dailyGoal: Math.max(1, parseInt(value, 10) || 1) });
  }

  async updateRetention(event: Event): Promise<void> {
    const n = parseFloat(inputValue(event));
    await this.store.saveSettings({ desiredRetention: Math.min(0.95, Math.max(0.8, n)) });
  }

  async updateTheme(theme: ThemePreference): Promise<void> {
    await this.store.saveSettings({ theme });
  }

  async updatePersianDisplay(value: PersianDisplay): Promise<void> {
    await this.store.saveSettings({ persianDisplay: value });
  }

  async updateSecondLanguageEnabled(event: Event): Promise<void> {
    await this.store.saveSettings({ secondLanguageEnabled: checkboxValue(event) });
  }

  async updateSecondLanguageCode(event: Event): Promise<void> {
    await this.store.saveSettings({ secondLanguageCode: inputValue(event) });
  }

  async updateShowPicture(event: Event): Promise<void> {
    await this.store.saveSettings({ showPictureOnFront: checkboxValue(event) });
  }

  async updateVoice(event: Event): Promise<void> {
    const name = inputValue(event);
    await this.store.saveSettings({ voiceName: name || null });
  }

  async updateRate(event: Event): Promise<void> {
    await this.store.saveSettings({ speechRate: parseFloat(inputValue(event)) });
  }

  async updateAutoPlay(event: Event): Promise<void> {
    await this.store.saveSettings({ autoPlayOnAnswer: checkboxValue(event) });
  }

  async updateReminderHour(event: Event): Promise<void> {
    await this.store.saveSettings({ reminderHour: parseInt(inputValue(event), 10) });
  }

  async updateReminderMinute(event: Event): Promise<void> {
    await this.store.saveSettings({ reminderMinute: parseInt(inputValue(event), 10) });
  }

  async backUpNow(): Promise<void> {
    this.backupMessage.set('');
    const file = await this.backup.buildBackup(this.store.settings());
    const shared = await this.files.shareOrDownload({
      name: backupFileName(),
      mimeType: 'application/json',
      content: JSON.stringify(file, null, 2),
    });
    if (shared) {
      await this.backup.recordBackup(file.cards.length);
      await this.refreshLastBackup();
      this.backupMessage.set(`Backed up ${file.cards.length} cards.`);
    } else {
      this.backupMessage.set('Backup was cancelled.');
    }
  }

  async exportCsv(): Promise<void> {
    const { toCsv } = await import('../../core/csv');
    const rows = this.store.cards().map((c) => ({
      word: c.word,
      definition: c.definition,
      persian: c.persian,
      sentence: c.sentence,
      persianSentence: c.persianSentence,
      deck: c.deck,
      tags: c.tags,
      synonyms: c.synonyms,
      collocations: c.collocations,
      style: c.mode,
      answer: c.answer,
    }));
    const csv = toCsv(rows);
    await this.files.shareOrDownload({
      name: `recallo-cards-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: 'text/csv',
      content: csv,
    });
  }

  async onRestoreFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { parseBackupText } = await import('../../core/backup.service');
    const result = parseBackupText(text);
    if (!result.ok) {
      this.backupMessage.set(result.reason);
      input.value = '';
      return;
    }
    const preview = result.file;
    const confirmed = window.confirm(
      `This file has ${preview.cards.length} cards and ${preview.reviews.length} reviews. Merge into your cards?`,
    );
    if (confirmed) {
      const outcome = await this.backup.restoreMerge(preview);
      await this.store.init();
      this.backupMessage.set(`Merged. You now have ${outcome.ok ? outcome.cardCount : 0} cards.`);
    }
    input.value = '';
  }

  async onImportCsvFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { parseCsv } = await import('../../core/csv');
    const rows = parseCsv(text);

    let imported = 0;
    for (const row of rows) {
      if (!row.word) continue;
      const mode = STYLE_TO_MODE[row.style.trim().toLowerCase()] ?? CardMode.Flip;
      await this.store.addNote({
        deck: row.deck || 'Imported',
        kind: row.tags.length ? defaultCardKindFromTags(row.tags) : CardKind.Word,
        word: row.word,
        phonetic: '',
        definition: row.definition,
        persian: row.persian,
        sentence: row.sentence,
        persianSentence: row.persianSentence,
        note: '',
        synonyms: row.synonyms,
        antonyms: [],
        collocations: row.collocations,
        tags: row.tags,
        image: null,
        imageCredit: null,
        audioUrl: null,
        audioBlob: null,
        modes: [mode],
        answer: row.answer,
      });
      imported++;
    }
    this.backupMessage.set(`Imported ${imported} card${imported === 1 ? '' : 's'} from CSV.`);
    input.value = '';
  }

  async shareReminder(): Promise<void> {
    const settings = this.store.settings();
    const ics = this.files.buildDailyReminderIcs(settings.reminderHour, settings.reminderMinute);
    await this.files.shareOrDownload({
      name: 'recallo-daily-reminder.ics',
      mimeType: 'text/calendar',
      content: ics,
    });
    this.reminderMessage.set('Open the file in Calendar to add the daily reminder.');
  }

  formatLastBackup(): string {
    const info = this.lastBackup();
    if (!info) return 'Never';
    const date = new Date(info.date).toLocaleDateString();
    return `${date} (${info.cardCount} cards)`;
  }
}
