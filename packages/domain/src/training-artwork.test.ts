import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cafeTrainingManifest } from './training-baseline';
import {
  trainingTrackArtworkSvg,
  withTrainingArtwork,
  type TrainingArtworkUrls,
} from './training-artwork';
import { TRAINING_TRACK_ORDER } from './training';

describe('trainingTrackArtworkSvg', () => {
  it('produces deterministic semantic SVG art for all five core tracks', () => {
    const art = TRAINING_TRACK_ORDER.map(trainingTrackArtworkSvg);

    assert.equal(new Set(art).size, 5);
    for (const svg of art) {
      assert.match(svg, /^<svg[^>]+>/);
      assert.match(svg, /viewBox="0 0 84 84"/);
      assert.equal(svg.includes('<script'), false);
    }
  });
});

describe('withTrainingArtwork', () => {
  it('adds one URL to every core track and leaves a tenant track unchanged', () => {
    const manifest = cafeTrainingManifest({ businessName: 'Coffee Story', industry: 'Coffee', locale: 'en-US' });
    manifest.tracks.push({ slug: 'local', title: 'Local', summary: '', icon: { symbol: 'pin', prompt: 'pin' }, lessons: [] });
    const urls = Object.fromEntries(TRAINING_TRACK_ORDER.map((track) => [track, `https://media.example/${track}.webp`])) as TrainingArtworkUrls;
    const result = withTrainingArtwork(manifest, urls);

    assert.deepEqual(result.tracks.slice(0, 5).map((track) => track.icon.url), Object.values(urls));
    assert.equal(result.tracks[5]?.icon.url, undefined);
    assert.equal(manifest.tracks[0]?.icon.url, undefined);
  });
});
