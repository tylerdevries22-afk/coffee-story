/** CSV building for the analytics export. RFC 4180 quoting; pure. */

export function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
