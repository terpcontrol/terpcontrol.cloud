import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { MediaQuality } from '@fg2/shared-types/v1';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { TimelapseService } from '@modules/v1/camera/timelapse.service';

/**
 * Films of a camera that was turned. Its stills are stored the way it was set
 * when each was taken, so a span across the change holds frames of two shapes,
 * and a rolling film copies them as they are. ffmpeg would stretch every frame
 * to the size of the first; the film is shown at the camera's newest shape
 * instead, with the others fitted into it.
 *
 * These run the real ffmpeg, as the capture's own specs do.
 */

const CAMERA = { id: 'a-camera' } as CameraDocument;

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3a6' } })
    .jpeg()
    .toBuffer();

/** Width and height of the film's video stream, as ffprobe reads them. */
const sizeOfFilm = (path: string): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim()),
    ),
  );

/** One rolling film of the given stills, oldest first, answered with the size it came out at. */
async function film(stills: Buffer[], quality: MediaQuality): Promise<string> {
  const frames = stills.map((_, index) => ({ id: `still-${index}`, capturedAt: new Date(Date.UTC(2026, 9, 4, 12, index * 2)) }));
  const media = { copyToFile: (id: string, path: string) => writeFile(path, stills[Number(id.split('-')[1])]) };
  const timelapse = new TimelapseService(undefined as never, media as never, undefined as never, undefined as never);
  const encode = (timelapse as unknown as { encode: (...args: unknown[]) => Promise<boolean> }).encode.bind(timelapse);

  let size = '';
  const built = await encode(CAMERA, frames, { quality, watermark: false, compose: null }, async (path: string) => {
    size = await sizeOfFilm(path);
  });

  expect(built).toBe(true);
  return size;
}

it('shows a span across the turn at the newest shape rather than stretching it to the first', async () => {
  const [landscape, portrait] = await Promise.all([picture(320, 180), picture(180, 320)]);

  await expect(film([...Array(7).fill(landscape), ...Array(7).fill(portrait)], 'hd')).resolves.toBe('180,320');
});

it('keeps a camera that was never turned at the size it delivered', async () => {
  const landscape = await picture(320, 180);

  await expect(film(Array(14).fill(landscape), 'hd')).resolves.toBe('320,180');
});

it('bounds the longer edge of a reduced film, so a portrait film is no larger than a landscape one', async () => {
  const [landscape, portrait] = await Promise.all([picture(320, 180), picture(180, 320)]);

  await expect(film(Array(14).fill(landscape), 'sd')).resolves.toBe('1280,720');
  await expect(film(Array(14).fill(portrait), 'sd')).resolves.toBe('720,1280');
});
