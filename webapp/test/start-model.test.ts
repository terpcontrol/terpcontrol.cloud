import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { Device, SpaceOverview } from '@fg2/shared-types/v1';
import { firstChoice, type PlaceCard } from '@/app/places';
import { fetchedAt } from '@/api/clock';
import { livenessOf, livenessThrough, sortedByAttention } from '@/screens/start/attention';
import { worstFirst } from '@/screens/alerts/inbox';
import { contradictedModeOf, holdVerdictOf, judgedPanel, placeAlerts, statusOf, statusText, toneOf } from '@/screens/start/place';
import { groupedByRoom, startOrder } from '@/screens/start/rooms';
import { ago, cardOf, growOf, setpoints, values } from './place-wire';
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

  /**
   * A tent with a controller that reports and a fridge module gone silent: Meldungen leads with the silence, and
   * Start said "online" and named the warning beside it. One order for both, from the same alerts.
   */
  it('names the alert Meldungen leads with, the silent device among it, and counts the rest', () => {
    const open = [
      { ...alert, alertId: 'mould', severity: 'warning' as const, name: 'Mould watch', deviceId: 'device-1' },
      { ...alert, alertId: 'silent', kind: 'offline' as const, metric: 'offline' as const, value: 1800, name: null, deviceId: 'device-2' },
      { ...alert, alertId: 'fridge-warm', startedAt: ago(1), deviceId: 'device-2' },
      { ...alert, alertId: 'hot', startedAt: ago(9), deviceId: 'device-1' },
    ];
    const inbox = open.map(({ alertId, ...one }) => ({ ...one, id: alertId }));
    const device = (id: string, lastSeenAt: string) => ({ id, state: { lastSeenAt } }) as Device;
    const here = [device('device-1', ago(0)), device('device-2', ago(35))];
    const listed = open.map(({ deviceId: _, ...one }) => one);

    // Critical before warning; the silence before the reading of the device gone silent, which is an old one.
    expect(worstFirst(inbox).map(one => one.id)).toEqual(['silent', 'hot', 'mould', 'fridge-warm']);
    const status = statusOf({ ...place, openAlerts: placeAlerts(listed, inbox as never, here, now) }, now);
    expect(status).toMatchObject({ kind: 'alert', alert: { alertId: 'silent', device: { id: 'device-2' } }, more: 3 });

    // A status that outranks the alert sentence - the place's own silence, maintenance, regulation off - counts them all behind it.
    const silent = { ...place, values: [], silentSince: ago(35), openAlerts: placeAlerts(listed, inbox as never, here, now) };
    expect(statusOf(silent, now)).toMatchObject({ kind: 'offline', more: 4 });
    // The silence of the device the place is judged by is the place's own, said by the pill and the box, and is not counted.
    expect(statusOf({ ...silent, leadId: 'device-2' }, now)).toMatchObject({ kind: 'offline', more: 3 });
    // The catalogue's sentences are not this suite's business: a key stands for its sentence, the count for itself.
    // After an alert's own sentence the rest is "+3"; after any other status it is said in words, never a lone "+4".
    const t = ((key: string, said?: { count?: number }) => (said?.count === undefined ? key : `${key}:${said.count}`)) as never;
    expect(statusText(t, status, now, 'UTC')).toMatch(/ · start\.status\.more:3$/);
    const off = statusOf({ ...place, controlOff: true, openAlerts: placeAlerts(listed, inbox as never, here, now) }, now);
    expect(off).toMatchObject({ kind: 'controlOff', more: 4, critical: true });
    expect(statusText(t, off, now, 'UTC')).toBe('start.status.controlOff · start.status.open:4');
    expect(statusText(t, off, now, 'UTC', false)).toBe('start.status.controlOff');
    expect(statusText(t, statusOf({ ...place, controlOff: true }, now), now, 'UTC')).toBe('start.status.controlOff');
    // Whether one of what is open is critical: the warning about mould alone is not.
    const mild = placeAlerts([listed[0]], inbox as never, here, now);
    expect(statusOf({ ...place, controlOff: true, openAlerts: mild }, now)).toMatchObject({ more: 1, critical: false });

    // Without the account's list - the demo - no device is known: the place's own silence is the pill's to say, and no other is named.
    expect(statusOf({ ...place, openAlerts: placeAlerts(listed, undefined, here, now) }, now)).toMatchObject({
      alert: { alertId: 'fridge-warm' },
      more: 2,
    });
    // A device heard again waits for its alert to close and is not called offline meanwhile; its reading is about now again.
    const back = [here[0], device('device-2', ago(0))];
    expect(statusOf({ ...place, openAlerts: placeAlerts(listed, inbox as never, back, now) }, now)).toMatchObject({
      alert: { alertId: 'fridge-warm' },
      more: 2,
    });
  });

  it('says since when a reading is off, once the day´s verdict holds an open run outside the band', () => {
    // One instant, asked for once: the clock moves between two calls.
    const since = ago(40);
    const verdict = {
      metrics: [{ metric: 'temperature', excursions: [{ startedAt: since, endedAt: null, above: true, extremeValue: 28 }] }],
    } as never;
    expect(statusOf({ ...place, values: hot, verdict }, now)).toMatchObject({ kind: 'off', metric: 'temperature', since });
  });

  /** Regulation off is never hidden: not by maintenance, nor by the ten minutes the alarms rest after it. */
  it('says control is switched off before any alarm, reading or maintenance window, and after a silence', () => {
    expect(statusOf({ ...place, values: hot, openAlerts: [alert], controlOff: true }, now).kind).toBe('controlOff');
    expect(statusOf({ ...place, quiet, controlOff: true }, now).kind).toBe('controlOff');
    expect(statusOf({ ...place, quiet: { ...quiet, parked: false }, controlOff: true }, now).kind).toBe('controlOff');
    expect(statusOf({ ...place, values: values(30), controlOff: true }, now).kind).toBe('offline');
  });

  /** "Alles im Ziel" in green over a tent left drying under a grow in flower denied what the tent was doing. */
  it('says a work mode the grow´s phase contradicts where it would say all is on target, and in the warning´s tone', () => {
    const control = (drying: boolean, mode: string) => ({ id: 'device-1', control: { running: true, drying, mode } }) as unknown as Device;
    const drying = contradictedModeOf(control(true, 'standard'), 'flowering');
    expect(drying).toEqual({ mode: 'drying', stage: 'flowering' });
    expect(contradictedModeOf(control(false, 'germination'), 'seedling')).toEqual({ mode: 'germination', stage: 'seedling' });
    // Nothing to contradict: the grow is in that phase, has none, or the device runs its day.
    expect(contradictedModeOf(control(true, 'standard'), 'drying')).toBeNull();
    expect(contradictedModeOf(control(true, 'standard'), null)).toBeNull();
    expect(contradictedModeOf(control(false, 'standard'), 'flowering')).toBeNull();
    expect(
      contradictedModeOf({ ...control(true, 'standard'), control: { running: false, drying: true, mode: 'standard' } } as never, 'flowering'),
    ).toBeNull();

    const status = statusOf({ ...place, mode: drying }, now);
    expect(status).toEqual({ kind: 'mode', mode: 'drying', stage: 'flowering' });
    expect(toneOf(status)).toBe('warn');
    // A reading off its target or an alarm is still said first; the mode is said where "all on target" would be.
    expect(statusOf({ ...place, values: hot, mode: drying }, now).kind).toBe('off');
  });

  it('draws maintenance quietly: the control that runs it is the one warning on the page', () => {
    expect(toneOf(statusOf({ ...place, quiet }, now))).toBe('quiet');
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

    expect(sortedByAttention(cards, new Set(['b'])).map(card => card.name)).toEqual(['Alarm', 'Due', 'Silent', 'Fine', 'Fine too']);
    // What the home says is due somewhere moves nothing: the card's own count is the reader's list, and so is its rank.
    expect(sortedByAttention(cards).map(card => card.name)).toEqual(['Alarm', 'Silent', 'Fine', 'Due', 'Fine too']);
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

/**
 * The place a browser that has chosen none is shown must be one Start shows
 * near its top: Grow opened on an empty balcony under a header naming it, while
 * Start led with the tent in flower.
 */
describe('the place Grow, Verlauf and Steuerung open on before one is chosen', () => {
  const place = (over: Parameters<typeof cardOf>[0]) => cardOf({ grow: null, deviceIds: [], ...over }) as PlaceCard;
  const running = growOf() as never;
  const cellar = [spaceWhere('own', { id: 'room', name: 'Cellar', kind: 'room' })];
  const alert = {
    alertId: 'a',
    kind: 'threshold' as const,
    severity: 'warning' as const,
    startedAt: ago(5),
    value: 31,
    metric: 'temperature' as const,
    name: 'Too warm',
  };

  it('is the first in the order Start lists them that has a running grow', () => {
    const places = [
      place({ spaceId: 'balcony', name: 'Balcony' }),
      place({ spaceId: 'fridge', name: 'Fridge', deviceIds: ['device-2'] }),
      place({ spaceId: 'tent', name: 'Tent', grow: running }),
      place({ spaceId: 'second', name: 'Second tent', grow: running, deviceIds: ['device-1'] }),
    ];

    expect(firstChoice(places, [])?.name).toBe('Tent');
  });

  it('follows Start´s order and not the home´s: a room stands where its most urgent place does', () => {
    const places = [
      place({ spaceId: 'a', name: 'Balcony grow', grow: running }),
      place({ spaceId: 'b', name: 'Cellar tent', roomId: 'room', grow: running }),
      place({ spaceId: 'c', name: 'Cellar fridge', roomId: 'room', deviceIds: ['device-1'], openAlerts: [alert] }),
    ];

    // The fridge's alarm lifts its room to the top, and the tent beside it is the first there that grows.
    expect(startOrder(places, cellar).flatMap(group => group.cards.map(card => card.name))).toEqual(['Cellar fridge', 'Cellar tent', 'Balcony grow']);
    expect(firstChoice(places, cellar)?.name).toBe('Cellar tent');
  });

  it('is the first with a device where nothing grows, and the first of all where nothing regulates either', () => {
    const empty = [place({ spaceId: 'a', name: 'Balcony' }), place({ spaceId: 'b', name: 'Shelf' })];

    expect(firstChoice([...empty, place({ spaceId: 'c', name: 'Fridge', deviceIds: ['device-1'] })], [])?.name).toBe('Fridge');
    expect(firstChoice(empty, [])?.name).toBe('Balcony');
    expect(firstChoice([], [])).toBeNull();
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

  /** The page ages because this browser could not ask - which the notice beside it says - and not because a device fell silent. */
  it('does not call a device offline for a refresh that failed: what was heard at the last answer is stale, and no more', () => {
    const card = { values: values(), deviceIds: ['device-1'] };
    const later = DateTime.now().plus({ minutes: 30 });
    const failedAt = Date.now();

    expect(livenessThrough(card, later, null)).toBe('offline');
    expect(livenessThrough(card, later, failedAt)).toBe('stale');
    // A reading still fresh is not called old because one refresh failed.
    expect(livenessThrough(card, DateTime.now().plus({ seconds: 30 }), failedAt)).toBe('live');
    // A device that was silent before the refresh failed is still silent.
    expect(livenessThrough({ values: values(30), deviceIds: ['device-1'] }, later, failedAt)).toBe('offline');
    expect(DateTime.fromISO(fetchedAt(failedAt)).toMillis()).toBeLessThan(later.toMillis());
  });
});
