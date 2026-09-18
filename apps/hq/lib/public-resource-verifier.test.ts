import assert from 'node:assert/strict';
import test from 'node:test';

import { isPublicIpAddress } from './public-resource-verifier';

test('resource verifier rejects loopback, private, link-local, and mapped addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});

test('resource verifier accepts routable IPv4 and IPv6 addresses', () => {
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('resource verifier shares the crawler policy, so the old IPv6 and TEST-NET gaps are closed here too', () => {
  for (const address of ['ff02::1', '64:ff9b::a00:1', '2002:c0a8:101::1', '2001::1', '2001:db8::1', '198.51.100.1', '203.0.113.1', '0:0:0:0:0:ffff:7f00:1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});
