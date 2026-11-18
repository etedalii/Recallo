# Sample import file

`import-sample.csv` has 3 example cards in the format Recallo's CSV importer
expects:

```
word,definition,persian,sentence,persian_sentence,deck,tags,synonyms,collocations,style
```

- `tags`, `synonyms` and `collocations` are lists, separated by `;` or `|`.
- `style` is one of `flip`, `type`, `cloze`, `listen`, `fix`, `persian` (defaults
  to `flip` if left blank).
- A header row is optional — a file with just `word,definition,sentence` columns
  (no header) also works.
- Tab-separated files work too (e.g. Anki "Notes in Plain Text" exports);
  the delimiter is detected automatically.

## How to import it

1. Run the app (`ng serve`, then open http://localhost:4200/).
2. Go to **Settings → Import cards from a CSV/TSV file**.
3. Pick `import-sample.csv`.

You should see "Imported 3 cards from CSV." and find them under the **Verbs**,
**Phrasal Verbs** and **Idioms** decks on the Home screen.
