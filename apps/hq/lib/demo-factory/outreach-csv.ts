/**
 * Drafts as a CSV file an operator imports into their own sending tool.
 *
 * RFC 4180: every field quoted, quotes doubled, CRLF between records, so a
 * body's line breaks stay inside its cell. The business name and the subject
 * come from a scraped website, and a file like this is opened in a
 * spreadsheet as often as it is imported, so a cell that a spreadsheet would
 * run as a formula (one starting `=`, `+`, `-`, `@`, a tab or a return) is
 * prefixed with an apostrophe, which every spreadsheet reads as "this is text".
 */
import type { OutreachDraft } from './outreach-draft';

export const OUTREACH_CSV_HEADER = [
  'email', 'business_name', 'subject', 'body', 'demo_link', 'expires_on', 'from_name',
] as const;

function cell(value: string): string {
  const inert = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${inert.replaceAll('"', '""')}"`;
}

export function outreachCsv(drafts: readonly OutreachDraft[], fromName: string): string {
  const records: readonly (readonly string[])[] = [
    OUTREACH_CSV_HEADER,
    ...drafts.map((draft) => [
      draft.to, draft.businessName, draft.subject, draft.text, draft.link, draft.expiresOn, fromName,
    ]),
  ];
  return `${records.map((record) => record.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** `demo-outreach-2026-09-18.csv`: the day is the only variable part, so the name is always safe. */
export function outreachFileName(day: string): string {
  return `demo-outreach-${day}.csv`;
}
