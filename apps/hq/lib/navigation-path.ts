/** Matches one navigation destination without treating sibling prefixes as children. */
export function pathMatchesHref(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
