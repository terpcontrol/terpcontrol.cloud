import TimeAgo from 'javascript-time-ago';
import { formatTimeAgo, timeAgo } from './time-ago';

describe('relative time', () => {
  it('never reports from the future, whatever a device’s clock says', () => {
    const gleich = formatTimeAgo(Date.now() + 2 * 60 * 1000);
    expect(gleich).toBe(formatTimeAgo(Date.now()));
    expect(gleich).not.toContain('in ');
  });

  it('says „gerade eben" in German, not the library’s „gerade jetzt"', () => {
    // Registering the labels is what `timeAgo()` does on first use.
    timeAgo();
    const deutsch = new TimeAgo('de');

    expect(deutsch.format(Date.now() - 5000)).toBe('gerade eben');
    expect(deutsch.format(Date.now() - 90 * 1000)).toBe('vor 2 Minuten');
  });

  it('is empty rather than „Invalid Date" for something that is not a time', () => {
    expect(formatTimeAgo('nicht datierbar')).toBe('');
  });
});
