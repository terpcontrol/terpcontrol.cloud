import sharp from 'sharp';
import { createAccount, Session } from '../support/api';
import { DeviceCredentials, provisionDevice } from '../support/device';
import { storedImageExists, storeWebcamStill } from '../support/fixtures';

/**
 * Where the bytes of a picture live, and how they are served. They sit in a
 * GridFS bucket rather than in the document, so a picture is no longer capped at
 * what BSON holds - and is served as a stream, with byte ranges, because a
 * <video> element asks for them.
 */

let owner: Session;
let device: DeviceCredentials;
let still: Buffer;

const uploadPhoto = async (): Promise<{ imageId: string; bytes: Buffer }> => {
  const created = await owner.client.post(`/image/${device.deviceId}`).attach('image', still, 'still.jpg').expect(201);
  const stored = await owner.client.get(`/image/${device.deviceId}`).query({ image_id: created.body.image_id, format: 'user/jpeg' }).expect(200);

  return { imageId: created.body.image_id, bytes: stored.body };
};

beforeAll(async () => {
  owner = await createAccount('image-store-owner');
  device = await provisionDevice(owner);
  still = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 90, g: 40, b: 120 } } })
    .jpeg()
    .toBuffer();
});

describe('where a picture is kept', () => {
  it('stores the bytes outside the document and serves them back unchanged', async () => {
    const { imageId, bytes } = await uploadPhoto();

    expect(await storedImageExists(imageId)).toBe(true);
    expect((await sharp(bytes).metadata()).format).toBe('jpeg');
  });

  it('takes the bytes along when the picture is deleted', async () => {
    const { imageId } = await uploadPhoto();

    await owner.client.delete(`/image/${imageId}`).expect(200);

    expect(await storedImageExists(imageId)).toBe(false);
  });

  it('serves a webcam still from the store, as the poller left it', async () => {
    const camera = await provisionDevice(owner);
    const stored = await storeWebcamStill(camera.deviceId, still, Date.now());

    const response = await owner.client.get(`/image/${camera.deviceId}`).query({ image_id: stored.imageId, format: 'jpeg' }).expect(200);

    expect(await storedImageExists(stored.imageId)).toBe(true);
    expect(Number(response.headers['content-length'])).toBe(still.length);
    expect((await sharp(response.body).metadata()).format).toBe('jpeg');
  });
});

describe('serving one byte range of a picture', () => {
  it('says it takes ranges, and how large the picture is', async () => {
    const { bytes } = await uploadPhoto();

    const response = await owner.client.get(`/image/${device.deviceId}`).query({ format: 'user/jpeg' }).expect(200);

    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(Number(response.headers['content-length'])).toBe(bytes.length);
  });

  it('answers a range with 206 and only those bytes', async () => {
    const { imageId, bytes } = await uploadPhoto();

    const response = await owner.client
      .get(`/image/${device.deviceId}`)
      .query({ image_id: imageId, format: 'user/jpeg' })
      .set('Range', 'bytes=0-9')
      .expect(206);

    expect(response.headers['content-range']).toBe(`bytes 0-9/${bytes.length}`);
    expect(response.body.length).toBe(10);
    expect(response.body.toString('hex')).toBe(bytes.subarray(0, 10).toString('hex'));
  });

  it('answers a range that runs past the end with the bytes there are', async () => {
    const { imageId, bytes } = await uploadPhoto();

    const response = await owner.client
      .get(`/image/${device.deviceId}`)
      .query({ image_id: imageId, format: 'user/jpeg' })
      .set('Range', `bytes=${bytes.length - 5}-99999`)
      .expect(206);

    expect(response.headers['content-range']).toBe(`bytes ${bytes.length - 5}-${bytes.length - 1}/${bytes.length}`);
    expect(response.body.length).toBe(5);
  });

  it('refuses a range that starts past the end', async () => {
    const { imageId, bytes } = await uploadPhoto();

    const response = await owner.client
      .get(`/image/${device.deviceId}`)
      .query({ image_id: imageId, format: 'user/jpeg' })
      .set('Range', 'bytes=99999-')
      .expect(416);

    expect(response.headers['content-range']).toBe(`bytes */${bytes.length}`);
  });

  it('sends the whole picture when it has to be rewritten to answer', async () => {
    const { imageId } = await uploadPhoto();

    // Resizing needs the picture in memory, so this is the buffered path: the
    // range is not honoured, and saying otherwise would be a lie to the client.
    const response = await owner.client
      .get(`/image/${device.deviceId}`)
      .query({ image_id: imageId, format: 'user/jpeg', width: '80' })
      .set('Range', 'bytes=0-9')
      .expect(200);

    expect((await sharp(response.body).metadata()).width).toBe(80);
  });
});
