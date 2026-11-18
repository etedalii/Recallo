# Recallo

A free, ad-free, offline-first flashcard app for learning English. It's built for one
person, runs entirely in the browser, and works as an iPhone Home Screen app (PWA).
There is no backend, no account, and no tracking — everything you add is stored on
your device, in IndexedDB.

Recallo uses [FSRS-5](https://github.com/open-spaced-repetition/fsrs4anki) spaced
repetition to schedule reviews, and can look up dictionary definitions, collocations,
synonyms, Persian translations and free pictures for you while you add a card (all
optional — you can always type everything by hand).

## 1. Running it locally

1. Install [Node.js](https://nodejs.org/) (a recent LTS version) if you don't have it.
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   ng serve
   ```
4. Open `http://localhost:4200/` in your browser.

## 2. Running the tests and a production build

```bash
ng test    # unit tests for the scheduler, CSV import/export, text diffing, backup logic…
ng build   # production build, output in dist/recallo/browser
```

`ng build` must finish with no errors. TypeScript strict mode is on throughout.

## 3. Publishing to GitHub Pages

1. Build with the repository name as the base href (replace `<repo-name>`):
   ```bash
   ng build --base-href /<repo-name>/
   ```
2. Publish the contents of `dist/recallo/browser` to GitHub Pages (for example, with the
   `gh-pages` branch, or any static host that serves `index.html` for unknown paths —
   Recallo uses hash-based routing, so plain static hosting works fine and page
   refreshes won't 404).
3. Visit `https://<your-username>.github.io/<repo-name>/`.

## 4. Adding it to your iPhone Home Screen

1. Open the published site in **Safari** on your iPhone (it must be Safari, not Chrome).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Tap **Add to Home Screen**, then **Add**.
4. Open Recallo from the Home Screen icon from now on — it launches full-screen, like a
   native app, and works offline after the first visit.

### About your data

- An app added to the Home Screen gets a more durable storage area than a regular
  Safari tab. Recallo also asks the browser for persistent storage on startup.
- Regular Safari tabs (not added to the Home Screen) can have their site data cleared
  by iOS after a long period of inactivity, which would lose your cards.
- Because of this — **and because there is no cloud sync** — use **Settings → Back up
  now** every so often to export a JSON backup. Recallo will also remind you with a
  banner on the Home screen if you have 5+ cards and haven't backed up in the last 7
  days.
- To move your cards to a new phone or browser, back up on the old device and use
  **Settings → Restore from a backup file** on the new one.
- Real multi-device sync would need a small backend server; this app intentionally
  has none, to stay free, private and simple. The JSON backup/restore flow is the
  supported way to move data around in the meantime.

## What it's built with

- Angular (standalone components, signals, `@if`/`@for` control flow, lazy-loaded
  routes, hash-based routing), TypeScript, strict mode, no `any`.
- `@angular/pwa` (service worker + Web App Manifest) for offline support and
  installability.
- `idb` as the only runtime dependency, for a friendlier IndexedDB API. No UI
  framework — all styling is plain CSS.
- Free lookup APIs used only when you tap a "look up" / "find" button: dictionaryapi.dev
  (definitions), Datamuse (collocations), MyMemory (Persian translation), and
  Wikipedia / Wikimedia Commons / Openverse (pictures). None of these are cached by
  the service worker, so lookups always hit the live internet, while the rest of the
  app works offline.

See `../PROMPT.md` for the full original specification this app was built from.
