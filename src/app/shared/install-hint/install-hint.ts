import { Component, signal } from '@angular/core';

const DISMISSED_KEY = 'recallo-install-hint-dismissed';

type Platform = 'ios' | 'android' | null;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Component({
  selector: 'app-install-hint',
  imports: [],
  templateUrl: './install-hint.html',
  styleUrl: './install-hint.css',
})
export class InstallHint {
  readonly visible = signal(false);
  readonly platform = signal<Platform>(null);
  readonly canNativeInstall = signal(false);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    if (this.isAlreadyDismissed() || this.isRunningStandalone()) {
      return;
    }

    const platform = this.detectMobilePlatform();
    if (!platform) {
      return;
    }

    this.platform.set(platform);
    this.visible.set(true);

    if (platform === 'android') {
      window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        this.deferredPrompt = event as BeforeInstallPromptEvent;
        this.canNativeInstall.set(true);
      });
    }
  }

  async install(): Promise<void> {
    if (!this.deferredPrompt) {
      return;
    }
    await this.deferredPrompt.prompt();
    await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.dismiss();
  }

  dismiss(): void {
    this.visible.set(false);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private browsing or storage disabled: nothing to persist, hint just won't recur reliably.
    }
  }

  private isAlreadyDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  private isRunningStandalone(): boolean {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const standaloneMedia = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
    return standaloneMedia || nav.standalone === true;
  }

  private detectMobilePlatform(): Platform {
    const ua = window.navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return 'ios';
    }
    if (/Android/i.test(ua)) {
      return 'android';
    }
    return null;
  }
}
