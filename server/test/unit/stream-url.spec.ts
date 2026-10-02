import { changesTheStream, streamUrl, withoutUserInfo } from '@modules/v1/camera/stream-url';

/**
 * An RTSP camera's address and the login inside it. The login is never
 * answered, so the person correcting an address after their router handed the
 * camera a new IP cannot send it back - and the address they do send has to
 * keep it, or the camera that was fixed stops opening for a different reason.
 */
describe('the URL a stream is opened at', () => {
  const stored = 'rtsp://viewer:hunter2@10.0.0.30:554/stream1';

  it('keeps the stored login when the new address brings none of its own', () => {
    expect(streamUrl(stored, { url: 'rtsp://10.0.0.31:554/stream1' })).toBe('rtsp://viewer:hunter2@10.0.0.31:554/stream1');
  });

  it('takes the login a new address is written with', () => {
    expect(streamUrl(stored, { url: 'rtsp://admin:other@10.0.0.31/h264Preview_01_main' })).toBe('rtsp://admin:other@10.0.0.31/h264Preview_01_main');
  });

  it('changes the password alone, on the address that is stored', () => {
    expect(streamUrl(stored, { password: 'n3w' })).toBe('rtsp://viewer:n3w@10.0.0.30:554/stream1');
  });

  it('changes either half of the login on a new address as well', () => {
    expect(streamUrl(stored, { url: 'rtsp://10.0.0.31/stream2', username: 'tapo' })).toBe('rtsp://tapo:hunter2@10.0.0.31/stream2');
  });

  it('takes the login away where both halves are sent empty', () => {
    expect(streamUrl(stored, { username: '', password: '' })).toBe('rtsp://10.0.0.30:554/stream1');
  });

  it('writes a password with an @ and a colon in it so that the address still reads', () => {
    const url = streamUrl(null, { url: 'rtsp://10.0.0.30/stream1', username: 'cam', password: 'p@ss:word' });

    expect(url).toBe('rtsp://cam:p%40ss%3Aword@10.0.0.30/stream1');
    expect(new URL(url!).hostname).toBe('10.0.0.30');
  });

  it('carries an encoded password over unharmed', () => {
    const encoded = 'rtsp://cam:p%40ss@10.0.0.30/stream1';

    expect(streamUrl(encoded, { url: 'rtsp://10.0.0.40/stream1' })).toBe('rtsp://cam:p%40ss@10.0.0.40/stream1');
  });

  it('keeps an address that is not a URL as it was sent, because the first capture says what is wrong with it', () => {
    expect(streamUrl(stored, { url: 'not an address' })).toBe('not an address');
  });

  it('is only asked where a change names the address or the login', () => {
    expect(changesTheStream({})).toBe(false);
    expect(changesTheStream({ password: '' })).toBe(true);
  });

  it('answers the address with no login in it', () => {
    expect(withoutUserInfo(stored)).toBe('rtsp://10.0.0.30:554/stream1');
    expect(withoutUserInfo(null)).toBeNull();
  });
});
