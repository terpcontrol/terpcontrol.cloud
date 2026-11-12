import type { ChartView } from '@fg2/shared-types/v1';
import { hashKey } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { timelineKey } from '@/api/timeline';
import {
  appliedOf,
  askOf,
  chipOf,
  dayHolding,
  definitionOf,
  nextWidth,
  selected,
  stepped,
  viewOf,
  viewParams,
  windowOf,
  withParams,
  zoomed,
  type View,
} from '@/screens/timeline/view';

/**
 * Verlauf's view is its address. What is asserted here is that arithmetic: an
 * address read back gives the view that wrote it, a moment however old gets its
 * own day, the arrows and the zoom never run past now, and the cursor keeps its
 * instant through a zoom.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-12T14:30:00.000Z');

const read = (address: string): View => viewOf(new URLSearchParams(address));
const written = (over: Partial<View>): string => decodeURIComponent(withParams(new URLSearchParams(), viewParams(over)).toString());

describe('the view an address names', () => {
  it('is the last 24 hours with nothing set where the address says nothing', () => {
    expect(read('')).toEqual({
      range: '24h',
      fixed: null,
      last: null,
      at: null,
      growId: null,
      deviceId: null,
      show: null,
      one: false,
      stepSeconds: null,
      vpdHalf: 'all',
      compare: null,
      focus: null,
    });
  });

  it('reads back what it writes: window, cursor, curves, step, comparison', () => {
    const view: Partial<View> = {
      range: 'grow',
      fixed: { from: NOW - 3 * HOUR, to: NOW - 2 * HOUR },
      at: NOW - 2.5 * HOUR,
      growId: 'grow-1',
      deviceId: 'device-2',
      show: ['temperature', 'vpd', 'm.runoff', 'light'],
      one: true,
      stepSeconds: 60,
      vpdHalf: 'night',
      compare: { kind: 'grow', id: 'grow-0' },
      focus: 'vpd',
    };

    expect(read(withParams(new URLSearchParams(), viewParams(view)).toString())).toEqual({ ...read(''), ...view, last: null });
  });

  it('writes a default as no parameter at all, and takes one away again', () => {
    expect(written({ range: '24h', one: false, stepSeconds: null, vpdHalf: 'all', at: null })).toBe('');
    expect(withParams(new URLSearchParams('at=2026-11-12T02:10:40.000Z&show=vpd'), viewParams({ at: null })).toString()).toBe('show=vpd');
    expect(written({ last: 20 * MINUTE })).toBe('last=1200');
  });

  it('reads nonsense as nothing: a window backwards, a width no zoom reaches, a step finer than a device reports', () => {
    expect(read('from=2026-11-12T10:00:00Z&to=2026-11-12T09:00:00Z').fixed).toBeNull();
    expect(read('last=3').last).toBeNull();
    expect(read('step=1').stepSeconds).toBeNull();
    expect(read('range=1y').range).toBe('24h');
    expect(read('compare=nobody').compare).toBeNull();
  });
});

describe('the window a view comes to', () => {
  it('ends now and follows it for a chip and for a width of the zoom', () => {
    expect(windowOf(read('range=7d'), NOW)).toEqual({ from: NOW - 7 * DAY, to: NOW, live: true });
    expect(windowOf(read('last=1200'), NOW)).toEqual({ from: NOW - 20 * MINUTE, to: NOW, live: true });
  });

  it('stands still where it was stepped back to or zoomed into', () => {
    expect(windowOf(read('from=2026-11-12T02:00:00Z&to=2026-11-12T02:20:00Z'), NOW)).toEqual({
      from: Date.parse('2026-11-12T02:00:00Z'),
      to: Date.parse('2026-11-12T02:20:00Z'),
      live: false,
    });
  });

  it('is only known by its answer for a stretch of a grow', () => {
    expect(windowOf(read('range=phase&grow=grow-1'), NOW)).toBeNull();
  });

  // A diary line from four months back used to land on the grow's whole stretch, and one from 40 days back on the wrong date.
  it('gives a moment the chip does not reach its own day around it, however old', () => {
    const old = NOW - 131 * DAY;
    expect(windowOf(read(`at=${new Date(old).toISOString()}&grow=grow-1`), NOW)).toEqual({ from: old - 12 * HOUR, to: old + 12 * HOUR, live: false });
    // Within the chip's reach the last day holds it, and keeps following now.
    expect(windowOf(read(`at=${new Date(NOW - 5 * HOUR).toISOString()}`), NOW)).toEqual({ from: NOW - DAY, to: NOW, live: true });
  });
});

describe('what the server is asked', () => {
  it('asks a chip by its name, so Start and Verlauf share the answer, and any other window by its two ends', () => {
    expect(askOf(read(''), windowOf(read(''), NOW))).toMatchObject({ range: '24h', growId: null, follows: true });
    expect(askOf(read(''), windowOf(read(''), NOW))).not.toHaveProperty('from');

    const zoomedIn = read('from=2026-11-12T02:00:00Z&to=2026-11-12T02:20:00Z&grow=grow-1&step=5&device=device-2');
    expect(askOf(zoomedIn, windowOf(zoomedIn, NOW), 'token')).toEqual({
      range: '24h',
      growId: 'grow-1',
      from: '2026-11-12T02:00:00.000Z',
      to: '2026-11-12T02:20:00.000Z',
      stepSeconds: 5,
      deviceId: 'device-2',
      share: 'token',
      follows: false,
    });
  });

  it('asks a stretch of a grow with its grow, and reads one that names none as the last day', () => {
    expect(askOf(read('range=grow&grow=grow-1'), null)).toMatchObject({ range: 'grow', growId: 'grow-1', follows: false });
    expect(askOf(read('range=grow'), null)).toMatchObject({ range: '24h', growId: null });
  });
});

describe('the answer two screens share', () => {
  it('is kept under one key by Start, which asks for the last day, and by Verlauf as it opens', () => {
    const opened = askOf(read(''), windowOf(read(''), NOW));

    expect(hashKey(timelineKey('space-1', opened))).toBe(hashKey(timelineKey('space-1', { range: '24h' })));
    // Any other window, step or device is an answer of its own.
    expect(hashKey(timelineKey('space-1', askOf(read('step=60'), windowOf(read('step=60'), NOW))))).not.toBe(hashKey(timelineKey('space-1', opened)));
  });
});

describe('the chip that is lit', () => {
  it('is the view`s own until something moved the window, then the one of the same width, else none', () => {
    const lit = (address: string) => chipOf(read(address), windowOf(read(address), NOW));

    expect(lit('range=7d')).toBe('7d');
    expect(lit('range=grow&grow=grow-1')).toBe('grow');
    // A day stepped back to is still a day.
    expect(lit('from=2026-11-10T14:30:00Z&to=2026-11-11T14:30:00Z')).toBe('24h');
    expect(lit('from=2026-11-12T02:00:00Z&to=2026-11-12T02:20:00Z')).toBeNull();
    expect(lit('last=1200')).toBeNull();
  });
});

describe('the arrows', () => {
  const day = { from: NOW - DAY, to: NOW };

  it('step back by the window`s own width, and forward never past now', () => {
    expect(stepped(day, -1, NOW)).toEqual({ fixed: { from: NOW - 2 * DAY, to: NOW - DAY }, last: null, at: null });
    // Back at now the window follows it again, as the chip it is.
    expect(stepped({ from: NOW - 2 * DAY, to: NOW - DAY }, 1, NOW)).toEqual({ fixed: null, last: null, range: '24h', at: null });
    expect(stepped({ from: NOW - 50 * MINUTE, to: NOW - 30 * MINUTE }, 1, NOW)).toMatchObject({
      fixed: { from: NOW - 30 * MINUTE, to: NOW - 10 * MINUTE },
    });
    expect(stepped({ from: NOW - 30 * MINUTE, to: NOW - 10 * MINUTE }, 1, NOW)).toEqual({ fixed: null, last: 20 * MINUTE, at: null });
  });
});

describe('the zoom', () => {
  it('steps through the ladder: a day, six hours, ninety minutes, twenty, five - and three taps reach every sample', () => {
    expect([DAY, 6 * HOUR, 90 * MINUTE, 20 * MINUTE].map(width => nextWidth(width, 1))).toEqual([6 * HOUR, 90 * MINUTE, 20 * MINUTE, 5 * MINUTE]);
    expect(nextWidth(5 * MINUTE, 1)).toBeNull();
    expect(nextWidth(DAY, -1)).toBe(3 * DAY);
    expect(nextWidth(3 * 365 * DAY, -1)).toBeNull();
    // A width nobody chose from the ladder finds its way back onto it.
    expect(nextWidth(47 * MINUTE, 1)).toBe(20 * MINUTE);
  });

  it('keeps the cursor on its instant and at its place on the screen', () => {
    const cursor = NOW - 11 * HOUR - 20 * MINUTE;
    const next = zoomed({ from: NOW - DAY, to: NOW, live: true }, cursor, 1, NOW)!;

    expect(next.at).toBe(cursor);
    expect(next.fixed!.to - next.fixed!.from).toBe(6 * HOUR);
    expect((cursor - next.fixed!.from) / (6 * HOUR)).toBeCloseTo((cursor - (NOW - DAY)) / DAY, 6);
  });

  it('stays at now, following it, while the cursor rests there', () => {
    expect(zoomed({ from: NOW - DAY, to: NOW, live: true }, null, 1, NOW)).toEqual({ fixed: null, last: 6 * HOUR, at: null });
    expect(zoomed({ from: NOW - 6 * HOUR, to: NOW, live: true }, null, -1, NOW)).toEqual({ fixed: null, last: null, range: '24h', at: null });
  });

  it('never reaches past now, and goes no further than the ladder', () => {
    const cursor = NOW - 10 * MINUTE;
    expect(zoomed({ from: NOW - 20 * MINUTE, to: NOW, live: true }, cursor, -1, NOW)).toEqual({ fixed: null, last: 90 * MINUTE, at: cursor });
    expect(zoomed({ from: NOW - 5 * MINUTE, to: NOW, live: true }, null, 1, NOW)).toBeNull();
  });

  it('holds still the spot a wheel was turned over, and leaves the cursor where it stands', () => {
    const spot = NOW - 6 * HOUR;
    const next = zoomed({ from: NOW - DAY, to: NOW, live: true }, null, 1, NOW, spot)!;

    expect(next.at).toBeNull();
    expect((spot - next.fixed!.from) / (6 * HOUR)).toBeCloseTo(0.75, 6);
  });

  it('makes a stretch marked or pinched to the window: no narrower than five minutes, never past now', () => {
    const day = { from: NOW - DAY, to: NOW };
    expect(selected(day, { from: 0.25, to: 0.5 }, null, NOW)).toEqual({
      fixed: { from: NOW - 18 * HOUR, to: NOW - 12 * HOUR },
      last: null,
      at: null,
    });
    const narrow = selected(day, { from: 0.5, to: 0.5005 }, null, NOW);
    expect(narrow.fixed!.to - narrow.fixed!.from).toBe(5 * MINUTE);
    // Two fingers drawn together reach past both ends: three days up to now.
    expect(selected(day, { from: -1, to: 2 }, NOW - HOUR, NOW)).toEqual({ fixed: null, last: 3 * DAY, at: NOW - HOUR });
  });
});

describe('a day of the calendar', () => {
  it('is that date where the reader`s clock is, and today is left to the last 24 hours', () => {
    const noon = Date.parse('2026-11-05T11:00:00.000Z');
    expect(dayHolding(noon, 'Europe/Berlin', NOW)).toEqual({
      from: Date.parse('2026-11-04T23:00:00.000Z'),
      to: Date.parse('2026-11-05T23:00:00.000Z'),
    });
    expect(dayHolding(NOW - HOUR, 'Europe/Berlin', NOW)).toBeNull();
  });
});

describe('a view kept in the account', () => {
  const drawn = {
    metrics: ['temperature', 'vpd'] as const,
    measurements: ['runoff'],
    outputs: ['light', 'heater'] as const,
    deviceIds: ['device-1'],
    growId: 'grow-1',
  };
  const kept = (view: View): ChartView => ({
    id: 'view-1',
    createdAt: '2026-11-12T00:00:00.000Z',
    ownerId: 'user-1',
    name: 'Flowering nights',
    definition: definitionOf(view, { ...drawn, metrics: [...drawn.metrics], outputs: [...drawn.outputs] }),
  });

  it('keeps the question - curves, stretch, step, one picture - and opens on it again', () => {
    const view = read('range=7d&one=1&step=600');
    const again = appliedOf(kept(view), 'grow-1');

    expect(kept(view).definition).toMatchObject({ span: { kind: 'last', forSeconds: 7 * 24 * 3600 }, layout: 'overlay', intervalSeconds: 600 });
    expect(again).toMatchObject({ range: '7d', fixed: null, last: null, one: true, stepSeconds: 600, at: null });
    expect(again.show).toEqual(['temperature', 'vpd', 'm.runoff', 'light', 'outputs', 'diary', 'machine']);
  });

  it('keeps a window that stands still as its two ends, and a grow`s stretch as that stretch', () => {
    const still = read('from=2026-11-12T02:00:00Z&to=2026-11-12T02:20:00Z');
    expect(appliedOf(kept(still), null).fixed).toEqual(still.fixed);
    expect(appliedOf(kept(read('range=phase&grow=grow-1')), 'grow-2')).toMatchObject({ range: 'phase', growId: 'grow-2' });
    // A place nothing grows in has no phase to open: the last day instead.
    expect(appliedOf(kept(read('range=phase&grow=grow-1')), null)).toMatchObject({ range: '24h', growId: null });
  });
});
