import { TerpMissingTranslationHandler } from './missing-translation';

describe('a key that is not in the bundle', () => {
  const handler = new TerpMissingTranslationHandler();

  it('never reaches the reader as a dotted path', () => {
    expect(handler.handle({ key: 'zelt.mass.lights.limit' } as never)).toBe('Limit');
    expect(handler.handle({ key: 'auxDevices.sockets.roles.co2_valve' } as never)).toBe('Co2 valve');
  });

  it('prefers what the device actually called the thing', () => {
    expect(handler.handle({ key: 'zelt.mass.wurzelraum', interpolateParams: { ersatz: 'wurzelraum' } } as never)).toBe('wurzelraum');
  });

  it('ignores an empty stand-in rather than printing nothing', () => {
    expect(handler.handle({ key: 'zelt.mass.co2', interpolateParams: { ersatz: '' } } as never)).toBe('Co2');
  });
});
