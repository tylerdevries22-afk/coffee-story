import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { squareConnectNotice } from './square-connect-notice';

describe('squareConnectNotice', () => {
  it('says nothing on a plain visit', () => {
    assert.equal(squareConnectNotice({}), null);
  });

  it('confirms a connection that really happened', () => {
    const notice = squareConnectNotice({ connected: '1' });
    assert.equal(notice?.failed, false);
    assert.match(notice?.message ?? '', /connected/i);
  });

  it('explains every refusal the callback can redirect with', () => {
    for (const reason of ['several_locations', 'unsupported_currency', 'no_active_location', 'unreachable']) {
      const notice = squareConnectNotice({ square: reason });
      assert.equal(notice?.failed, true, reason);
      assert.ok((notice?.message.length ?? 0) > 20, `${reason} needs a real message`);
    }
  });

  it('never echoes the query parameter back into the page', () => {
    // The reason arrives on a URL anyone can hand an owner.
    const notice = squareConnectNotice({ square: '<img src=x onerror=alert(1)>' });
    assert.equal(notice?.failed, true);
    assert.ok(!notice?.message.includes('<'), 'the message must not carry the parameter');
  });

  it('prefers the failure when both parameters arrive', () => {
    assert.equal(squareConnectNotice({ connected: '1', square: 'unreachable' })?.failed, true);
  });

  it('reports both endings a disconnect can have, and says which job is left', () => {
    const revoked = squareConnectNotice({ disconnect: 'revoked' });
    assert.equal(revoked?.failed, false);
    assert.match(revoked?.message ?? '', /revoked at Square/);

    // The shop IS disconnected here; what is left is a token only the owner
    // can kill, so this must not read as a confirmation.
    const partial = squareConnectNotice({ disconnect: 'local_only' });
    assert.equal(partial?.failed, true);
    assert.match(partial?.message ?? '', /Square dashboard/);

    assert.equal(squareConnectNotice({ disconnect: 'failed' })?.failed, true);
  });

  it('never echoes a disconnect parameter back into the page either', () => {
    const notice = squareConnectNotice({ disconnect: '<img src=x onerror=alert(1)>' });
    assert.equal(notice?.failed, true);
    assert.ok(!notice?.message.includes('<'), 'the message must not carry the parameter');
  });
});
