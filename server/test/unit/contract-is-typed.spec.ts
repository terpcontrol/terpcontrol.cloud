import { device, notificationCategory } from '@fg2/shared-types/v1-schemas';

/**
 * The shared package is linked with `file:`, and node resolves a linked
 * package's own imports from the package rather than from whoever linked it.
 * Its schemas import zod, so an environment that installed the server's
 * dependencies but not the shared package's own resolves every one of them to
 * `any` - and the server then compiles against a contract that says nothing,
 * quietly and without an error anywhere.
 *
 * This is what makes that loud. `IsAny` is the usual trick: only `any`
 * distributes over both branches of the conditional, so the annotation below
 * stops compiling the moment the contract degrades.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

const contractIsTyped: IsAny<typeof device> extends true ? never : true = true;

describe('the shared contract', () => {
  it('is typed, not any', () => {
    expect(contractIsTyped).toBe(true);
  });

  it('carries its values, not just its types', () => {
    expect(notificationCategory.options.length).toBeGreaterThan(0);
    expect(device.safeParse({}).success).toBe(false);
  });
});
