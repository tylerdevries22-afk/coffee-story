import Svg, { Path } from 'react-native-svg';

/**
 * Rewards tab icon: a takeaway coffee cup.
 *
 * Drawn rather than composed from SF Symbols so the silhouette matches the
 * glass rewards cup exactly — tapered body, lid band, small sip dome.
 *
 * Uses react-native-svg rather than Skia: this is a static two-path shape, so
 * SVG is both the right primitive and the one that works everywhere. Skia has
 * no renderer on web unless CanvasKit is loaded first, and this icon is on
 * screen from the very first frame — it cannot wait for a WASM download.
 *
 * Authored on a 26-unit grid and scaled by the viewBox.
 */
const GRID = 26;

/** Tapered cup body with a softly rounded base. */
const CUP_BODY =
  'M7.6,8.4 L18.4,8.4 L17.2,20.2 C17.1,21.6 16.2,22.6 14.9,22.6 L11.1,22.6 ' +
  'C9.8,22.6 8.9,21.6 8.8,20.2 Z';

/** Lid band plus the little sip dome on top. */
const CUP_LID =
  'M6.2,5.4 L19.8,5.4 C20.3,5.4 20.7,5.8 20.7,6.3 L20.7,7.1 C20.7,7.6 20.3,8.0 19.8,8.0 ' +
  'L6.2,8.0 C5.7,8.0 5.3,7.6 5.3,7.1 L5.3,6.3 C5.3,5.8 5.7,5.4 6.2,5.4 Z ' +
  'M10.9,3.2 L15.1,3.2 C15.6,3.2 16.0,3.6 16.0,4.1 L16.0,4.6 L10.0,4.6 L10.0,4.1 ' +
  'C10.0,3.6 10.4,3.2 10.9,3.2 Z';

export function CupIcon({ size = 26, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
      <Path d={CUP_BODY} fill={color} />
      <Path d={CUP_LID} fill={color} fillRule="evenodd" />
    </Svg>
  );
}
