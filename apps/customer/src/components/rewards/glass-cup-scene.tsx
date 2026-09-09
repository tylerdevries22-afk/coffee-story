import {
  BlurMask, Canvas, Circle, Group, Image as SkiaImage,
  LinearGradient as SkiaLinearGradient, Path, RadialGradient, Rect,
  RoundedRect, useImage, vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';

import { TENANT_MEDIA } from '@/tenants/media';

import { makeCupPath, type CupGeometry } from './glass-cup-geometry';
import type { GlassCupPalette } from './glass-cup-palettes';
import type { LiquidDrag } from './liquid-drag';
import { GlassCupParticles } from './glass-cup-particles';
import { Ripples } from './glass-cup-ripples';
import { useGlassCupAnimation } from './use-glass-cup-animation';

const NEBULA = TENANT_MEDIA.artwork['rewards/liquid-nebula.webp'];

type GlassCupSceneProps = {
  geo: CupGeometry;
  target: number;
  palette: GlassCupPalette;
  animate: boolean;
  drag?: LiquidDrag;
  replayKey?: string | number;
};

export function GlassCupScene({ geo, target, palette, animate, drag, replayKey }: GlassCupSceneProps) {
  const { k, width, height, cupTop, cupBottom, centerX, centerY } = geo;
  const cupPath = useMemo(() => makeCupPath(geo.k, geo.topExt), [geo]);
  const nebulaImage = useImage(NEBULA);
  const {
    pour, master, surfaceY, liquidTransform, liquidPath, backWavePath,
    nebulaOpacityA, nebulaOpacityB, nebulaTransformA, nebulaTransformB,
    nebulaClipRect, streamPath, streamCorePath, streamOpacity,
    streamCoreOpacity, shimmerTransform, shimmerOpacity, staticSurface,
  } = useGlassCupAnimation({ animate, target, geo, drag, replayKey });
  return (
      <Canvas style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* ---- Glass shell (behind the liquid) ---- */}
        <Path path={cupPath} color="rgba(255,255,255,0.10)" />
        <Path path={cupPath}>
          <SkiaLinearGradient
            start={vec(centerX, cupTop)}
            end={vec(centerX, cupBottom)}
            colors={['rgba(255,255,255,0.30)', 'rgba(255,255,255,0.02)']}
          />
        </Path>

        {/* ---- Liquid, clipped to one seamless cup path ---- */}
        <Group clip={cupPath}>
          <Group transform={liquidTransform} origin={vec(centerX, centerY)}>
            <Path path={backWavePath} color={palette.waveBack} opacity={0.55} />
            <Path path={liquidPath}>
              <SkiaLinearGradient
                start={vec(centerX, cupTop)}
                end={vec(centerX, cupBottom + 6 * k)}
                colors={[palette.liquidLight, palette.liquidMid, palette.liquidDeep]}
                positions={[0, 0.4, 1]}
              />
            </Path>
            {/* caustic glow near the bottom of the liquid */}
            <Circle cx={centerX} cy={cupBottom - 8 * k} r={26 * k} opacity={0.3}>
              <RadialGradient
                c={vec(centerX, cupBottom - 8 * k)}
                r={26 * k}
                colors={[palette.liquidLight, 'rgba(255,255,255,0)']}
              />
            </Circle>

            {/* starry nebula, screen-blended inside the liquid */}
            {nebulaImage ? (
              <Group clip={nebulaClipRect}>
                <Group transform={nebulaTransformA} origin={vec(centerX, centerY + 8 * k)} blendMode="screen" opacity={nebulaOpacityA}>
                  <SkiaImage image={nebulaImage} x={centerX - width * 0.75} y={centerY - width * 0.55} width={width * 1.5} height={width * 1.5} fit="cover" />
                </Group>
                <Group transform={nebulaTransformB} origin={vec(centerX, centerY + 16 * k)} blendMode="screen" opacity={nebulaOpacityB}>
                  <SkiaImage image={nebulaImage} x={centerX - width * 0.75} y={centerY - width * 0.35} width={width * 1.5} height={width * 1.5} fit="cover" />
                </Group>
              </Group>
            ) : null}

            <GlassCupParticles
              animate={animate}
              master={master}
              pour={pour}
              surfaceY={surfaceY}
              staticSurface={staticSurface}
              geo={geo}
              palette={palette}
            />
          </Group>

          {/* splash ripples where the stream lands (not tilted with liquid) */}
          {animate ? <Ripples master={master} pour={pour} surfaceY={surfaceY} geo={geo} palette={palette} /> : null}

          {/* shimmer sweep across the glass */}
          <Group transform={shimmerTransform} origin={vec(centerX, centerY)}>
            <Rect x={centerX - 9 * k} y={cupTop - 20 * k} width={14 * k} height={height} color="white" opacity={shimmerOpacity}>
              <BlurMask blur={7 * k} style="normal" />
            </Rect>
          </Group>

          {/* inner shadow for curved depth */}
          <Path path={cupPath} style="stroke" strokeWidth={5 * k} color="rgba(20,10,40,0.16)">
            <BlurMask blur={4 * k} style="normal" />
          </Path>
        </Group>

        {/* ---- Pour stream (drawn unclipped so it starts above the glass) ---- */}
        {animate ? (
          <>
            <Path path={streamPath} opacity={streamOpacity}>
              <SkiaLinearGradient
                start={vec(centerX, 0)}
                end={vec(centerX, height * 0.8)}
                colors={[palette.streamLight, palette.streamDeep]}
              />
            </Path>
            <Path path={streamCorePath} color="rgba(255,255,255,0.75)" opacity={streamCoreOpacity}>
              <BlurMask blur={1.2 * k} style="normal" />
            </Path>
          </>
        ) : null}

        {/* ---- Glass front: rim + speculars ---- */}
        <Path path={cupPath} style="stroke" strokeWidth={1.7 * k}>
          <SkiaLinearGradient
            start={vec(centerX, cupTop)}
            end={vec(centerX, cupBottom)}
            colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.22)']}
          />
        </Path>
        <Group transform={[{ rotate: -0.66 }]} origin={vec(32 * k, 30 * k + geo.topExt)}>
          <RoundedRect x={22 * k} y={26 * k + geo.topExt} width={20 * k} height={7 * k} r={4 * k} color="rgba(255,255,255,0.55)">
            <BlurMask blur={2.5 * k} style="normal" />
          </RoundedRect>
        </Group>
        <Circle cx={26 * k} cy={34 * k + geo.topExt} r={2.6 * k} color="rgba(255,255,255,0.6)">
          <BlurMask blur={1.6 * k} style="normal" />
        </Circle>
        <Path
          path={`M ${84 * k} ${26 * k + geo.topExt} C ${92 * k} ${34 * k + geo.topExt} ${94 * k} ${48 * k + geo.topExt} ${90 * k} ${62 * k + geo.topExt}`}
          style="stroke"
          strokeWidth={2.4 * k}
          color="rgba(255,255,255,0.22)"
        >
          <BlurMask blur={2 * k} style="normal" />
        </Path>
      </Canvas>
  );
}
