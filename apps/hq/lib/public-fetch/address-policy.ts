import { BlockList, isIP } from 'node:net';

/**
 * Which addresses HQ may open a connection to on a stranger's say-so.
 *
 * A prospect's website URL comes from a Google listing or a wizard field, so
 * whoever controls that DNS name controls where this server connects. Every
 * answer outside the public internet is refused: loopback, private and
 * carrier NAT ranges, link-local (which holds the cloud metadata service),
 * documentation and benchmarking blocks, multicast, and everything reserved.
 *
 * IPv4 is a blocklist because its special-purpose registry is finite and
 * settled. IPv6 is an allowlist -- global unicast `2000::/3` minus the IANA
 * special-purpose blocks inside it -- because the address space is too large
 * for a blocklist to ever be finished. The previous string-matching check let
 * through multicast, NAT64, 6to4, Teredo and documentation space, and any
 * spelling of an IPv4-mapped address other than the compressed one.
 * `BlockList` compares parsed addresses, so the spelling no longer matters.
 */
type Range = readonly [network: string, prefix: number];

/** IANA IPv4 special-purpose ranges that are not globally reachable. */
export const IPV4_NON_PUBLIC: readonly Range[] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT shared space
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud instance metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // deprecated 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including limited broadcast
];

/** The only IPv6 space that is assigned for public unicast at all. */
export const IPV6_GLOBAL_UNICAST: Range = ['2000::', 3];

/**
 * Special-purpose blocks that sit inside global unicast.
 *
 * Teredo (inside `2001::/23`) and 6to4 both carry an IPv4 address in their
 * bits and are delivered by relays, so either can be a route back to a
 * private IPv4 host. NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`), IPv4-mapped
 * addresses, unique-local, link-local and multicast all fall outside
 * `2000::/3` and are refused by the allowlist without being named.
 */
export const IPV6_NON_PUBLIC_WITHIN_GLOBAL: readonly Range[] = [
  ['2001::', 23], // IETF protocol assignments, including Teredo 2001::/32
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation (RFC 9637)
];

function blockList(ranges: readonly Range[], family: 'ipv4' | 'ipv6'): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of ranges) list.addSubnet(network, prefix, family);
  return list;
}

const IPV4_DENIED = blockList(IPV4_NON_PUBLIC, 'ipv4');
const IPV6_ALLOWED = blockList([IPV6_GLOBAL_UNICAST], 'ipv6');
const IPV6_DENIED = blockList(IPV6_NON_PUBLIC_WITHIN_GLOBAL, 'ipv6');

/** True only for an address on the public internet, in any textual spelling. */
export function isPublicIpAddress(address: string): boolean {
  // A zone index only means something on a link-local scope.
  if (address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !IPV4_DENIED.check(address, 'ipv4');
  if (family === 6) return IPV6_ALLOWED.check(address, 'ipv6') && !IPV6_DENIED.check(address, 'ipv6');
  return false;
}
