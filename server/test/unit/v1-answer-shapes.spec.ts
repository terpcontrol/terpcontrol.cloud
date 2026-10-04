import { entryCreate } from '@fg2/shared-types/v1-schemas';
import { ZodValidationPipe } from '@common/zod-validation.pipe';
import { afterCursor, encodeCursor, pageOf, pageLimit, MAX_PAGE_LIMIT } from '@common/v1/pages';
import { ProblemException } from '@common/v1/problem';
import { fieldOfMetric, fieldOfOutputMetric, metricOfField, STORED_METRICS } from '@common/v1/metrics';
import { metricValueOf, valueStateAt } from '@common/v1/value-age';

/**
 * The shapes every `/v1` answer is made of. They are small enough to read, and
 * each of them is the one place something is decided - so what is checked here
 * is that they are that one place: the pipe validates against the contract
 * itself rather than a copy, the cursor a page hands out is the cursor it takes
 * back, the age of a value comes from the shared constant, and a metric's field
 * name comes from the contract's table.
 */

const body = { kind: 'note', values: { kind: 'note' }, text: 'Topped the two in front.' };

const refusal = (value: unknown): ProblemException => {
  try {
    new ZodValidationPipe(entryCreate, 'problem').transform(value, { type: 'body' });
  } catch (error) {
    return error as ProblemException;
  }
  throw new Error('The body was accepted.');
};

describe('a body, against the contract itself', () => {
  it('takes what the contract describes', () => {
    expect(new ZodValidationPipe(entryCreate, 'problem').transform(body, { type: 'body' })).toMatchObject(body);
  });

  it('names the field that is wrong, as a problem document', () => {
    const error = refusal({ ...body, kind: 'water', values: { kind: 'water', litres: 'a canful' } });

    expect(error.problem.status).toBe(400);
    expect(error.problem.code).toBe('validation_failed');
    expect(error.problem.errors.map(issue => issue.field)).toContain('values.litres');
  });

  /**
   * The kinds a route writes are the kinds a person writes. A phase, a move and
   * a harvest are each the answer to their own route, and the diary is not a
   * second way to state one.
   */
  it('refuses a kind nobody logs by hand', () => {
    expect(refusal({ kind: 'phase', values: { kind: 'phase', phaseId: 'x', stage: 'flowering', preset: null } }).problem.status).toBe(400);
  });

  it('refuses what the contract does not describe at all', () => {
    expect(refusal({ text: 'no kind at all' }).problem.errors.length).toBeGreaterThan(0);
  });

  /**
   * One pipe checks bodies and query strings alike, and it stated the body for
   * both - so a GET that carries no body at all was refused with a sentence
   * about the body it never sent, while `errors[]` correctly named a query
   * parameter.
   */
  it('names the part of the request that did not fit, not always the body', () => {
    const bad = { ...body, kind: 'water', values: { kind: 'water', litres: 'a canful' } };
    const detailOf = (type: 'body' | 'query' | 'param'): string => {
      try {
        new ZodValidationPipe(entryCreate, 'problem').transform(bad, { type });
      } catch (error) {
        return (error as ProblemException).problem.detail;
      }
      throw new Error('The value was accepted.');
    };

    expect(detailOf('body')).toContain('request body');
    expect(detailOf('query')).toContain('query string');
    expect(detailOf('query')).not.toContain('body');
    expect(detailOf('param')).toContain('path');
  });
});

describe('a page', () => {
  const rows = [
    { id: 'a', at: new Date('2026-05-01T10:00:00.000Z') },
    { id: 'b', at: new Date('2026-05-01T09:00:00.000Z') },
    { id: 'c', at: new Date('2026-05-01T08:00:00.000Z') },
  ];

  it('hands out a cursor only while there is more', () => {
    expect(pageOf(rows, 2, row => row).nextCursor).not.toBeNull();
    expect(pageOf(rows, 3, row => row).nextCursor).toBeNull();
  });

  it('answers the rows asked for and not the one read to find out', () => {
    expect(pageOf(rows, 2, row => row).items.map(row => row.id)).toEqual(['a', 'b']);
  });

  it('continues after the row the cursor names, by the instant and by the id', () => {
    const cursor = pageOf(rows, 2, row => row).nextCursor;

    expect(afterCursor('occurredAt', cursor)).toEqual({
      $or: [{ occurredAt: { $lt: rows[1].at } }, { occurredAt: rows[1].at, id: { $lt: 'b' } }],
    });
  });

  it('filters nothing for the first page', () => {
    expect(afterCursor('occurredAt', null)).toEqual({});
  });

  it('refuses a cursor that came from somewhere else', () => {
    expect(() => afterCursor('occurredAt', 'not-a-cursor')).toThrow(ProblemException);
  });

  it('holds a page to one read', () => {
    expect(pageLimit(5000)).toBe(MAX_PAGE_LIMIT);
    expect(pageLimit(undefined)).toBeGreaterThan(0);
  });

  it('survives an id with the separator in it', () => {
    const position = { at: new Date('2026-05-01T10:00:00.000Z'), id: 'a|b' };
    expect(afterCursor('occurredAt', encodeCursor(position))).toMatchObject({
      $or: [{ occurredAt: { $lt: position.at } }, { occurredAt: position.at, id: { $lt: 'a|b' } }],
    });
  });
});

describe('the age of a value', () => {
  const now = new Date('2026-05-01T12:00:00.000Z');
  const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it.each([
    [0, 'live'],
    [119, 'live'],
    [120, 'stale'],
    [599, 'stale'],
    [600, 'offline'],
    [86_400, 'offline'],
  ])('is %i seconds old, which is %s', (seconds, state) => {
    expect(valueStateAt(secondsAgo(seconds), now)).toBe(state);
  });

  it('is offline when there has never been a value', () => {
    expect(valueStateAt(null, now)).toBe('offline');
    expect(metricValueOf(null, null, now)).toEqual({ value: null, measuredAt: null, state: 'offline' });
  });

  it('answers the instant as the contract carries it', () => {
    expect(metricValueOf(21.5, secondsAgo(10), now)).toEqual({
      value: 21.5,
      measuredAt: '2026-05-01T11:59:50.000Z',
      state: 'live',
    });
  });
});

describe('the metric names', () => {
  it('translates to what a device writes', () => {
    expect(fieldOfMetric('leafTemperature')).toBe('leaf_temperature');
    expect(fieldOfOutputMetric('fanInternal')).toBe('out_fan-internal');
  });

  it('translates back', () => {
    expect(metricOfField('leaf_temperature')).toBe('leafTemperature');
    expect(metricOfField('sensor_type')).toBeNull();
  });

  it('says which metrics have points behind them at all', () => {
    expect(fieldOfMetric('vpd')).toBeNull();
    expect(STORED_METRICS).not.toContain('vpd');
    expect(STORED_METRICS).toContain('temperature');
  });
});
