import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { livenessOf, sortedByAttention } from '@/screens/start/attention';
import { holdVerdictOf, judgedPanel, statusOf } from '@/screens/start/place';
import { groupedByRoom } from '@/screens/start/rooms';
import { ago, cardOf, setpoints, values } from './place-wire';
import { spaceWhere } from './session';

/**
 * What Start decides before it draws: the one sentence a place says, a
 * reading's verdict at the edge of its band and between day and night, which
 * place needs a person first, and which room its card stands under.
 */

describe('the sentence a place says', () => {
  const now = DateTime.now();
  const place = { values: values(), setpoints, deviceIds: ['device-1'], openAlerts: [], quiet: null };
  const alert = {
    alertId: 'a',
    kind: 'threshold' as const,
    severity: 'critical' as const,
    startedAt: ago(5),
    value: 31,
    metric: 'temperature' as const,
    name: 'Too warm',
  };
  const quiet = { until: ago(-10), alarmsUntil: ago(-20), parked: true };
  const hot = values().map(value => (value.metric === 'temperature' ? { ...value, value: 28 } : value));

  it('puts a silence before a maintenance window, that before an alarm, and an alarm before a reading off target', () => {
    expect(statusOf({ ...place, values: values(30), openAlerts: [alert], quiet }, now).kind).toBe('offline');
    expect(statusOf({ ...place, openAlerts: [alert], quiet }, now).kind).toBe('maintenance');
    expect(statusOf({ ...place, values: hot, openAlerts: [alert] }, now).kind).toBe('alert');
    // With no verdict at hand - a card among several - it cannot say since when, nor that it has only just begun.
    expect(statusOf({ ...place, values: hot }, now)).toEqual({ kind: 'off', metric: 'temperature', high: true, delta: 3 });
    // With the day's verdict and no open run in it, the reading has only just left the band.
    expect(statusOf({ ...place, values: hot, verdict: { metrics: [] } as never }, now)).toMatchObject({ kind: 'off', since: null });
    expect(statusOf(place, now).kind).toBe('good');
    expect(statusOf({ ...place, setpoints: [] }, now).kind).toBe('noTargets');
    expect(statusOf({ ...place, deviceIds: [] }, now).kind).toBe('none');
    // A camera that stopped is the one thing a place without a sensor has to report.
    expect(
      statusOf({ ...place, deviceIds: [], openAlerts: [{ ...alert, kind: 'camera_stale' as never, severity: 'warning' as const }] }, now).kind,
    ).toBe('alert');
    expect(statusOf({ ...place, values: [] }, now).kind).toBe('waiting');
  });

  it('says since when a reading is off, once the day´s verdict holds an open run outside the band', () => {
    // One instant, asked for once: the clock moves between two calls.
    const since = ago(40);
    const verdict = {
      metrics: [{ metric: 'temperature', excursions: [{ startedAt: since, endedAt: null, above: true, extremeValue: 28 }] }],
    } as never;
    expect(statusOf({ ...place, values: hot, verdict }, now)).toMatchObject({ kind: 'off', metric: 'temperature', since });
  });

  it('says control is switched off before any alarm or reading it explains, and after a silence or a maintenance window', () => {
    expect(statusOf({ ...place, values: hot, openAlerts: [alert], controlOff: true }, now).kind).toBe('controlOff');
    expect(statusOf({ ...place, quiet, controlOff: true }, now).kind).toBe('maintenance');
    expect(statusOf({ ...place, values: values(30), controlOff: true }, now).kind).toBe('offline');
  });

  it('counts a reading that is written as on the edge as in target, so the sentence does not flip on rounding', () => {
    const edge = values().map(value => (value.metric === 'temperature' ? { ...value, value: 26.04 } : value));
    expect(statusOf({ ...place, values: edge }, now).kind).toBe('good');
    const past = values().map(value => (value.metric === 'temperature' ? { ...value, value: 26.06 } : value));
    expect(statusOf({ ...place, values: past }, now)).toMatchObject({ kind: 'off', delta: 1.1 });
  });

  /** For the hour after a switch between day and night the server judges a reading by both halves' bands together. */
  it('is on target anywhere between the two bands while a device changes between day and night, and off it outside both', () => {
    const until = DateTime.now().plus({ minutes: 40 }).toISO()!;
    const changing: SpaceOverview['setpoints'] = [
      { metric: 'temperature', value: 21, band: 1, transition: { from: 'day', to: 'night', until, low: 20, high: 26 } },
      { metric: 'humidity', value: 60, band: 5 },
      { metric: 'co2', value: null, band: null, transition: { from: 'day', to: 'night', until, low: null, high: null } },
    ];
    const warm = (value: number) => values().map(one => (one.metric === 'temperature' ? { ...one, value } : one));

    expect(statusOf({ ...place, values: warm(24.6), setpoints: changing }, now).kind).toBe('good');
    expect(statusOf({ ...place, values: warm(27.5), setpoints: changing }, now)).toMatchObject({ kind: 'off', metric: 'temperature', high: true });
  });

  /** Nothing in the dark dries the box, so a humidity over what a humidifier holds is no verdict at all. */
  it('judges a humidity a humidifier holds from below alone, and says nothing of how long it has been under', () => {
    const hold = { target: 75, band: 5 };
    const reading = (value: number) => ({ metric: 'humidity' as const, value, measuredAt: ago(0.3), state: 'live' as const });
    expect(holdVerdictOf(reading(58), hold, now)).toEqual({ kind: 'low', delta: 17 });
    expect(holdVerdictOf(reading(71), hold, now)).toEqual({ kind: 'in' });
    expect(holdVerdictOf(reading(80), hold, now)).toEqual({ kind: 'in' });
    expect(holdVerdictOf(reading(88), hold, now)).toBeNull();

    const germinating = [{ metric: 'temperature' as const, value: 25, band: 1 }];
    const dry = values().map(value => (value.metric === 'humidity' ? { ...value, value: 58 } : value));
    const judged = { ...place, values: dry, setpoints: germinating, verdict: { metrics: [] } as never };
    expect(statusOf(judged, now).kind).toBe('good');
    expect(statusOf({ ...judged, humidifierHold: hold }, now)).toEqual({ kind: 'off', metric: 'humidity', high: false, delta: 17 });
  });
});

describe('the band behind a day´s curve', () => {
  it('is the record the sentence is judged by, and borrows today´s targets only where the record has none', () => {
    const recorded = {
      metric: 'humidity' as const,
      points: [],
      targets: [
        {
          startsAt: ago(3000),
          endsAt: ago(0),
          phaseId: 'phase-1',
          stage: 'vegetative' as const,
          day: { setpoint: 62, band: { low: 57, high: 67 } },
          night: { setpoint: 58, band: { low: 53, high: 63 } },
          held: 'schedule' as const,
        },
      ],
    };
    const today = { day: [{ metric: 'humidity' as const, value: 62, band: 5 }], night: [{ metric: 'humidity' as const, value: 58, band: 5 }] };
    const [from, to] = [ago(1440), ago(0)];

    expect(judgedPanel(recorded, today, from, to)).toBe(recorded);
    const bare = { ...recorded, targets: [] };
    expect(judgedPanel(bare, today, from, to)?.targets).toEqual([
      {
        startsAt: from,
        endsAt: to,
        phaseId: null,
        stage: null,
        day: { setpoint: 62, band: { low: 57, high: 67 } },
        night: { setpoint: 58, band: { low: 53, high: 63 } },
      },
    ]);
    // A place that holds no targets keeps whatever the Timeline drew.
    expect(judgedPanel(bare, null, from, to)).toBe(bare);
    expect(judgedPanel(bare, { day: [], night: [] }, from, to)).toBe(bare);
  });
});

describe('which place needs a person first', () => {
  const alert = {
    alertId: 'a',
    kind: 'threshold' as const,
    severity: 'warning' as const,
    startedAt: ago(5),
    value: 31,
    metric: 'temperature' as const,
    name: 'Too warm',
  };
  const task = {
    id: 'task-1',
    kind: 'water' as const,
    label: 'Water',
    dueAt: ago(5),
    subject: { type: 'space' as const, id: 'b' },
    assigneeId: null,
  };

  it('orders the cards by an alarm, then something due, then silence, and keeps the rest in the order given', () => {
    const cards = [
      cardOf({ spaceId: 'a', name: 'Fine' }),
      cardOf({ spaceId: 'b', name: 'Due', dueTasks: [task] }),
      cardOf({ spaceId: 'c', name: 'Silent', values: values(30) }),
      cardOf({ spaceId: 'd', name: 'Alarm', openAlerts: [alert] }),
      cardOf({ spaceId: 'e', name: 'Fine too' }),
    ];

    expect(sortedByAttention(cards).map(card => card.name)).toEqual(['Alarm', 'Due', 'Silent', 'Fine', 'Fine too']);
  });

  it('gathers the places of a room under its name, where its most urgent place stood, and leaves a room the reader cannot see ungrouped', () => {
    const spaces = [spaceWhere('own', { id: 'room', name: 'Cellar', kind: 'room' })];
    const cards = [
      cardOf({ spaceId: 'a', name: 'Tent', roomId: 'room' }),
      cardOf({ spaceId: 'b', name: 'Balcony' }),
      cardOf({ spaceId: 'c', name: 'Fridge', roomId: 'room' }),
      cardOf({ spaceId: 'd', name: 'Shared tent', roomId: 'somebody-elses-room' }),
    ];

    expect(groupedByRoom(cards, spaces).map(group => [group.room?.name ?? null, group.cards.map(card => card.name)])).toEqual([
      ['Cellar', ['Tent', 'Fridge']],
      [null, ['Balcony']],
      [null, ['Shared tent']],
    ]);
  });
});

describe('how alive a place is', () => {
  it('is the best of its values, offline for a device that has said nothing, and nothing at all without a device', () => {
    const live = values();
    const mixed = [live[0], { ...live[1], measuredAt: ago(30), state: 'offline' as const }];

    expect(livenessOf({ values: mixed, deviceIds: ['device-1'] })).toBe('live');
    expect(livenessOf({ values: [], deviceIds: ['device-1'] })).toBe('offline');
    expect(livenessOf({ values: [], deviceIds: [] })).toBe('none');
    // A shared read is not told what stands there: some values mean something reports, none means nothing to show.
    expect(livenessOf({ values: [], deviceIds: null })).toBe('none');
  });

  it('falls with the values when a card has gone on being drawn without a new answer', () => {
    const drawn = values();
    expect(livenessOf({ values: drawn, deviceIds: ['device-1'] }, DateTime.now())).toBe('live');
    expect(livenessOf({ values: drawn, deviceIds: ['device-1'] }, DateTime.now().plus({ minutes: 5 }))).toBe('stale');
    expect(livenessOf({ values: drawn, deviceIds: ['device-1'] }, DateTime.now().plus({ minutes: 30 }))).toBe('offline');
  });
});
