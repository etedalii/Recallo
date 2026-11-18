// CSV/TSV import and export. Pure functions, no Angular imports, so they
// can be unit tested directly.

/** One row of parsed card data, before it becomes a full Card. */
export interface ImportedRow {
  word: string;
  definition: string;
  persian: string;
  sentence: string;
  persianSentence: string;
  deck: string;
  tags: string[];
  synonyms: string[];
  collocations: string[];
  style: string;
  /** Only meaningful for `style: "fix"` rows: the corrected sentence. */
  answer: string;
}

const HEADER_ALIASES: Record<string, keyof ImportedRow> = {
  word: 'word',
  front: 'word',
  definition: 'definition',
  back: 'definition',
  meaning: 'definition',
  persian: 'persian',
  farsi: 'persian',
  sentence: 'sentence',
  example: 'sentence',
  persian_sentence: 'persianSentence',
  persiansentence: 'persianSentence',
  deck: 'deck',
  tags: 'tags',
  synonyms: 'synonyms',
  collocations: 'collocations',
  style: 'style',
  mode: 'style',
  answer: 'answer',
  corrected: 'answer',
  corrected_sentence: 'answer',
};

const KNOWN_HEADER_WORDS = new Set(Object.keys(HEADER_ALIASES));

/** Detects whether the file uses commas or tabs, by majority vote on the first line. */
export function detectDelimiter(text: string): ',' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

/** Parses one CSV/TSV text body (RFC4180-style quoting) into rows of raw strings. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // Last field/row, if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;|]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Guesses whether the first row is a header rather than the first data
 * row. Requires at least two recognised column names (not just one) —
 * a single match is too easy to trigger by coincidence, e.g. a no-header
 * file whose very first vocabulary word happens to be "example" or
 * "style". A single-column file is the one exception, since two matches
 * are impossible there.
 */
function looksLikeHeader(row: string[]): boolean {
  const matches = row.filter((cell) => KNOWN_HEADER_WORDS.has(cell.trim().toLowerCase())).length;
  return row.length === 1 ? matches === 1 : matches >= 2;
}

/** Parses a full CSV/TSV file (auto-detecting delimiter and header) into rows. */
export function parseCsv(text: string): ImportedRow[] {
  const delimiter = detectDelimiter(text);
  const rawRows = parseDelimited(text, delimiter);
  if (rawRows.length === 0) return [];

  let columns: (keyof ImportedRow | null)[];
  let dataRows: string[][];

  if (looksLikeHeader(rawRows[0])) {
    columns = rawRows[0].map((cell) => HEADER_ALIASES[cell.trim().toLowerCase()] ?? null);
    dataRows = rawRows.slice(1);
  } else {
    // No header: assume word, definition, sentence (Anki-style plain export).
    columns = ['word', 'definition', 'sentence'];
    dataRows = rawRows;
  }

  return dataRows
    .filter((r) => r.some((cell) => cell.trim().length > 0))
    .map((cells) => {
      const byField: Partial<Record<keyof ImportedRow, string>> = {};
      columns.forEach((field, index) => {
        if (field) byField[field] = cells[index] ?? '';
      });
      return {
        word: (byField.word ?? '').trim(),
        definition: (byField.definition ?? '').trim(),
        persian: (byField.persian ?? '').trim(),
        sentence: (byField.sentence ?? '').trim(),
        persianSentence: (byField.persianSentence ?? '').trim(),
        deck: (byField.deck ?? '').trim(),
        tags: splitList(byField.tags as string | undefined),
        synonyms: splitList(byField.synonyms as string | undefined),
        collocations: splitList(byField.collocations as string | undefined),
        style: (byField.style ?? '').trim(),
        answer: (byField.answer ?? '').trim(),
      };
    });
}

/** Escapes one field for CSV output, quoting only when needed. */
function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const CSV_EXPORT_HEADER = [
  'word',
  'definition',
  'persian',
  'sentence',
  'persian_sentence',
  'deck',
  'tags',
  'synonyms',
  'collocations',
  'style',
  'answer',
] as const;

export interface ExportableRow {
  word: string;
  definition: string;
  persian: string;
  sentence: string;
  persianSentence: string;
  deck: string;
  tags: string[];
  synonyms: string[];
  collocations: string[];
  style: string;
  /** Only meaningful for `style: "fix"` rows: the corrected sentence. */
  answer: string;
}

/** Builds a CSV text body (with header) from exportable rows. */
export function toCsv(rows: ExportableRow[]): string {
  const lines = [CSV_EXPORT_HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.word,
        row.definition,
        row.persian,
        row.sentence,
        row.persianSentence,
        row.deck,
        row.tags.join('|'),
        row.synonyms.join('|'),
        row.collocations.join('|'),
        row.style,
        row.answer,
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return lines.join('\n');
}
