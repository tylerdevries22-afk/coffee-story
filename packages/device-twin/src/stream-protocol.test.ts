import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseDeviceStreamSignal } from './stream-protocol';

const SESSION = '123e4567-e89b-42d3-a456-426614174000';

describe('device stream signaling', () => {
  it('accepts bounded session-scoped offers', () => {
    assert.deepEqual(parseDeviceStreamSignal({
      sessionId: SESSION, kind: 'offer', description: { type: 'offer', sdp: 'v=0' },
    }), {
      sessionId: SESSION, kind: 'offer', description: { type: 'offer', sdp: 'v=0' },
    });
  });
  it('rejects malformed or oversized candidates', () => {
    assert.equal(parseDeviceStreamSignal({ sessionId: SESSION, kind: 'candidate', candidate: {} }), null);
    assert.equal(parseDeviceStreamSignal({
      sessionId: SESSION, kind: 'candidate', candidate: { candidate: 'x'.repeat(4097) },
    }), null);
  });
  it('rejects mismatched descriptions and unbounded SDP', () => {
    assert.equal(parseDeviceStreamSignal({
      sessionId: SESSION, kind: 'offer', description: { type: 'answer', sdp: 'v=0' },
    }), null);
    assert.equal(parseDeviceStreamSignal({
      sessionId: SESSION, kind: 'answer', description: { type: 'answer', sdp: 'x'.repeat(100_001) },
    }), null);
  });
});
