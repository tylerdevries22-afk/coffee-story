export type MotionPoint = { readonly x: number; readonly y: number };

export type DragSample = {
  readonly offset: MotionPoint;
  readonly velocity: MotionPoint;
};

type CanvasSize = { readonly height: number; readonly width: number };

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

/** Projects a pointer release through a short, bounded inertial coast before spring settling. */
export function projectDragRelease(sample: DragSample, canvas: CanvasSize, reducedMotion = false): MotionPoint {
  if (reducedMotion) return sample.offset;
  const speed = Math.hypot(sample.velocity.x, sample.velocity.y);
  const coastSeconds = clamp(.08 + speed / 10_000, .08, .22);
  const maxHorizontalCoast = canvas.width * .22;
  const maxVerticalCoast = canvas.height * .22;
  return {
    x: sample.offset.x + clamp(sample.velocity.x * coastSeconds, -maxHorizontalCoast, maxHorizontalCoast),
    y: sample.offset.y + clamp(sample.velocity.y * coastSeconds, -maxVerticalCoast, maxVerticalCoast),
  };
}
