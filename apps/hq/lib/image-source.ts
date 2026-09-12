/** Only web images, local paths, and browser-created previews may reach an image element. */
export function safeImageSource(value: string | null | undefined): string | null {
  if (!value || value.length > 8192) return null;
  try {
    const parsed = new URL(value, 'https://local.invalid');
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'blob:') return null;
    if (parsed.username || parsed.password) return null;
    return value.startsWith('/') && !value.startsWith('//')
      ? parsed.pathname + parsed.search + parsed.hash : parsed.href;
  } catch {
    return null;
  }
}
