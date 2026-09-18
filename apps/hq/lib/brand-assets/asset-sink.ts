/**
 * Where normalised brand assets go.
 *
 * Uploading a demo's pack to storage is its own later piece of work, so the
 * collector writes to this seam instead of to Supabase: a storage-backed sink
 * plugs in there, and until then the in-memory sink hands a caller the
 * buffers directly.
 */
export type BrandAsset = {
  /** Path within the demo's pack, e.g. `logo.webp` or `photos/03-1a2b3c4d5e6f.webp`. */
  readonly key: string;
  readonly bytes: Buffer;
  readonly contentType: 'image/webp';
  /** Hex SHA-256 of `bytes`, so a store can address or deduplicate by content. */
  readonly sha256: string;
};

export type BrandAssetSink = {
  put(asset: BrandAsset): Promise<void>;
};

/** A sink that keeps every asset in memory, in the order it was written. */
export function memoryAssetSink(): BrandAssetSink & { readonly assets: BrandAsset[] } {
  const assets: BrandAsset[] = [];
  return {
    assets,
    put: async (asset) => {
      assets.push(asset);
    },
  };
}
