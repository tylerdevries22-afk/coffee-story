import type * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function avatarExtension(mimeType: string | null | undefined): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

async function webDemoAvatarDataUrl(sourceUri: string): Promise<string> {
  const image = new window.Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The selected photo could not be read.'));
    image.src = sourceUri;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The selected photo could not be processed.');
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  if (sourceSize <= 0) throw new Error('The selected photo has no readable dimensions.');
  context.drawImage(
    image,
    (image.naturalWidth - sourceSize) / 2,
    (image.naturalHeight - sourceSize) / 2,
    sourceSize,
    sourceSize,
    0,
    0,
    512,
    512,
  );
  return canvas.toDataURL('image/jpeg', 0.82);
}

export async function durableDemoAvatarUri(
  asset: ImagePicker.ImagePickerAsset,
  previousAvatarUrl: string | null,
): Promise<string> {
  if (Platform.OS === 'web') return webDemoAvatarDataUrl(asset.uri);
  const { File, Paths } = await import('expo-file-system');
  const extension = avatarExtension(asset.mimeType);
  const destination = new File(Paths.document, `demo-profile-avatar-${Date.now()}.${extension}`);
  await new File(asset.uri).copy(destination);
  if (previousAvatarUrl?.startsWith(Paths.document.uri)
    && previousAvatarUrl.includes('demo-profile-avatar')) {
    const previous = new File(previousAvatarUrl);
    if (previous.exists) previous.delete();
  }
  for (const candidateExtension of ['jpg', 'png', 'webp'] as const) {
    const candidate = new File(Paths.document, `demo-profile-avatar.${candidateExtension}`);
    if (candidate.exists) candidate.delete();
  }
  return destination.uri;
}
