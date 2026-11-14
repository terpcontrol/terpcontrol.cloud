import { withoutCredentials } from '@common/log-path';
import { changesTheStream, saidOfStream, streamUrl, withoutUserInfo } from '@modules/v1/camera/stream-url';

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

/**
 * A stream test through a device's tunnel failed with "Error opening input file rtsp://127.0.0.1:32967/nothing" and
 * "[in#0 @ 0xffffb3788350]" while the person had typed port 8554: the details pointed somebody debugging their camera
 * at the tunnel's port on this server.
 */
describe('what ffmpeg said about a stream', () => {
  const said = [
    '[in#0 @ 0xffffb3788350] Failed reading RTSP data: End of file',
    '[in#0 @ 0xffffb3702520] Error opening input: Invalid data found when processing input',
    'Error opening input file rtsp://viewer:hunter2@127.0.0.1:32967/nothing.',
  ].join('\n');

  it('names the address the person typed, its login redacted, and no memory address', () => {
    const shown = withoutCredentials(
      saidOfStream(said, 'rtsp://viewer:hunter2@127.0.0.1:32967/nothing', 'rtsp://viewer:hunter2@10.0.0.30:8554/nothing'),
    );

    expect(shown).toBe(
      [
        '[in#0] Failed reading RTSP data: End of file',
        '[in#0] Error opening input: Invalid data found when processing input',
        'Error opening input file rtsp://<credentials>@10.0.0.30:8554/nothing.',
      ].join('\n'),
    );
    expect(shown).not.toContain('32967');
    expect(shown).not.toContain('hunter2');
  });

  it('leaves a stream opened where it was typed as ffmpeg said it', () => {
    expect(saidOfStream('Connection refused: rtsp://10.0.0.30/stream1', 'rtsp://10.0.0.30/stream1', 'rtsp://10.0.0.30/stream1')).toBe(
      'Connection refused: rtsp://10.0.0.30/stream1',
    );
  });
});
