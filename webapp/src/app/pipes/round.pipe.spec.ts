import { NoFractPipe } from './nofract.pipe';
import { RoundPipe } from './round.pipe';
import { NO_VALUE } from '../util/no-value';

describe('RoundPipe', () => {
  const pipe = new RoundPipe();

  it('create an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('rounds to one decimal by default', () => {
    expect(pipe.transform(22.44)).toBe('22.4');
    expect(pipe.transform('22.46', 2)).toBe('22.46');
  });

  it('renders a placeholder instead of NaN', () => {
    expect(pipe.transform(NaN)).toBe(NO_VALUE);
    expect(pipe.transform(null)).toBe(NO_VALUE);
    expect(pipe.transform(undefined)).toBe(NO_VALUE);
    expect(pipe.transform('')).toBe(NO_VALUE);
  });
});

describe('NoFractPipe', () => {
  const pipe = new NoFractPipe();

  it('appends the unit only when there is a value', () => {
    expect(pipe.transform(0.5, '%')).toBe('1%');
    expect(pipe.transform(NaN, '%')).toBe(NO_VALUE);
  });
});
