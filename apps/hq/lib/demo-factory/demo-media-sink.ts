/**
 * Where a demo's images go: the private demo-media bucket, under the demo's
 * own id, which is where the media route serves them from and where removal
 * and expiry delete them. A name that route would refuse is refused here
 * too, so nothing is stored that could never be shown or would be missed
 * when the demo goes.
 */
import type { BrandAsset, BrandAssetSink } from '../brand-assets/asset-sink';
import { DEMO_MEDIA_NAME } from '../demo-pack';
import { DEMO_MEDIA_BUCKET, type DemoDb } from '../demo-site';

export type DemoMediaSink = BrandAssetSink & {
  /** What was stored, by media name, in the order it was written. */
  readonly stored: readonly string[];
};

export function demoMediaSink(db: Pick<DemoDb, 'storage'>, siteId: string): DemoMediaSink {
  const stored: string[] = [];
  return {
    stored,
    put: async (asset: BrandAsset) => {
      if (!DEMO_MEDIA_NAME.test(asset.key)) throw new Error('A demo image name the media route would refuse.');
      const { error } = await db.storage.from(DEMO_MEDIA_BUCKET)
        .upload(`${siteId}/${asset.key}`, asset.bytes, { contentType: asset.contentType, upsert: true });
      if (error) throw error;
      stored.push(asset.key);
    },
  };
}
