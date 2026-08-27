/** Matches one navigation destination without treating sibling prefixes as children. */
export function pathMatchesHref(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Returns the most specific matching destination for nested navigation. */
export function bestMatchingHref(pathname: string, hrefs: readonly string[]): string | undefined {
  return hrefs
    .filter((href) => pathMatchesHref(pathname, href))
    .sort((left, right) => right.length - left.length)[0];
}
