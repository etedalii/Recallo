import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BottomNav } from './shared/bottom-nav/bottom-nav';
import { InstallHint } from './shared/install-hint/install-hint';
import { StoreService } from './core/store.service';
import { ThemePreference } from './core/models';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BottomNav, InstallHint],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly store = inject(StoreService);

  constructor() {
    void this.store.init();
    void requestPersistentStorage();

    effect(() => {
      applyTheme(this.store.settings().theme);
    });
  }
}

function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === ThemePreference.Light) {
    root.setAttribute('data-theme', 'light');
  } else if (theme === ThemePreference.Dark) {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

/** Asks the browser not to evict our IndexedDB data under storage pressure. */
async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not supported or denied: the app still works, just without the guarantee.
  }
}
