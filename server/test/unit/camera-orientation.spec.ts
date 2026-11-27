import { jest } from '@jest/globals';
import type { CameraOrientation } from '@fg2/shared-types/v1';
import { CameraPollerService } from '@modules/v1/camera/camera-poller.service';
import { orientationArgs, orientationFilters, orientationOf, UPRIGHT } from '@modules/v1/camera/orientation';

/**
 * A camera's orientation is mirrored first and rotated clockwise after, and it
 * reaches ffmpeg folded into at most two mirrors and one quarter turn. The
 * folding is checked against the plain reading on a picture small enough to
 * write down: a grid of distinct pixels, turned both ways.
 */

type Grid = number[][];

const PICTURE: Grid = [
  [1, 2, 3],
  [4, 5, 6],
];

const hflip = (grid: Grid): Grid => grid.map(row => [...row].reverse());
const vflip = (grid: Grid): Grid => [...grid].reverse();
// A quarter turn clockwise: the bottom row becomes the first column.
const clockwise = (grid: Grid): Grid => grid[0].map((_, column) => grid.map(row => row[column]).reverse());

/** What the contract says, step by step. */
const asOrdered = (grid: Grid, { rotation, flipHorizontal, flipVertical }: CameraOrientation): Grid => {
  let turned = flipHorizontal ? hflip(grid) : grid;
  turned = flipVertical ? vflip(turned) : turned;
  for (let quarter = 0; quarter < rotation / 90; quarter++) turned = clockwise(turned);
  return turned;
};

/** What ffmpeg does with the filters it is handed, in their order. */
const asFiltered = (grid: Grid, filters: string[]): Grid =>
  filters.reduce((turned, filter) => {
    if (filter === 'hflip') return hflip(turned);
    if (filter === 'vflip') return vflip(turned);
    if (filter === 'transpose=clock') return clockwise(turned);
    throw new Error(`unexpected filter ${filter}`);
  }, grid);

const EVERY: CameraOrientation[] = ([0, 90, 180, 270] as const).flatMap(rotation =>
  [false, true].flatMap(flipHorizontal => [false, true].map(flipVertical => ({ rotation, flipHorizontal, flipVertical }))),
);

it.each(EVERY)('turns %o as the contract orders it', orientation => {
  const filters = orientationFilters(orientation);

  expect(asFiltered(PICTURE, filters)).toEqual(asOrdered(PICTURE, orientation));
  expect(filters.filter(filter => filter.startsWith('transpose'))).toHaveLength(orientation.rotation % 180 === 90 ? 1 : 0);
});

it('leaves a picture that is not turned to ffmpeg as it is', () => {
  expect(orientationArgs(UPRIGHT)).toEqual([]);
  expect(orientationArgs({ rotation: 180, flipHorizontal: true, flipVertical: true })).toEqual([]);
  expect(orientationArgs({ rotation: 90, flipHorizontal: false, flipVertical: false })).toEqual(['-vf', 'transpose=clock']);
});

it('reads a camera stored before it could be turned as upright', () => {
  expect(orientationOf({})).toEqual(UPRIGHT);
  expect(orientationOf({ orientation: null })).toEqual(UPRIGHT);
});

it('stores each still with the orientation it was turned by', async () => {
  const orientation: CameraOrientation = { rotation: 270, flipHorizontal: true, flipVertical: false };
  const storeBytes = jest.fn<(draft: unknown, data: Buffer) => Promise<{ id: string }>>().mockResolvedValue({ id: 'media-1' });
  const cameras = { noteCapture: async () => undefined };
  const poller = new CameraPollerService(
    {} as never,
    cameras as never,
    { readStill: async () => Buffer.from('a still') } as never,
    { storeBytes } as never,
    {} as never,
    null,
  );
  const readAndStore = (poller as unknown as { readAndStore(camera: unknown): Promise<unknown> }).readAndStore.bind(poller);

  await readAndStore({ id: 'camera-1', deviceId: null, orientation });
  await readAndStore({ id: 'camera-2', deviceId: null });

  expect(storeBytes.mock.calls.map(([draft]) => (draft as { orientation: unknown }).orientation)).toEqual([orientation, UPRIGHT]);
});
