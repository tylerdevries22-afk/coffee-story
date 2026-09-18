import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { oneLine, outreachDraft, outreachEmail, outreachSkip, type OutreachSite } from './outreach-draft';

const NOW = new Date('2026-09-18T12:00:00.000Z');
const SENDER = { name: 'Northside Studio', postalAddress: '100 Market Street, Suite 4, Boulder, CO 80302' };
const LINK = 'https://hq.example.com/d/abc123';

function site(overrides: Partial<OutreachSite> = {}): OutreachSite {
  return {
    id: '5f0c6a4e-0000-4000-8000-000000000001',
    businessName: 'Harbor Roast',
    email: 'hello@harborroast.example',
    countryCode: 'US',
    state: 'ready',
    expiresAt: '2026-10-02T12:00:00.000Z',
    createdAt: '2026-09-18T09:00:00.000Z',
    menuFromWebsite: true,
    ...overrides,
  };
}

function draftOf(input: OutreachSite) {
  const decision = outreachDraft(input, SENDER, LINK, NOW);
  assert.ok(decision.ok, 'expected a draft');
  return decision.draft;
}

describe('outreachDraft', () => {
  it('writes the email a US business that publishes an address gets', () => {
    const draft = draftOf(site());
    assert.equal(draft.to, 'hello@harborroast.example');
    assert.equal(draft.subject, 'A working ordering-app demo for Harbor Roast');
    assert.equal(draft.link, LINK);
    assert.equal(draft.expiresOn, 'October 2, 2026');
    const lines = draft.text.split('\n');
    assert.equal(lines[0], 'Hello Harbor Roast team,');
    assert.equal(lines.filter((line) => line === LINK).length, 1, 'the link sits on a line of its own');
    assert.match(draft.text, /from your public Google listing and your own website:/);
    assert.match(draft.text, /your hours and your menu/);
    assert.match(draft.text, /deletes itself on October 2, 2026\./);
  });

  it('carries what CAN-SPAM asks of the message: an opt-out, a postal address, and the word advertisement', () => {
    const lines = draftOf(site()).text.split('\n');
    assert.ok(lines.some((line) => /replying "unsubscribe" means you will not hear from us again/.test(line)));
    assert.ok(lines.includes(SENDER.postalAddress));
    assert.equal(lines.at(-1), 'This email is an advertisement from Northside Studio.');
  });

  it('calls a sample menu a sample, and never claims a website it did not read', () => {
    const draft = draftOf(site({ menuFromWebsite: false }));
    assert.match(draft.text, /a sample menu standing in for yours/);
    assert.match(draft.text, /from your public Google listing:/);
    assert.doesNotMatch(draft.text, /website/);
  });

  it('keeps a scraped name on one line, so it cannot break the subject', () => {
    const draft = draftOf(site({ businessName: '  Harbor\nRoast\u0000  Bar\u2028 ' }));
    assert.equal(draft.businessName, 'Harbor Roast Bar');
    assert.equal(draft.subject, 'A working ordering-app demo for Harbor Roast Bar');
  });

  it('writes to the address in lower case', () => {
    assert.equal(draftOf(site({ email: ' Hello@HarborRoast.Example ' })).to, 'hello@harborroast.example');
  });
});

describe('outreachSkip', () => {
  it('names why a demo gets no draft', () => {
    const cases: [Partial<OutreachSite>, string][] = [
      [{ state: 'building' }, 'not_ready'],
      [{ state: 'removed' }, 'not_ready'],
      [{ countryCode: 'CA' }, 'outside_us'],
      [{ countryCode: null }, 'outside_us'],
      [{ email: null }, 'no_email'],
      [{ email: 'not an address' }, 'no_email'],
      [{ expiresAt: '2026-09-20T11:59:59.000Z' }, 'expiring'],
      [{ expiresAt: 'soon' }, 'expiring'],
    ];
    for (const [overrides, reason] of cases) {
      assert.equal(outreachSkip(site(overrides), NOW), reason, JSON.stringify(overrides));
      const decision = outreachDraft(site(overrides), SENDER, LINK, NOW);
      assert.deepEqual(decision, { ok: false, reason });
    }
  });

  it('lets a link with exactly two days left through', () => {
    assert.equal(outreachSkip(site({ expiresAt: '2026-09-20T12:00:00.000Z' }), NOW), null);
  });
});

describe('outreachEmail', () => {
  it('accepts a plain address and refuses anything a scraper got wrong', () => {
    assert.equal(outreachEmail('orders@cafe.example.com'), 'orders@cafe.example.com');
    for (const value of ['', 'hello', 'hello@', '@cafe.com', 'hello@cafe', 'a b@cafe.com', '-x@cafe.com', null, undefined]) {
      assert.equal(outreachEmail(value), null, String(value));
    }
    assert.equal(outreachEmail(`${'a'.repeat(250)}@cafe.com`), null, 'longer than an address can be');
  });
});

describe('oneLine', () => {
  it('flattens line breaks and control characters and bounds the length', () => {
    assert.equal(oneLine('a\r\nb\tc', 10), 'a b c');
    assert.equal(oneLine('abcdef', 3), 'abc');
    assert.equal(oneLine(undefined, 5), '');
  });
});
