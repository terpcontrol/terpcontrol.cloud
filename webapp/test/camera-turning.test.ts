import type { CameraOrientation } from '@fg2/shared-types/v1';
import { isUpright, previewTransform, sameOrientation, turned, UPRIGHT, type TurnAction } from '@/screens/camera/turning';

/**
 * The arithmetic behind the orientation buttons, checked on a picture small
 * enough to write down. The server mirrors first and rotates clockwise after;
 * a button turns the picture as it is shown; the preview turns a still stored
 * one way into how it would be stored another. Each is checked against the
 * plain reading on a grid of distinct pixels.
 */

type Grid = number[][];

const PICTURE: Grid = [
  [1, 2, 3],
  [4, 5, 6],
];

const hflip = (grid: Grid): Grid => grid.map(row => [...row].reverse());
const vflip = (grid: Grid): Grid => [...grid].reverse();
const clockwise = (grid: Grid): Grid => grid[0].map((_, column) => grid.map(row => row[column]).reverse());
const quarters = (grid: Grid, count: number): Grid => Array.from({ length: ((count % 4) + 4) % 4 }).reduce<Grid>(turned => clockwise(turned), grid);

/** How the server stores the picture. */
const stored = (grid: Grid, { rotation, flipHorizontal, flipVertical }: CameraOrientation): Grid =>
  quarters(flipVertical ? vflip(flipHorizontal ? hflip(grid) : grid) : flipHorizontal ? hflip(grid) : grid, rotation / 90);

/** What a button does to the picture on the screen. */
const pressed: Record<TurnAction, (grid: Grid) => Grid> = {
  left: grid => quarters(grid, 3),
  right: grid => quarters(grid, 1),
  mirror: hflip,
  flip: vflip,
};

/** What `rotate(Xdeg) scaleX(Y)` does: the scale first, as CSS applies the right-hand function first. */
const transformed = (grid: Grid, transform: string): Grid => {
  const [, degrees, scale] = /^rotate\((-?\d+)deg\) scaleX\((-?1)\)$/.exec(transform)!;
  return quarters(scale === '-1' ? hflip(grid) : grid, Number(degrees) / 90);
};

const EVERY: CameraOrientation[] = ([0, 90, 180, 270] as const).flatMap(rotation =>
  [false, true].flatMap(flipHorizontal => [false, true].map(flipVertical => ({ rotation, flipHorizontal, flipVertical }))),
);
const ACTIONS: TurnAction[] = ['left', 'right', 'mirror', 'flip'];

describe('turning a camera´s picture', () => {
  it.each(EVERY)('turns the picture shown with %o the way each button says', orientation => {
    for (const action of ACTIONS) {
      expect(stored(PICTURE, turned(orientation, action))).toEqual(pressed[action](stored(PICTURE, orientation)));
    }
  });

  it.each(EVERY)('previews a picture stored with %o as it would be stored with every other one', from => {
    for (const to of EVERY) {
      expect(transformed(stored(PICTURE, from), previewTransform(from, to))).toEqual(stored(PICTURE, to));
    }
  });

  it('says a mirrored picture turned half way round as the top-to-bottom mirror it is', () => {
    expect(turned(UPRIGHT, 'flip')).toEqual({ rotation: 0, flipHorizontal: false, flipVertical: true });
    expect(turned(turned(UPRIGHT, 'right'), 'right')).toEqual({ rotation: 180, flipHorizontal: false, flipVertical: false });
  });

  it('knows an orientation when it is spelled another way', () => {
    expect(sameOrientation({ rotation: 180, flipHorizontal: true, flipVertical: true }, UPRIGHT)).toBe(true);
    expect(isUpright({ rotation: 180, flipHorizontal: true, flipVertical: true })).toBe(true);
    expect(
      sameOrientation({ rotation: 90, flipHorizontal: true, flipVertical: false }, { rotation: 270, flipHorizontal: false, flipVertical: true }),
    ).toBe(true);
  });
});
