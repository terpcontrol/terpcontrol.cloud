import type { CameraOrientation } from '@fg2/shared-types/v1';

/**
 * Turning a camera's picture, worked out the way the server turns it: mirrored
 * left to right and top to bottom first, then rotated clockwise.
 *
 * Every orientation there is comes down to a number of quarter turns and
 * whether the picture is mirrored, because a top-to-bottom mirror is a
 * left-to-right one turned half way round. In that form two turns combine and
 * come apart with a little arithmetic, which is what a button needs - it turns
 * the picture the person is looking at, whatever it was turned by before - and
 * what the preview needs, since the newest still is already turned the way the
 * camera was set when it was taken.
 */

export const UPRIGHT: CameraOrientation = { rotation: 0, flipHorizontal: false, flipVertical: false };

/** Mirrored left to right first, then this many quarter turns clockwise. */
interface Turn {
  quarters: number;
  mirrored: boolean;
}

export type TurnAction = 'left' | 'right' | 'mirror' | 'flip';

const turnOf = ({ rotation, flipHorizontal, flipVertical }: CameraOrientation): Turn => ({
  quarters: (rotation / 90 + (flipVertical ? 2 : 0)) % 4,
  mirrored: flipHorizontal !== flipVertical,
});

/** A half turn of a mirrored picture is said as the top-to-bottom mirror it looks like. */
const orientationOf = ({ quarters, mirrored }: Turn): CameraOrientation =>
  mirrored && quarters === 2
    ? { rotation: 0, flipHorizontal: false, flipVertical: true }
    : { rotation: ((quarters * 90) % 360) as CameraOrientation['rotation'], flipHorizontal: mirrored, flipVertical: false };

/** `second` after `first`. Mirroring reverses the direction every later turn goes in. */
const then = (first: Turn, second: Turn): Turn => ({
  quarters: (((second.quarters + (second.mirrored ? -first.quarters : first.quarters)) % 4) + 4) % 4,
  mirrored: first.mirrored !== second.mirrored,
});

const undo = ({ quarters, mirrored }: Turn): Turn => ({ quarters: mirrored ? quarters : (4 - quarters) % 4, mirrored });

const ACTIONS: Record<TurnAction, Turn> = {
  left: { quarters: 3, mirrored: false },
  right: { quarters: 1, mirrored: false },
  mirror: { quarters: 0, mirrored: true },
  // Top to bottom: mirrored left to right, then half way round.
  flip: { quarters: 2, mirrored: true },
};

/** The orientation that turns the picture as it is shown now one step further. */
export const turned = (orientation: CameraOrientation, action: TurnAction): CameraOrientation =>
  orientationOf(then(turnOf(orientation), ACTIONS[action]));

/**
 * The CSS transform that shows a picture stored with `from` as it would be
 * stored with `to`. CSS applies the right-hand function first, which is the
 * mirror before the rotation the server applies.
 */
export const previewTransform = (from: CameraOrientation, to: CameraOrientation): string => {
  const { quarters, mirrored } = then(undo(turnOf(from)), turnOf(to));
  return `rotate(${quarters * 90}deg) scaleX(${mirrored ? -1 : 1})`;
};

export const isUpright = (orientation: CameraOrientation): boolean => {
  const { quarters, mirrored } = turnOf(orientation);
  return quarters === 0 && !mirrored;
};

/** A landscape camera turned a quarter either way delivers portrait pictures. */
export const isPortrait = (orientation: CameraOrientation): boolean => orientation.rotation % 180 === 90;

export const sameOrientation = (one: CameraOrientation, other: CameraOrientation): boolean => {
  const [a, b] = [turnOf(one), turnOf(other)];
  return a.quarters === b.quarters && a.mirrored === b.mirrored;
};
