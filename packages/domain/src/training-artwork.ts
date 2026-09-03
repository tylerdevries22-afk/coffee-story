import { isCoreTrainingTrack, type TrainingManifest, type TrainingTrackKey } from './training';

export type TrainingArtworkUrls = Readonly<Record<TrainingTrackKey, string>>;

const TRACK_PATHS: Record<TrainingTrackKey, string> = {
  knowledge: '<path d="M20 23c7-4 15-4 22 0v25c-7-4-15-4-22 0V23Zm22 0c7-4 15-4 22 0v25c-7-4-15-4-22 0V23ZM42 23v25"/>',
  skills: '<path d="M27 22a12 12 0 0 0 15 15L61 56l9-9-19-19a12 12 0 0 0-15-15l8 8-9 9-8-8Z"/><path d="m23 65 18-18"/>',
  service: '<path d="M42 65S18 52 18 33c0-14 18-19 24-7 6-12 24-7 24 7 0 19-24 32-24 32Z"/><path d="M31 39h22"/>',
  safety: '<path d="M42 13 66 22v18c0 15-10 26-24 32-14-6-24-17-24-32V22l24-9Z"/><path d="m30 42 8 8 17-19"/>',
  operations: '<path d="M27 20h30a7 7 0 0 1 7 7v40H20V27a7 7 0 0 1 7-7Z"/><path d="M34 20v-7h16v7M31 38h22M31 50h16"/>',
};

/** Generates deterministic, tenant-neutral track art suitable for immutable Storage keys. */
export function trainingTrackArtworkSvg(trackKey: TrainingTrackKey): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84" viewBox="0 0 84 84"><rect width="84" height="84" rx="18" fill="#f1e7dc"/><circle cx="42" cy="42" r="34" fill="#fbf8f4" stroke="#d8c3ad"/><g fill="none" stroke="#4f382c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${TRACK_PATHS[trackKey]}</g></svg>`;
}

/** Applies resolved public artwork URLs without mutating an immutable release contract. */
export function withTrainingArtwork(
  manifest: TrainingManifest,
  urls: TrainingArtworkUrls,
): TrainingManifest {
  return {
    ...manifest,
    tracks: manifest.tracks.map((track) => (isCoreTrainingTrack(track.slug)
      ? { ...track, icon: { ...track.icon, url: urls[track.slug] } }
      : track)),
  };
}
