import { Component, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { BackupService, backupFileName } from '../../core/backup.service';
import { FilesService } from '../../core/files.service';
import { StoreService } from '../../core/store.service';

/**
 * Shows a banner once a new published version has finished downloading in
 * the background, with a button to activate and reload it.
 *
 * The Angular service worker only swaps in a new version when the app is
 * told to - a background download alone changes nothing on screen. On an
 * iPhone Home Screen app that's rarely force-quit, that means "open the app"
 * is not enough to pick up an update on its own, so we also re-check
 * whenever the app regains focus (iOS can keep it suspended for days).
 *
 * All data lives in IndexedDB on this device with no cloud sync, so an
 * uninstall/reinstall or a browser clearing site data would lose everything
 * — the banner nudges toward a backup before reloading, just in case.
 */
@Component({
  selector: 'app-update-banner',
  imports: [],
  templateUrl: './update-banner.html',
  styleUrl: './update-banner.css',
})
export class UpdateBanner {
  private readonly swUpdate = inject(SwUpdate);
  private readonly backup = inject(BackupService);
  private readonly files = inject(FilesService);
  private readonly store = inject(StoreService);
  readonly updateReady = signal(false);
  readonly backingUp = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) {
      return;
    }

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => this.updateReady.set(true));

    this.checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkForUpdate();
      }
    });
  }

  /** Backs up before reloading, so updating never risks losing cards. */
  async backUpThenReload(): Promise<void> {
    this.backingUp.set(true);
    try {
      const file = await this.backup.buildBackup(this.store.settings());
      const shared = await this.files.shareOrDownload({
        name: backupFileName(),
        mimeType: 'application/json',
        content: JSON.stringify(file, null, 2),
      });
      if (shared) {
        await this.backup.recordBackup(file.cards.length);
      }
    } finally {
      this.backingUp.set(false);
    }
    await this.reload();
  }

  async reload(): Promise<void> {
    try {
      await this.swUpdate.activateUpdate();
    } catch {
      // Activation failed - a plain reload still picks up the new version
      // on the next fetch, so fall through either way.
    }
    document.location.reload();
  }

  private checkForUpdate(): void {
    this.swUpdate.checkForUpdate().catch(() => {
      // Offline or the update check failed - nothing to show the user, just try again next time.
    });
  }
}
