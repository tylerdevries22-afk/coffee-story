import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import type { DeviceFormFactor } from '@platform/device-wall';

const PHONE_WIDTH = 3.2;
const PHONE_HEIGHT = PHONE_WIDTH * (159.9 / 76.7);
const PHONE_DEPTH = PHONE_WIDTH * (8.25 / 76.7);

function materials(finish: 'natural-titanium' | 'graphite') {
  const frame = new THREE.MeshPhysicalMaterial({
    clearcoat: 0.12, color: finish === 'graphite' ? 0x343537 : 0x817b73,
    envMapIntensity: 1.4, metalness: 1, roughness: 0.24,
  });
  const screen = new THREE.MeshBasicMaterial({ color: 0x11151b, toneMapped: false });
  return { frame, screen };
}

function proceduralTwin(formFactor: DeviceFormFactor, finish: 'natural-titanium' | 'graphite') {
  const { frame, screen } = materials(finish);
  const dimensions: readonly [number, number, number] = formFactor === 'phone'
    ? [PHONE_WIDTH, PHONE_HEIGHT, PHONE_DEPTH]
    : formFactor === 'tablet' ? [5.2, 6.8, 0.22] : [7.8, 4.5, 0.3];
  const [width, height, depth] = dimensions;
  const group = new THREE.Group();
  const chassis = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 6, 0.18), frame);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.91, height * 0.91), screen);
  display.position.z = depth / 2 + 0.012;
  group.add(chassis, display);
  if (formFactor === 'tv') {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), frame);
    stand.position.y = -height / 2 - 0.55;
    group.add(stand);
  }
  return group;
}

function loadOnce(loader: GLTFLoader, url: string, timeoutMs = 8_000) {
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error('Device model load timed out.')), timeoutMs);
  });
  return Promise.race([loader.loadAsync(url), timeout]);
}

async function loadPhoneAsset(url: string) {
  const loader = new GLTFLoader();
  try { return await loadOnce(loader, url); }
  catch { return loadOnce(loader, url); }
}

export function createDeviceTwin(
  formFactor: DeviceFormFactor,
  finish: 'natural-titanium' | 'graphite',
  phoneAssetUrl?: string,
) {
  const group = proceduralTwin(formFactor, finish);
  if (formFactor !== 'phone' || !phoneAssetUrl) return { group, ready: Promise.resolve() };
  const ready = loadPhoneAsset(phoneAssetUrl).then(({ scene }) => {
    scene.traverse((item) => {
      if (item instanceof THREE.Mesh) { item.castShadow = true; item.receiveShadow = true; }
    });
    const box = new THREE.Box3().setFromObject(scene);
    const width = box.max.x - box.min.x;
    if (width > 0) scene.scale.setScalar(PHONE_WIDTH / width);
    group.clear();
    group.add(scene);
  }).catch(() => undefined);
  return { group, ready };
}
