import { readFile } from 'node:fs/promises';

import { demoMenuImagePaths } from '@/lib/demo-menu-media';
import { demoMediaAvailable } from '@/lib/demo-sync-http';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!demoMediaAvailable(request)) return new Response('Not found', { status: 404 });
  const { slug } = await context.params;
  if (!SLUG.test(slug)) return new Response('Not found', { status: 404 });
  for (const path of demoMenuImagePaths(process.cwd(), slug)) {
    try {
      const image = await readFile(path);
      return new Response(image, {
        headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=3600' },
      });
    } catch {
      // The preview may run from the workspace root or the app directory.
    }
  }
  return new Response('Not found', { status: 404 });
}
