import assert from 'node:assert/strict';
import test from 'node:test';

import { IPV4_NON_PUBLIC, isPublicIpAddress } from './address-policy';

function toInteger(address: string): number {
  return address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);
}

function toAddress(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

function rangeOf([network, prefix]: readonly [string, number]): readonly [number, number] {
  const first = toInteger(network);
  return [first, first + 2 ** (32 - prefix) - 1];
}

const RANGES = IPV4_NON_PUBLIC.map(rangeOf);
const insideAny = (value: number): boolean => RANGES.some(([first, last]) => value >= first && value <= last);

test('every IPv4 special-purpose range is refused from its first address to its last', () => {
  for (const [first, last] of RANGES) {
    assert.equal(isPublicIpAddress(toAddress(first)), false, toAddress(first));
    assert.equal(isPublicIpAddress(toAddress(last)), false, toAddress(last));
  }
});

test('the address on either side of each range is public unless another range claims it', () => {
  for (const [first, last] of RANGES) {
    for (const neighbour of [first - 1, last + 1]) {
      if (neighbour < 0 || neighbour > 2 ** 32 - 1) continue;
      assert.equal(isPublicIpAddress(toAddress(neighbour)), !insideAny(neighbour), toAddress(neighbour));
    }
  }
});

test('the IPv4 gaps the old check missed are closed, and ordinary hosts stay open', () => {
  const refused = [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '198.51.100.7', '203.0.113.9', '192.0.2.1', '192.88.99.1', '0.0.0.0', '255.255.255.255', '224.0.0.251',
  ];
  for (const address of refused) assert.equal(isPublicIpAddress(address), false, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '151.101.1.69', '223.255.255.255']) {
    assert.equal(isPublicIpAddress(address), true, address);
  }
});

test('IPv6 outside global unicast, or in a special block inside it, is refused in any spelling', () => {
  const refused = [
    '::', '::1',
    // IPv4-mapped, compressed and not, even when the IPv4 half is public.
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:0808:0808', '::ffff:8.8.8.8',
    '::8.8.8.8',
    '64:ff9b::a00:1', '64:ff9b::8.8.8.8', '64:ff9b:1::1',
    '100::1',
    '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:db8::1', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
    '2002::1', '2002:c0a8:101::1',
    '3fff::1', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
    'fc00::1', 'fd12:3456:789a::1',
    'fe80::1', 'febf::1', 'fe80::1%eth0',
    'ff00::1', 'ff02::1', 'ff0e::1',
    '1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '4000::1',
  ];
  for (const address of refused) assert.equal(isPublicIpAddress(address), false, address);
});

test('global unicast IPv6 is public however it is written', () => {
  const allowed = [
    '2606:4700:4700::1111', '2606:4700:4700:0000:0000:0000:0000:1111', '2606:4700:4700::ABCD',
    '2a00:1450:4001:82a::200e', '2001:200::1', '2001:db7:ffff::1', '2001:db9::1', '2003::1', '3fff:1000::1',
  ];
  for (const address of allowed) assert.equal(isPublicIpAddress(address), true, address);
});

test('anything that is not an address literal is not public', () => {
  for (const value of ['', 'example.com', '1.2.3', '256.1.1.1', ' 8.8.8.8', '::g', '[::1]', '0x7f.0.0.1']) {
    assert.equal(isPublicIpAddress(value), false, JSON.stringify(value));
  }
});
