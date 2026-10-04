import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntitlementService } from '@modules/v1/camera/entitlement.service';

/**
 * What Premium gates, which is the picture pipeline and nothing else.
 *
 * The switches are read from the environment, so the spec builds the service
 * with the configuration rather than driving routes: what it holds is that an
 * install which says nothing gates nothing at all, and that turning enforcement
 * on does not by itself start deleting anybody's pictures.
 */

type Premium = ConstructorParameters<typeof EntitlementService>[0];

const CONFIGURATION: Premium = {
  enforced: false,
  freeStillWidth: 0,
  freeRetention: false,
  freeStillDays: 0,
  freeTimelapseDays: 0,
  extendUrl: '',
  priceLabel: '',
};

const gate = (premium: Partial<Premium> = {}) => new EntitlementService({ ...CONFIGURATION, ...premium });

const camera = (validUntil: Date | null): Pick<CameraDocument, 'entitlement'> => ({ entitlement: { validUntil, grant: 'included' } });

const inAYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe('an install that says nothing', () => {
  it('reads every camera as entitled, whatever its date says', () => {
    expect(gate().isEntitled(camera(null))).toBe(true);
    expect(gate().serialise(camera(lastMonth)).tier).toBe('premium');
  });

  it('serves every still whole', () => {
    expect(gate({ freeStillWidth: 640 }).servedStillWidth(camera(lastMonth))).toBeUndefined();
  });

  it('offers no renewal, because there is nothing to renew', () => {
    expect(gate({ extendUrl: 'https://example.invalid/premium' }).serialise(camera(null)).renewalVisible).toBe(false);
  });
});

describe('an install that enforces', () => {
  const enforced = { enforced: true, freeStillWidth: 640 };

  it('reads a camera whose year has run out as free', () => {
    expect(gate(enforced).isEntitled(camera(lastMonth))).toBe(false);
    expect(gate(enforced).isEntitled(camera(inAYear))).toBe(true);
    expect(gate(enforced).isEntitled(camera(null))).toBe(false);
  });

  it('serves a free camera´s stills smaller and an entitled one´s whole', () => {
    expect(gate(enforced).servedStillWidth(camera(lastMonth))).toBe(640);
    expect(gate(enforced).servedStillWidth(camera(inAYear))).toBeUndefined();
  });

  it('gives a free render the lesser resolution and the mark', () => {
    expect(gate(enforced).allowedQuality(camera(lastMonth), 'hd')).toBe('sd');
    expect(gate(enforced).allowedQuality(camera(inAYear), 'hd')).toBe('hd');
    expect(gate(enforced).watermarks(camera(lastMonth))).toBe(true);
    expect(gate(enforced).watermarks(camera(inAYear))).toBe(false);
  });

  it('shows the renewal notice once there is somewhere to send the person', () => {
    expect(gate(enforced).serialise(camera(lastMonth)).renewalVisible).toBe(false);
    expect(gate({ ...enforced, extendUrl: 'https://example.invalid/premium' }).serialise(camera(lastMonth)).renewalVisible).toBe(true);
  });
});

describe('deleting a free camera´s older pictures', () => {
  // A switch of its own, so that turning enforcement on narrows what is served
  // and never what is kept.
  it('is off until an install turns it on and says how many days', () => {
    expect(gate({ enforced: true, freeStillDays: 30 }).freeRetention()).toBeNull();
    expect(gate({ enforced: true, freeRetention: true }).freeRetention()).toBeNull();
    expect(gate({ freeRetention: true, freeStillDays: 30 }).freeRetention()).toBeNull();
  });

  it('applies the windows the install named once both are set', () => {
    expect(gate({ enforced: true, freeRetention: true, freeStillDays: 30, freeTimelapseDays: 90 }).freeRetention()).toEqual({
      stillDays: 30,
      timelapseDays: 90,
    });
  });
});
