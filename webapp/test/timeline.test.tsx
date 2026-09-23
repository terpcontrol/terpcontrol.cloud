import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { LogProvider } from '@/log/LogProvider';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, SpaceTimeline } from '@fg2/shared-types/v1';
import { Timeline } from '@/screens/timeline/Timeline';
import { figure, targetFigure } from '@/screens/home/units';
import { scaleOf, stretchesOf } from '@/screens/timeline/window';

const state = vi.hoisted(() => ({ answer: null as SpaceTimeline | null }));

// The one read the screen is made of, and the grow the subject line names.
vi.mock('@/api/timeline', async importOriginal => ({
  ...(await importOriginal<object>()),
  useTimeline: () => ({ data: state.answer, isPending: false, isError: false, dataUpdatedAt: 1, refetch: () => {} }),
}));

vi.mock('@/api/grows', () => ({ useGrow: () => ({ data: { id: 'grow-1', name: 'Spring run' } }) }));

// A chart is a canvas, which jsdom has not got. What it draws is checked by the
// unit tests below; what the screen does with the cursor is checked around it.
vi.mock('@/charts/Chart', () => ({ Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/**
 * The Timeline is one window seen six ways, moved by one cursor: the frame
 * above the panels, the curves with the band that applied, the lanes and the
 * rail. What it must get right is that they all say the same moment - and that
 * a screen which may only be looked at offers nothing that writes.
 */

const FROM = DateTime.fromISO('2026-09-18T00:00:00.000Z');
const TO = FROM.plus({ hours: 24 });
const at = (hour: number) => FROM.plus({ hours: hour }).toISO()!;
const clock = (hour: number) => FROM.plus({ hours: hour }).toFormat('HH:mm');
const stamp = (hour: number) => FROM.plus({ hours: hour }).toFormat('ccc HH:mm');

const entry = (id: string, hour: number, kind: Entry['kind'], text: string): Entry => ({
  id,
  createdAt: at(hour),
  kind,
  occurredAt: at(hour),
  source: 'human',
  authorId: 'user-1',
  growId: 'grow-1',
  spaceId: 'space-1',
  deviceId: null,
  plantIds: [],
  cameraId: null,
  taskId: null,
  alertId: null,
  severity: null,
  text,
  message: null,
  values: { kind: kind as 'note' },
  mediaIds: [],
  undoUntil: null,
});

/** A day: dark until 06:00, warm and lit afterwards, aimed at 26 by day and 21 by night. */
const answer: SpaceTimeline = {
  spaceId: 'space-1',
  name: 'Tent 1',
  kind: 'tent',
  range: '24h',
  growId: 'grow-1',
  dayFrom: 34,
  dayTo: 34,
  startsAt: FROM.toISO()!,
  endsAt: TO.toISO()!,
  stepSeconds: 3600,
  deviceIds: ['device-1'],
  lastReadingAt: null,
  panels: [
    {
      metric: 'temperature',
      points: Array.from({ length: 24 }, (_, hour) => ({ measuredAt: at(hour), value: hour < 6 ? 21 : 26 })),
      targets: [
        {
          startsAt: FROM.toISO()!,
          endsAt: TO.toISO()!,
          phaseId: 'phase-1',
          stage: 'flowering',
          day: { setpoint: 26, band: { low: 25, high: 27 } },
          night: { setpoint: 21, band: { low: 20, high: 22 } },
        },
      ],
    },
    {
      metric: 'humidity',
      points: Array.from({ length: 24 }, (_, hour) => ({ measuredAt: at(hour), value: hour < 6 ? 58 : 62 })),
      targets: [
        {
          startsAt: FROM.toISO()!,
          endsAt: TO.toISO()!,
          phaseId: 'phase-1',
          stage: 'flowering',
          day: { setpoint: 62, band: { low: 57, high: 67 } },
          night: { setpoint: 58, band: { low: 53, high: 63 } },
        },
      ],
    },
  ],
  nights: [{ startsAt: FROM.toISO()!, endsAt: at(6) }],
  alarms: [
    {
      alertId: 'alert-1',
      kind: 'threshold',
      severity: 'warning',
      metric: 'temperature',
      startedAt: at(13),
      endedAt: at(14),
      value: 31,
      extremeValue: 31,
    },
  ],
  outputs: [
    { output: 'light', deviceId: 'device-1', spans: [{ startsAt: at(6), endsAt: at(24) }], heardUntil: at(24) },
    { output: 'heater', deviceId: 'device-1', spans: [{ startsAt: at(2), endsAt: at(3) }], heardUntil: at(24) },
  ],
  events: [entry('e1', 3, 'note', 'Checked the trim'), entry('e2', 16, 'water', 'Watered'), entry('e3', 16.2, 'measurement', 'Measured')],
  cameras: [
    {
      cameraId: 'cam-1',
      name: 'Canopy cam',
      frames: [
        { mediaId: 'media-early', capturedAt: at(2) },
        { mediaId: 'media-late', capturedAt: at(20) },
      ],
    },
  ],
  machineEvents: { shown: 0, total: 0 },
  grows: [{ growId: 'grow-1', name: 'Spring run', startedAt: FROM.minus({ days: 34 }).toISO()!, endedAt: null }],
  readingNames: [{ growId: 'grow-1', readings: [{ key: 'height', name: 'Height', unit: 'cm' }] }],
  people: [{ id: 'user-1', handle: 'you' }],
};

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        {/* The rail opens a line to be corrected, which is the shell's sheet. */}
        <LogProvider>
          <Timeline spaceId="space-1" />
        </LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The scrubber is what a thumb has, so the tests move the cursor the way a thumb does. */
const scrubTo = (hour: number) =>
  fireEvent.change(screen.getByLabelText('Move the cursor through the window'), { target: { value: String(FROM.plus({ hours: hour }).toMillis()) } });

const header = () => screen.getByRole('status');

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  state.answer = answer;
});

describe('the timeline', () => {
  it('stacks a panel per metric that is measured, and none for one that is not', () => {
    draw();

    expect(screen.getByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('Humidity')).toBeInTheDocument();
    expect(screen.queryByText('CO₂')).not.toBeInTheDocument();
    expect(screen.getByText('Spring run')).toBeInTheDocument();
    expect(screen.getByText('day 34')).toBeInTheDocument();
  });

  /**
   * Six chips do not fit a phone, so the row that holds them scrolls sideways
   * with nothing on screen to say that it does. Anything parked past its end is
   * therefore out of reach in practice, and the range is the only thing on this
   * screen that names the window the panels and their "nothing heard in this
   * window" line are about.
   */
  it('keeps the range out of the row the chips scroll in', () => {
    draw();

    const chips = screen.getByRole('group', { name: 'Range' });
    expect(chips).toContainElement(screen.getByRole('button', { name: '24 h' }));
    expect(chips).not.toContainElement(screen.getByText('day 34'));
  });

  it('moves every part of the window with one cursor, into a header that stays put', () => {
    draw();

    // The end of the window: light on, the day's band, the newest picture.
    expect(header()).toHaveTextContent(`${clock(24)}26.0 °C62 %Light on`);
    expect(screen.getByText(/band 25–27/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Canopy cam at the cursor' })).toHaveAttribute('src', '/media/media-late');

    // Back into the night: the other band, the other readings, the other picture.
    scrubTo(3);
    expect(header()).toHaveTextContent(`${clock(3)}21.0 °C58 %Heat on`);
    expect(screen.getByText(/band 20–22/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Canopy cam at the cursor' })).toHaveAttribute('src', '/media/media-early');
    expect(screen.getByRole('img', { name: 'Canopy cam at the cursor' }).parentElement).toHaveTextContent(`Canopy cam · ${stamp(2)} · day 34`);
  });

  it('opens the line a mark stands for, and moves the cursor onto it', () => {
    draw();

    // The two lines a few minutes apart share one mark, which says so.
    const marks = screen.getAllByRole('button', { pressed: false }).filter(button => button.getAttribute('title'));
    expect(marks).toHaveLength(2);

    fireEvent.click(marks[1]);
    expect(screen.getByText('Watered')).toBeInTheDocument();
    expect(screen.getByText('Measured')).toBeInTheDocument();
    expect(header()).toHaveTextContent(clock(16));
  });

  /**
   * The same reading is written on a week card and shows up again on the rail,
   * and a key is not a name: the answer carries what each grow calls its own
   * measurements so that both places say the same words.
   */
  it('names a reading the way the grow it belongs to names it, rather than by its key', () => {
    const measured = {
      ...entry('e4', 16.4, 'measurement', 'Measured'),
      values: { kind: 'measurement' as const, readings: [{ key: 'height', value: 58, plantId: null }] },
    };
    state.answer = { ...answer, events: [measured] };
    draw();

    fireEvent.click(screen.getAllByRole('button', { pressed: false }).filter(button => button.getAttribute('title'))[0]);

    expect(screen.getByText(/Height 58 cm/)).toBeInTheDocument();
    expect(screen.queryByText(/height 58/)).not.toBeInTheDocument();
  });

  it('keeps the panels and loses the frame where nothing takes pictures', () => {
    state.answer = { ...answer, cameras: [] };
    draw();

    expect(screen.queryByRole('img', { name: /at the cursor/ })).not.toBeInTheDocument();
    // The scrubber is what a thumb has, so it stays even when there is no film to run.
    expect(screen.getByLabelText('Move the cursor through the window')).toBeInTheDocument();
    expect(screen.getByText('Temperature')).toBeInTheDocument();
  });

  it('says why there are no curves where nothing measures, and still draws the rail', () => {
    state.answer = { ...answer, deviceIds: [], panels: [], outputs: [], nights: [], alarms: [], cameras: [], lastReadingAt: null };
    draw();

    expect(screen.getByText(/Nothing measures here/)).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    // "Everything off" would be a claim about hardware this place has not got.
    expect(screen.queryByText(/everything off/)).not.toBeInTheDocument();
  });

  /**
   * A metric with no reading in the window has no panel, so an empty stack is
   * the answer both for a tent nothing is installed in and for one whose
   * controller has been quiet for three days - and the second was being told
   * their hardware had never been there.
   */
  it('blames the window rather than the room where the place does measure but has been quiet', () => {
    state.answer = { ...answer, panels: [], lastReadingAt: FROM.minus({ days: 3 }).toISO()! };
    draw();

    expect(screen.getByText(/Nothing heard in this window/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing measures here/)).not.toBeInTheDocument();
  });

  /**
   * A lane carries how far it was heard, because a run that stops where the
   * device stopped reporting looks exactly like one that stops because the
   * output was switched off. The restored fridge's seven lanes all end four days
   * before the window does.
   */
  it('says nothing about the outputs of a device nothing has heard from, rather than that they are off', () => {
    state.answer = {
      ...answer,
      outputs: answer.outputs.map(lane => ({ ...lane, spans: [{ startsAt: at(0), endsAt: at(2) }], heardUntil: at(4) })),
    };
    draw();

    // The end of the window, four hours after the last thing the device said.
    expect(header()).toHaveTextContent(clock(24));
    expect(screen.queryByText(/everything off/)).not.toBeInTheDocument();

    // Inside the stretch it was still reporting, both answers are honest again.
    scrubTo(1);
    expect(header()).toHaveTextContent(/Light on/);
    scrubTo(3);
    expect(header()).toHaveTextContent(/everything off/);
  });

  /** The other way round: a device still reporting whose outputs have all been off for hours has been heard, and "off" is the truth about it. */
  it('still says everything is off where the device is being heard and nothing is running', () => {
    state.answer = { ...answer, outputs: answer.outputs.map(lane => ({ ...lane, spans: [{ startsAt: at(0), endsAt: at(2) }] })) };
    draw();

    expect(header()).toHaveTextContent(/everything off/);
  });

  it('offers nothing that writes', () => {
    draw();

    // Every control here moves the cursor or the window; none of them sends anything.
    const written = screen.queryAllByRole('button').filter(button => /done|save|log|add|delete/i.test(button.textContent ?? ''));
    expect(written).toHaveLength(0);
    expect(within(header()).queryAllByRole('button')).toHaveLength(0);
  });

  /**
   * The net over a device's own log and the plan's bookkeeping cuts the far end
   * of a long window. One restored fridge holds 2,752 machine lines over its
   * grow and the rail was given 200 of them, drawing four months with no mark
   * on them and nothing to say why.
   */
  it('says how many of the machines´ lines the rail could not fit', () => {
    state.answer = { ...answer, machineEvents: { shown: 200, total: 2752 } };
    draw();

    expect(screen.getByText('The newest 200 of 2752 lines the devices and the plan wrote')).toBeInTheDocument();
  });

  it('says nothing about a net that did not bite', () => {
    state.answer = { ...answer, machineEvents: { shown: 12, total: 12 } };
    draw();

    expect(screen.queryByText(/lines the devices and the plan wrote/)).not.toBeInTheDocument();
  });

  /**
   * Every other way into a grow's record names the grow standing in the tent
   * now, so a grow that moved out in spring left its whole rail with no address
   * at all - the record the tent kept while it stood there is on no other
   * screen.
   */
  it('points the stretch chips at a grow that has since ended', () => {
    state.answer = {
      ...answer,
      grows: [
        { growId: 'grow-1', name: 'Spring run', startedAt: FROM.toISO()!, endedAt: null },
        { growId: 'grow-0', name: 'Seriotica', startedAt: FROM.minus({ days: 200 }).toISO()!, endedAt: FROM.toISO()! },
      ],
    };
    draw();

    fireEvent.change(screen.getByLabelText('Which grow'), { target: { value: 'grow-0' } });

    expect(screen.getByRole('button', { name: 'Grow' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Which grow')).toHaveValue('grow-0');
  });

  it('offers no grow to pick where only one has ever stood here', () => {
    draw();

    expect(screen.queryByLabelText('Which grow')).not.toBeInTheDocument();
  });

  it('will not ask for a stretch of a grow where nothing is growing', () => {
    state.answer = { ...answer, growId: null, dayFrom: null, dayTo: null };
    draw();

    expect(screen.getByRole('button', { name: 'Phase' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Grow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '24 h' })).toBeEnabled();
  });
});

/**
 * The rail is the one control the screen has, and jsdom lays nothing out, so
 * the two facts that decide whether its marks can be read are asserted against
 * the stylesheet itself: a mark hangs half of itself off the left edge of the
 * rail, and its count badge is opaque and sits over a 12px glyph.
 */
describe('the geometry of a mark on the rail', () => {
  let css: string;
  const pixels = (rule: string, property: string) => Number(new RegExp(`\\.${rule}\\s*\\{[^}]*?${property}:\\s*(-?[\\d.]+)px`, 's').exec(css)?.[1]);

  beforeAll(async () => {
    css = await readFile(resolve(process.cwd(), 'src/screens/timeline/Timeline.module.css'), 'utf8');
  });

  it('keeps the lane´s label clear of the overhang of a mark at the start of the window', () => {
    // A mark is centred on its moment by pulling itself half its width left, so
    // one at the very start of the window puts that much of itself over the
    // label of the lane beside the rail.
    expect(pixels('laneName', 'padding-right')).toBeGreaterThanOrEqual(pixels('mark', 'width') / 2);
  });

  it('lays the count beside the kind rather than over it', () => {
    // Anything but a negative offset puts the opaque badge back inside the 20px
    // circle, where it covers the glyph that says what kind of line this is.
    expect(pixels('markCount', 'right')).toBeLessThan(0);
    expect(pixels('markCount', 'bottom')).toBeLessThan(0);
  });
});

describe('what a panel is drawn against', () => {
  const [temperature] = answer.panels;
  const from = FROM.toMillis();
  const to = TO.toMillis();

  it('cuts the window where the light went on, so each half is judged by its own band', () => {
    const stretches = stretchesOf(temperature, answer.nights, from, to);

    expect(stretches).toHaveLength(2);
    expect(stretches[0].target.setpoint).toBe(21);
    expect(stretches[1].target.setpoint).toBe(26);
  });

  it('steps the band where one phase handed over to the next, and not only where the light did', () => {
    const moved = {
      ...temperature,
      targets: [
        { ...temperature.targets[0], endsAt: at(15) },
        {
          ...temperature.targets[0],
          startsAt: at(15),
          phaseId: 'phase-2',
          day: { setpoint: 23, band: { low: 22, high: 24 } },
          night: { setpoint: 18, band: { low: 17, high: 19 } },
        },
      ],
    };
    const stretches = stretchesOf(moved, answer.nights, from, to);

    // The night, the rest of the old phase's day, and the new phase's day: the
    // grow was moved on in the middle of a lit half, which is where it steps.
    expect(stretches.map(one => one.target.setpoint)).toEqual([21, 26, 23]);
    expect(stretches[1].to).toBe(DateTime.fromISO(at(15)).toMillis());
  });

  it('leaves out the half of a metric that is not steered in it', () => {
    const unlit = { ...temperature, targets: [{ ...temperature.targets[0], night: null }] };

    expect(stretchesOf(unlit, answer.nights, from, to)).toHaveLength(1);
  });

  it('spans everything measured and everything aimed at, and ends on round figures', () => {
    const scale = scaleOf(temperature, stretchesOf(temperature, answer.nights, from, to));

    expect(scale.low).toBeLessThanOrEqual(20);
    expect(scale.high).toBeGreaterThanOrEqual(27);
    expect(Number.isInteger(scale.low)).toBe(true);
    expect(Number.isInteger(scale.high)).toBe(true);
  });

  it('lands a corner on the round figure it means rather than a hairsbreadth above it', () => {
    // Place 1's humidity read 33.9 to 34.3 one morning, and the low corner of
    // that span is 169 steps of 0.2 - exactly 33.8 in decimal and
    // 33.800000000000004 in binary. ECharts derives the same 33.8 from the
    // extent it is handed and asserts, in its development build, that what it
    // derived is not below what it was given: against the longer figure that
    // assertion failed, and the exception replaced the whole application with
    // a stack trace on any space whose readings happened to land there.
    const damp = {
      ...answer.panels[0],
      metric: 'humidity' as const,
      points: [33.9, 34.1, 34.3].map((value, hour) => ({ measuredAt: at(hour), value })),
    };
    const scale = scaleOf(damp, []);

    expect(scale.low).toBe(33.8);
    expect(scale.high).toBe(34.4);
  });

  it('writes a corner that rounds away to nothing as nothing rather than as minus nothing', () => {
    // A device whose CO2 sensor answers zero on every sample gives a flat line,
    // and the scale is stretched a hairsbreadth either side of it: the low
    // corner was drawn as "-0", which is not a reading anything ever took.
    // Nothing a tent can measure is below zero ppm, so the floor is now zero
    // itself - and the figure still has to be written without the sign
    // wherever a metric that can go below it rounds away to nothing.
    const flat = { ...answer.panels[0], metric: 'co2' as const, points: answer.panels[0].points.map(point => ({ ...point, value: 0 })) };
    const scale = scaleOf(flat, []);

    expect(scale.low).toBe(0);
    expect(scale.high).toBeGreaterThan(0);
    expect(targetFigure(scale.low, 'co2')).toBe('0');
    expect(figure(-0.04, 'temperature')).toBe('0.0');
    // And a figure that does not round away keeps its sign.
    expect(figure(-0.4, 'temperature')).toBe('-0.4');
  });
});
