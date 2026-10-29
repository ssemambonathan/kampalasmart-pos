/** Minimal RFC 4180 CSV reader/writer used for product import/export and reports. */

/**
 * Neutralise spreadsheet formula prefixes while preserving ordinary negative
 * numbers such as `-1250.00`. Exported values are still untrusted input when
 * opened in Excel/LibreOffice; this removes the common `=`, `+`, `@`, `-expr`
 * and control-character prefixes.
 */
function neutraliseFormula(text: string): string {
  if (/^[=+@\t\r]/.test(text)) return `'${text}`;
  if (text.startsWith('-') && !/^-\d+(\.\d+)?$/.test(text)) return `'${text}`;
  return text;
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = neutraliseFormula(String(value));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Parses a CSV document into rows, supporting quoted cells and CRLF. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i]!;
    if (inQuotes) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

export function csvToObjects(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input);
  const header = rows.shift();
  if (!header) return [];
  const keys = header.map((key) => key.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.map((row) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      record[key] = row[index] ?? '';
    });
    return record;
  });
}
