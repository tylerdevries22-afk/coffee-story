import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { resolvePlace, suggestPlaces } from './place-lookup';

const TOKEN = 'bbbbbbbb-0000-4000-8000-000000000001';
const originalFetch = globalThis.fetch;
let sent: { url: string; init: RequestInit | undefined }[] = [];

function answer(respond: () => Response | Promise<Response>): void {
  sent = [];
  globalThis.fetch = async (input, init) => {
    sent.push({ url: String(input), init });
    return respond();
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const signal = () => new AbortController().signal;

describe('asking the proxy for suggestions', () => {
  it('posts the query and session to the console’s own route', async () => {
    answer(() => Response.json({ predictions: [{ placeId: 'ChIJHarborRoast0001', mainText: 'Harbor Roast', secondaryText: null }] }));
    const result = await suggestPlaces('harbor', TOKEN, signal());
    assert.deepEqual(result, { ok: true, value: [{ placeId: 'ChIJHarborRoast0001', mainText: 'Harbor Roast', secondaryText: null }] });
    assert.equal(sent[0]?.url, '/api/places/autocomplete');
    assert.equal(sent[0]?.init?.method, 'POST');
    assert.equal(sent[0]?.init?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(sent[0]?.init?.body)), { input: 'harbor', sessionToken: TOKEN });
  });

  it('skips a malformed suggestion rather than failing the list', async () => {
    answer(() => Response.json({ predictions: [{ placeId: 7 }, { placeId: 'ChIJHarborRoast0002', mainText: 'Annex' }] }));
    assert.deepEqual(await suggestPlaces('harbor', TOKEN, signal()), {
      ok: true, value: [{ placeId: 'ChIJHarborRoast0002', mainText: 'Annex', secondaryText: null }],
    });
  });

  it('reads a 503 as Places not being set up, and anything else as this one failing', async () => {
    const body = (message: string) => ({ error: { code: 'x', message } });
    answer(() => Response.json(body('Enter the business details by hand.'), { status: 503 }));
    assert.deepEqual(await suggestPlaces('harbor', TOKEN, signal()), {
      ok: false, reason: 'unavailable', message: 'Enter the business details by hand.',
    });
    answer(() => Response.json(body('Too many searches.'), { status: 429 }));
    assert.deepEqual(await suggestPlaces('harbor', TOKEN, signal()), {
      ok: false, reason: 'error', message: 'Too many searches.',
    });
    answer(() => new Response('<html>', { status: 502 }));
    const unreadable = await suggestPlaces('harbor', TOKEN, signal());
    assert.equal(unreadable.ok, false);
    assert.equal(unreadable.ok ? '' : unreadable.reason, 'error');
  });

  it('reports a network failure as a message, but rethrows an abandoned lookup', async () => {
    answer(() => Promise.reject(new TypeError('fetch failed')));
    const offline = await suggestPlaces('harbor', TOKEN, signal());
    assert.equal(offline.ok, false);
    const controller = new AbortController();
    controller.abort();
    answer(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await assert.rejects(suggestPlaces('harbor', TOKEN, controller.signal));
  });
});

describe('resolving a pick', () => {
  it('posts the pick with the search’s session and returns the draft', async () => {
    const place = {
      googlePlaceId: 'ChIJHarborRoast0001', name: 'Harbor Roast',
      industry: { key: 'coffee-shop', confidence: 'high', reason: 'x' }, warnings: [],
    };
    answer(() => Response.json({ place }));
    const result = await resolvePlace('ChIJHarborRoast0001', TOKEN, signal());
    assert.ok(result.ok);
    assert.equal(result.value.name, 'Harbor Roast');
    assert.equal(sent[0]?.url, '/api/places/details');
    assert.deepEqual(JSON.parse(String(sent[0]?.init?.body)), { placeId: 'ChIJHarborRoast0001', sessionToken: TOKEN });
  });

  it('refuses an answer the wizard could not act on', async () => {
    answer(() => Response.json({ place: { name: 'Harbor Roast' } }));
    const result = await resolvePlace('ChIJHarborRoast0001', TOKEN, signal());
    assert.equal(result.ok, false);
  });
});
