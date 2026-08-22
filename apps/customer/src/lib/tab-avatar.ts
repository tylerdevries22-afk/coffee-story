import { useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import avatarProfileDefault from '../../assets/tabs/avatar-profile.png';

/** The tab icon is 28pt; 96px covers the 3x scale with headroom. */
const ICON_PX = 96;
/** Point size the bundled tab assets carry; the crop must declare the same. */
const ICON_PT = 28;

export type TabAvatar = {
  /** The user's circular-cropped photo, or the monogram ring when there is none. */
  source: ImageSourcePropType;
  /**
   * False while a newly chosen photo is still being cropped. The tab bars hold
   * their deferred mount until this is true, so an icon arriving mid-layout
   * cannot trigger the iOS 26 label race (see use-deferred-tab-bar).
   */
  ready: boolean;
  /** True when `source` is the user's photo rather than the monogram ring. */
  isPhoto: boolean;
};

/**
 * The Profile tab's avatar. `UITabBar` icons are plain `UIImage`s — nothing
 * rounds them — so the chosen photo is circle-cropped here with Skia and
 * handed over as a data URL. Anything that fails falls back to the bundled
 * monogram ring rather than a blank tab.
 */
export function useTabAvatar(avatarUrl: string | null): TabAvatar {
  // The crop result is keyed by the URL it came from, so a newly chosen photo
  // reads as "not ready" without any setState on the effect's sync path —
  // the React Compiler lint forbids that, and deriving it is simpler anyway.
  const [result, setResult] = useState<{ url: string; dataUrl: string | null } | null>(null);

  useEffect(() => {
    if (!avatarUrl) return;
    let cancelled = false;
    void circleCrop(avatarUrl)
      .then((dataUrl) => {
        if (!cancelled) setResult({ url: avatarUrl, dataUrl });
      })
      .catch(() => {
        if (!cancelled) setResult({ url: avatarUrl, dataUrl: null });
      });
    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

  const isPhoto = Boolean(avatarUrl && result?.url === avatarUrl && result.dataUrl);
  return {
    // width/height/scale travel with the source: a bare data URL decodes as
    // 1x, and the tab bar would render the crop at 96pt instead of 28pt.
    source: isPhoto && result?.dataUrl
      ? { uri: result.dataUrl, width: ICON_PT, height: ICON_PT, scale: ICON_PX / ICON_PT }
      : avatarProfileDefault,
    ready: !avatarUrl || result?.url === avatarUrl,
    isPhoto,
  };
}

async function circleCrop(uri: string): Promise<string | null> {
  const { Skia, ClipOp, ImageFormat } = await import('@shopify/react-native-skia');
  const data = await avatarBytes(uri);
  if (!data) return null;
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) return null;

  const surface = Skia.Surface.MakeOffscreen(ICON_PX, ICON_PX);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));

  const clip = Skia.Path.Make();
  clip.addCircle(ICON_PX / 2, ICON_PX / 2, ICON_PX / 2);
  canvas.clipPath(clip, ClipOp.Intersect, true);

  // cover-fit, the same crop ProfileAvatar's contentFit="cover" produces
  const sourceWidth = image.width();
  const sourceHeight = image.height();
  const scale = Math.max(ICON_PX / sourceWidth, ICON_PX / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  canvas.drawImageRect(
    image,
    { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    { x: (ICON_PX - width) / 2, y: (ICON_PX - height) / 2, width, height },
    Skia.Paint(),
  );

  const snapshot = surface.makeImageSnapshot();
  return `data:image/png;base64,${snapshot.encodeToBase64(ImageFormat.PNG)}`;
}

type SkDataModule = Awaited<typeof import('@shopify/react-native-skia')>['Skia']['Data'];
type SkData = ReturnType<SkDataModule['fromBytes']>;

async function avatarBytes(uri: string): Promise<SkData | null> {
  const { Skia } = await import('@shopify/react-native-skia');
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    return comma > 0 ? Skia.Data.fromBase64(uri.slice(comma + 1)) : null;
  }
  if (uri.startsWith('file://') || uri.startsWith('/')) {
    // The demo avatar is copied into the document directory as a file:// URI.
    // expo-file-system's File API moved between the two SDKs this source tree
    // compiles against, so the read is probed rather than named statically —
    // the same pattern portal-store uses for the moveSync rename.
    const { File } = await import('expo-file-system');
    const file = new File(uri);
    const read = (file as Partial<{ arrayBuffer(): Promise<ArrayBuffer> }>).arrayBuffer;
    if (typeof read !== 'function') return null;
    const buffer = await read.call(file);
    return Skia.Data.fromBytes(new Uint8Array(buffer));
  }
  return Skia.Data.fromURI(uri);
}
