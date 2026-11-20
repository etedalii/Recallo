import { Component, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

/**
 * Shows a banner once a new published version has finished downloading in
 * the background, with a button to activate and reload it.
 *
 * The Angular service worker only swaps in a new version when the app is
 * told to - a background download alone changes nothing on screen. On an
 * iPhone Home Screen app that's rarely force-quit, that means "open the app"
 * is not enough to pick up an update on its own, so we also re-check
 * whenever the app regains focus (iOS can keep it suspended for days).
 */
@Component({
  selector: 'app-update-banner',
  imports: [],
  templateUrl: './update-banner.html',
  styleUrl: './update-banner.css',
})
export class UpdateBanner {
  private readonly swUpdate = inject(SwUpdate);
  readonly updateReady = signal(false);

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
