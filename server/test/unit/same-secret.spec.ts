import { sameSecret } from '@common/same-secret';

/**
 * The one comparison every secret the server is handed goes through: the
 * automation token, the broker's shared secret, a device's legacy password and
 * the Telegram link and webhook. It has to be plain equality of the bytes, and
 * nothing looser - padding to one width must not let a prefix or a different
 * tail through.
 */
describe('comparing a supplied secret with the expected one', () => {
  it('accepts exactly the same secret', () => {
    expect(sameSecret('s3cret', 's3cret')).toBe(true);
    expect(sameSecret('x'.repeat(100), 'x'.repeat(100))).toBe(true);
  });

  it('refuses a prefix, a longer secret and one padded with what the padding is made of', () => {
    expect(sameSecret('s3cre', 's3cret')).toBe(false);
    expect(sameSecret('s3crets', 's3cret')).toBe(false);
    expect(sameSecret('s3cret\0', 's3cret')).toBe(false);
    expect(sameSecret('', 's3cret')).toBe(false);
  });

  it('compares characters outside ASCII by their bytes, so a different tail is never cut off', () => {
    expect(sameSecret('ü'.repeat(20), 'ü'.repeat(20))).toBe(true);
    expect(sameSecret(`${'ü'.repeat(16)}xxxx`, 'ü'.repeat(20))).toBe(false);
    expect(sameSecret(`${'ä'.repeat(20)}${'x'.repeat(20)}`, 'ä'.repeat(40))).toBe(false);
  });
});
