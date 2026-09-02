'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import type { DeviceFormFactor } from '@platform/device-wall';

import { createDeviceTwin } from './model';

export type DeviceTwinProps = {
  readonly formFactor: DeviceFormFactor;
  readonly finish?: 'natural-titanium' | 'graphite';
  readonly phoneAssetUrl?: string;
  readonly label: string;
  readonly status?: 'online' | 'degraded' | 'offline' | 'provisioning' | 'archived';
};

export function DeviceTwin({
  finish = 'natural-titanium', formFactor, label, phoneAssetUrl, status = 'offline',
}: DeviceTwinProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.15, 14);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x25272c, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(5, 6, 8);
    scene.add(key);
    const { group } = createDeviceTwin(formFactor, finish, phoneAssetUrl);
    group.rotation.set(-0.08, -0.34, 0.02);
    scene.add(group);
    const resize = () => {
      const { clientHeight: height, clientWidth: width } = canvas;
      if (!height || !width) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    let frame = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const render = () => {
      if (!reduced) group.rotation.y += 0.0015;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    render();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((item) => {
        if (item instanceof THREE.Mesh) item.geometry.dispose();
      });
      renderer.dispose();
    };
  }, [finish, formFactor, phoneAssetUrl]);
  return (
    <canvas
      aria-label={`${label}, ${formFactor}, ${status}`}
      className="device-twin-canvas"
      data-device-status={status}
      ref={canvasRef}
      role="img"
    />
  );
}
