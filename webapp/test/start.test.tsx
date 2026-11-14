import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { session } from '@/api/session';
import { Start, StartOfPlace } from '@/screens/start/Start';
import { drawAt, reading } from './harness';
import {
  ago,
  cardOf,
  entry,
  fetchStub,
  fridge,
  growOf,
  hhmm,
  homeOf,
  meOf,
  overviewOf,
  reboot,
  resetServer,
  server,
  setpoints,
  values,
  writes,
} from './place-wire';
import { spaceWhere, THE_HOST, YOU } from './session';
import { translate } from './translations';

/** Who reads Start: the grower, whoever runs the install, or the demo. */
const who = vi.hoisted(() => ({ demo: false, admin: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    mediaUrl: (id: string) => `/media/${id}`,
    useSession: () => (who.demo ? ON_THE_DEMO : who.admin ? { ...SIGNED_IN, user: { ...SIGNED_IN.user, isAdmin: true } } : SIGNED_IN),
  };
});

/** The entry sheet and the tick, which Start only asks for: what it asks is what these tests are about. */
const log = vi.hoisted(() => ({ openSheet: vi.fn(), openDetails: vi.fn(), log: vi.fn(), complete: vi.fn(), tell: vi.fn() }));

vi.mock('@/log/log-context', async importOriginal => ({ ...(await importOriginal<object>()), useLog: () => log }));

/**
 * Start, drawn from what the server answers, in the shapes an account has:
 * one place with a camera and a grow, one that only regulates, a diary kept
 * by hand, several places, somebody else's, the demo, nothing yet - and the
 * states a place and the app go through. A window without `matchMedia` counts
 * as wide, so these draw the desktop's arrangement.
 */

const camera = (minutes = 5): SpaceOverview['cameras'][number] => ({
  cameraId: 'cam-1',
  name: 'Terp Cam · B07171',
  lastStillAt: ago(minutes),
  stills: [{ mediaId: 'still-1', capturedAt: ago(minutes) }],
  litStill: null,
});

/** A task waiting on the task list, which is what "Today" is drawn from, and a grow as the grows' list says where it stands. */
const due = (id: string, kind: string, label: string, subject: { type: 'grow' | 'space'; id: string }, minutes = 30) => ({
  id,
  source: 'reminder',
  kind,
  label,
  dueAt: ago(minutes),
  subject,
  assigneeId: null as string | null,
});

const standing = (spaceId: string | null, over: Record<string, unknown> = {}) => ({
  id: 'grow-1',
  ownerId: THE_HOST,
  name: 'Spring run',
  placements: [{ spaceId, endedAt: null }],
  ...over,
});

const onePlace = (overview: SpaceOverview, diary = false) => {
  server.me = meOf(diary);
  server.home = homeOf([cardOf({ grow: overview.grows[0] ?? null })], diary);
  server.overviews.set('space-1', overview);
  server.grows = overview.grows.map(grow => standing('space-1', { id: grow.growId, name: grow.name }));
};

const draw = (at = '/') =>
  drawAt(
    <Routes>
      <Route path="/" element={<Start />} />
      <Route path="/spaces/:spaceId" element={<StartOfPlace />} />
      <Route path="*" element={<p>elsewhere</p>} />
    </Routes>,
    { at },
  );

beforeAll(() => translate());

beforeEach(() => {
  // Midday in Europe/Berlin, so that no reading, stamp or light window of a fixture straddles a day.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T11:00:00.000Z'));
  vi.stubGlobal('fetch', fetchStub);
  localStorage.clear();
  resetServer();
  who.demo = false;
  who.admin = false;
  // Leaving a session and opening the demo are the store's; Start only asks for them.
  vi.spyOn(session, 'logOut').mockResolvedValue(undefined);
  vi.spyOn(session, 'openDemo').mockResolvedValue(undefined as never);
  Object.values(log).forEach(spy => spy.mockClear());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Start of one place with a camera and a grow', () => {
  beforeEach(() => onePlace(overviewOf({ cameras: [camera()], grows: [growOf()] }), true));

  it('leads with the newest picture, the grow and its day on it and the readings in it, and opens the camera', async () => {
    draw();

    const toCamera = (await screen.findByRole('img', { name: 'Fridge 1: the newest picture' })).closest('a')!;
    expect(toCamera).toHaveAttribute('href', '/cameras/cam-1');
    expect(toCamera).toHaveTextContent(/Open Terp Cam$/);
    const picture = toCamera.parentElement!;
    // The grow waits for the account's answer, and so do the hours: they are the account's.
    await waitFor(() => expect(picture).toHaveTextContent('Spring run · Day 29'));
    await waitFor(() => expect(picture).toHaveTextContent(`Picture from ${hhmm(ago(5))}`));
    for (const figure of ['25.1 °C', '61 %', '1.03 kPa']) expect(within(picture).getByText(figure)).toBeInTheDocument();
    expect(await within(picture).findByText('65 %')).toBeInTheDocument();
    // The readings stand in the picture, so no tile repeats them.
    expect(screen.queryByRole('link', { name: 'Temperature' })).not.toBeInTheDocument();
  });

  it('opens each reading´s curve from the picture: its panel of Verlauf', async () => {
    draw();

    const picture = (await screen.findByRole('img', { name: 'Fridge 1: the newest picture' })).closest('a')!.parentElement!;
    // Said as a sentence that names the reading and carries the verdict the picture does not draw.
    expect(within(picture).getByRole('link', { name: 'Temperature 25.1 °C, on target, open the Timeline' })).toHaveAttribute(
      'href',
      '/timeline?space=space-1&focus=temperature',
    );
    expect(within(picture).getByRole('link', { name: /^Humidity 61 %/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=humidity');
    expect(within(picture).getByRole('link', { name: 'VPD 1.03 kPa, open the Timeline' })).toHaveAttribute(
      'href',
      '/timeline?space=space-1&focus=vpd',
    );
    expect(await within(picture).findByRole('link', { name: /^Light 65 %/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=light');
  });

  it('keeps the day of the grow on the picture´s label whatever the name leaves room for', async () => {
    onePlace(overviewOf({ cameras: [camera()], grows: [growOf({ name: 'Amnesia Haze and Gelato 41, second run' })] }), true);
    draw();

    // The name is the part that gives way; the day stands in a part of its own that does not.
    const day = await screen.findByText('· Day 29');
    expect(day.previousElementSibling).toHaveTextContent('Amnesia Haze and Gelato 41, second run');
  });

  it('names the place with how fresh its readings are, and says in one sentence that all is well', async () => {
    draw();

    expect(await screen.findByRole('heading', { level: 1, name: 'Fridge 1' })).toBeInTheDocument();
    // A place that reports is "online": one word for it on the pill, a device's card and a camera's row.
    expect(screen.getByText('online')).toBeInTheDocument();
    expect(screen.getByText('· 18 s ago')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('All on target.');
  });

  it('says phase and week over the bar, and leads to the grow', async () => {
    draw();

    const phase = (await screen.findByText('Flower · week 3')).closest('a')!;
    expect(phase).toHaveAttribute('href', '/grow');
    // Nothing states how long this grow runs, so no harvest is promised.
    expect(screen.queryByText(/Harvest in about/)).not.toBeInTheDocument();
  });

  it('says what is left where a feeding scheme states how long the grow runs', async () => {
    server.grow.set('grow-1', { id: 'grow-1', scheme: { grid: Array.from({ length: 12 }, (_, week) => ({ week: week + 1, amounts: [] })) } });
    draw();

    // Day 29 is week 5 of 12.
    expect(await screen.findByText('Harvest in about 7 weeks')).toBeInTheDocument();
  });

  it('lists what is due today: a watering opens the entry sheet on that kind, a chore is ticked off', async () => {
    onePlace(overviewOf({ grows: [growOf()] }), true);
    server.tasks = [
      due('task-1', 'water', 'Water', { type: 'grow', id: 'grow-1' }),
      due('task-2', 'chore', 'Clean the filter', { type: 'space', id: 'space-1' }),
      // Tomorrow's is not today's, and one with somebody else's name on it is not the reader's: the task list has both.
      due('task-3', 'feed', 'Feed', { type: 'grow', id: 'grow-1' }, -26 * 60),
      { ...due('task-4', 'chore', 'Trim', { type: 'space', id: 'space-1' }), assigneeId: 'user-mia' },
    ];
    draw();

    const today = (await screen.findByRole('heading', { name: 'Today' })).closest('section')!;
    expect(
      within(today)
        .getAllByRole('listitem')
        .map(row => row.textContent),
    ).toEqual([`Waterdue since ${hhmm(ago(30))}Log`, `Clean the filterdue since ${hhmm(ago(30))}Done`]);

    fireEvent.click(within(today).getByRole('button', { name: 'Log: Water' }));
    expect(log.openSheet).toHaveBeenCalledWith({ growId: 'grow-1', spaceId: 'space-1', kind: 'water' });
    expect(log.complete).not.toHaveBeenCalled();

    fireEvent.click(within(today).getByRole('button', { name: 'Done: Clean the filter' }));
    // The toast names what was ticked, so the Undo beside it says what it takes back.
    expect(log.complete).toHaveBeenCalledWith('task-2', 'Done · Clean the filter');
  });

  it('asks before it confirms a waiting step of the grow plan, which cannot be taken back', async () => {
    server.tasks = [
      {
        id: 'step-1',
        source: 'plan_step',
        sourceId: 'plan-1',
        kind: 'custom',
        label: 'Late flower',
        dueAt: ago(10),
        subject: { type: 'space', id: 'space-1' },
        assigneeId: null,
      },
    ];
    draw();

    // The row is the step by its name, said to be the plan's; the verb is on the button beside it.
    const button = await screen.findByRole('button', { name: 'Confirm: Late flower' });
    expect(button).toHaveTextContent(/^Confirm$/);
    expect(button.closest('li')).toHaveTextContent(`Late flowergrow plan · due since ${hhmm(ago(10))}Confirm`);
    fireEvent.click(button);
    expect(log.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm the step' }));
    // What it moves - the plan and the device's targets - is read again once it has landed.
    expect(log.complete).toHaveBeenCalledWith('step-1', 'Step confirmed · Late flower', { undoable: false, changed: expect.any(Function) });
  });

  it('lists a waiting step that is about the grow standing here, which is what a plan´s step is about where one grows', async () => {
    server.tasks = [
      {
        id: 'step-1',
        source: 'plan_step',
        sourceId: 'plan-1',
        kind: 'chore',
        label: 'Late flower',
        dueAt: ago(10),
        subject: { type: 'grow', id: 'grow-1' },
        assigneeId: null,
      },
    ];
    draw();

    expect(await screen.findByRole('button', { name: 'Confirm: Late flower' })).toBeInTheDocument();
  });

  it('names the last three things that happened as the diary says them - maintenance as one line - and leads to the diary', async () => {
    onePlace(
      overviewOf({
        grows: [growOf()],
        // The tail of the diary as the server answers it: its lines, and when maintenance was on.
        events: [{ kind: 'maintenance', at: ago(22), endedAt: ago(20) }],
        entries: [
          entry('entry-3', { kind: 'water', text: null, growId: 'grow-1', values: { kind: 'water' } as never, occurredAt: ago(120) }),
          entry('entry-4', { text: 'Looks good', occurredAt: ago(26 * 60), mediaIds: ['photo-1', 'photo-2'] }),
          entry('entry-5', { text: 'Older still', occurredAt: ago(50 * 60) }),
        ],
      }),
      true,
    );
    draw();

    const latest = (await screen.findByRole('heading', { name: 'Latest' })).closest('section')!;
    const lines = within(latest).getAllByRole('listitem');
    expect(lines).toHaveLength(3);
    // On and off are one line, and a person's: it carries no mark of a device.
    expect(lines[0].textContent?.replace(/\u00a0/g, ' ')).toBe(`${hhmm(ago(22))}Maintenance · 2 min`);
    await waitFor(() => expect(lines[1]).toHaveTextContent(`${hhmm(ago(120))}Watered: You watered`));
    expect(lines[2]).toHaveTextContent(/^yesterdayNote: Looks good/);
    expect(within(latest).getByRole('link', { name: 'Whole diary ›' })).toHaveAttribute('href', '/grow');

    // The count is the way to a line's pictures, beside the words that correct it.
    fireEvent.click(within(lines[2]).getByRole('button', { name: '2 pictures, open the picture' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Picture 1 of 2');
  });

  it('names the plants a line of Latest is about, from the place´s own answer', async () => {
    onePlace(
      overviewOf({
        grows: [growOf()],
        plants: [
          { id: 'plant-a', growId: 'grow-1', label: 'A1' },
          { id: 'plant-b', growId: 'grow-1', label: 'B2' },
        ],
        entries: [entry('entry-3', { kind: 'water', text: null, growId: 'grow-1', plantIds: ['plant-b'], values: { kind: 'water' } as never })],
      }),
      true,
    );
    draw();

    const latest = (await screen.findByRole('heading', { name: 'Latest' })).closest('section')!;
    await waitFor(() => expect(within(latest).getByRole('listitem')).toHaveTextContent(/You watered.*B2/));
    expect(within(latest).getByRole('listitem')).not.toHaveTextContent(/A1/);
  });

  it('keeps amber for what needs a person: an alarm raised, not a restart or an alarm that is over', async () => {
    const alarm = (id: string, minutes: number, severity: 'warning' | 'info') =>
      entry(id, {
        kind: 'alarm',
        source: 'alarm',
        authorId: null,
        text: `alarm ${id}`,
        values: { kind: 'alarm' } as never,
        severity,
        occurredAt: ago(minutes),
      });
    onePlace(
      overviewOf({
        grows: [growOf()],
        entries: [alarm('raised', 10, 'warning'), alarm('over', 20, 'info'), { ...reboot('entry-3', 30), severity: 'warning' }],
      }),
      true,
    );
    draw();

    const lines = within((await screen.findByRole('heading', { name: 'Latest' })).closest('section')!).getAllByRole('listitem');
    expect(lines.map(line => line.getAttribute('data-severity'))).toEqual(['warning', null, null]);
  });

  it('says how much a watering poured', async () => {
    onePlace(
      overviewOf({
        grows: [growOf()],
        entries: [
          entry('entry-1', { kind: 'water', text: null, growId: 'grow-1', values: { kind: 'water', litres: 1.5 } as never, occurredAt: ago(120) }),
        ],
      }),
      true,
    );
    draw();

    const latest = (await screen.findByRole('heading', { name: 'Latest' })).closest('section')!;
    await waitFor(() => expect(within(latest).getByRole('listitem')).toHaveTextContent('You watered · 1.5 L'));
  });

  it('draws no card saying that nothing happened yet', async () => {
    onePlace(overviewOf({ grows: [growOf()], entries: [] }), true);
    draw();

    expect(await screen.findByRole('link', { name: /^Targets/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Latest' })).not.toBeInTheDocument();
  });

  it('opens a line of one´s own in the sheet it was written in, and leaves a device´s line inert', async () => {
    onePlace(overviewOf({ grows: [growOf()], entries: [reboot('entry-1', 20), entry('entry-2', { text: 'Looks good' })] }), true);
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /Looks good/ }));
    expect(log.openDetails).toHaveBeenCalledWith('note', expect.objectContaining({ spaceId: 'space-1' }), expect.objectContaining({ id: 'entry-2' }));
    expect(screen.queryByRole('button', { name: /Device rebooted/ })).not.toBeInTheDocument();
  });

  it('sums the targets up in one row that leads to Steuerung, and offers no setting of its own', async () => {
    draw();

    const row = await screen.findByRole('link', { name: /^Targets/ });
    expect(row).toHaveAttribute('href', '/control?space=space-1');
    expect(row).toHaveTextContent('TargetsDay 25 °C · 60 % · CO₂ 900 ppm · Night 21 °C · 55 %');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('says where a running plan stands on the targets´ row', async () => {
    server.devices = [fridge({ control: { running: true, drying: false, mode: 'standard', energySaving: false } as never })];
    const step = { id: 'step-1', name: 'Flower', stage: 'flowering', duration: { value: 6, unit: 'weeks' }, waitForConfirmation: false };
    server.plan = {
      id: 'plan-1',
      createdAt: ago(40 * 1440),
      deviceId: 'device-1',
      templateId: null,
      name: 'Photoperiod',
      steps: [step],
      loop: false,
      notify: { mode: 'off', email: null, writeEntries: true },
      state: {
        status: 'paused',
        activeStepIndex: 0,
        stepStartedAt: ago(4 * 1440),
        pausedElapsedMs: 0,
        pauseReason: 'by hand',
        lastAppliedAt: ago(20),
        confirmationNotifiedAt: null,
        confirmationAskedAt: null,
        confirmationAskTriedAt: null,
      },
    };
    draw();

    expect(await screen.findByText('Plan: Flower, paused – resume under Control')).toBeInTheDocument();
  });

  it('draws the last day as two small curves that lead to Verlauf', async () => {
    draw();

    const curves = (await screen.findByText('Last 24 h')).closest('a')!;
    expect(curves).toHaveAttribute('href', '/timeline?space=space-1');
    // The lowest and the highest sample of the day, as Verlauf's head says them - not the lowest and highest mean.
    expect(within(curves).getByRole('img', { name: /^Temperature over the last 24 hours, between 20.6 °C and 25.2 °C$/ })).toBeInTheDocument();
    expect(curves).toHaveTextContent('20.6–25.2 °C');
    expect(within(curves).getByRole('img', { name: /^Humidity over the last 24 hours/ })).toBeInTheDocument();
  });

  /** A second grow started where one runs pushed the first off Start, and its task stopped saying whose it is. */
  it('shows both grows of a place that holds two, and a task there names its grow', async () => {
    const gelato = growOf({ growId: 'grow-2', name: 'Gelato', dayNumber: 1, stage: 'seedling', stageWeek: 1, stagesReached: ['seedling'] });
    onePlace(overviewOf({ cameras: [camera()], grows: [gelato, growOf()] }), true);
    server.grows = [
      standing('space-1', { id: 'grow-2', name: 'Gelato', endedAt: null, summary: { locations: [{ spaceId: 'space-1' }] } }),
      standing('space-1', { endedAt: null, summary: { locations: [{ spaceId: 'space-1' }] } }),
    ];
    server.tasks = [due('task-1', 'water', 'Water', { type: 'grow', id: 'grow-1' })];
    draw();

    // The newer stands under the picture; the one that ran here first is a card of its own, leading to its page.
    expect(await screen.findByRole('link', { name: /^Spring run · Day 29/ })).toHaveAttribute('href', '/grows/grow-1');
    const today = (await screen.findByRole('heading', { name: 'Today' })).closest('section')!;
    await waitFor(() => expect(within(today).getByRole('listitem')).toHaveTextContent(/^WaterSpring run · due since/));
  });

  it('keeps what only some places measure in one line under the picture, each the way to its own curve', async () => {
    const more = [
      { metric: 'leafTemperature', value: 24.2, measuredAt: ago(0.3), state: 'live' },
      { metric: 'lux', value: 34000, measuredAt: ago(0.3), state: 'live' },
      { metric: 'ppfd', value: 510, measuredAt: ago(0.3), state: 'live' },
    ] as SpaceOverview['values'];
    onePlace(overviewOf({ cameras: [camera()], grows: [growOf()], values: [...values(), ...more] }), true);
    draw();

    expect(await screen.findByRole('link', { name: /^CO₂ 880\sppm$/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=co2');
    expect(screen.getByRole('link', { name: /^Leaf 24.2\s°C$/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=leafTemperature');
    expect(await screen.findByRole('link', { name: /lx$/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=lux');
    // PPFD has a panel of its own; opening the lux curve under "PPFD 510" showed "34 000 lx".
    expect(screen.getByRole('link', { name: 'PPFD 510' })).toHaveAttribute('href', '/timeline?space=space-1&focus=ppfd');
    // The line stands directly under the picture, before the phase and what is due.
    const line = screen.getByRole('link', { name: 'PPFD 510' }).parentElement!.parentElement!;
    expect(line.previousElementSibling).toContainElement(screen.getByRole('img', { name: 'Fridge 1: the newest picture' }));
  });

  it('leaves the light figures out of that line while the lamp is dark', async () => {
    const more = [
      { metric: 'lux', value: 0, measuredAt: ago(0.3), state: 'live' },
      { metric: 'ppfd', value: 0, measuredAt: ago(0.3), state: 'live' },
    ] as SpaceOverview['values'];
    server.live = { ...server.live, outputs: { light: { value: 0, measuredAt: ago(0.3), state: 'live' } } } as never;
    onePlace(overviewOf({ cameras: [camera()], grows: [growOf()], values: [...values(), ...more] }), true);
    draw();

    expect(await screen.findByRole('link', { name: /^CO₂ 880\sppm$/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /lx$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^PPFD/ })).not.toBeInTheDocument();
  });

  it('steps figures that have stopped coming back in the picture, and says as of when they are', async () => {
    onePlace(overviewOf({ values: values(5).map(value => ({ ...value, state: 'stale' as const })), cameras: [camera(1)], grows: [growOf()] }), true);
    draw();

    const picture = (await screen.findByRole('img', { name: 'Fridge 1: the newest picture' })).closest('a')!.parentElement!;
    expect(picture).toHaveAttribute('data-age', 'stale');
    await waitFor(() => expect(picture).toHaveTextContent(`As of ${hhmm(ago(5))} · 5 min ago`));
  });

  it('says the lamp is off and whose picture it shows, where the newest lit one stands in for a dark tent', async () => {
    onePlace(overviewOf({ grows: [growOf()], cameras: [{ ...camera(), litStill: { mediaId: 'lit-1', capturedAt: ago(200) } }] }), true);
    draw();

    const picture = (await screen.findByRole('img', { name: 'Fridge 1: the newest picture' })).closest('a')!.parentElement!;
    await waitFor(() => expect(picture).toHaveTextContent(`Light off · picture from ${hhmm(ago(200))}`));
    expect(screen.getByRole('img', { name: 'Fridge 1: the newest picture' })).toHaveAttribute('src', '/media/lit-1');
  });
});

describe('Start of a place that only regulates', () => {
  beforeEach(() => onePlace(overviewOf()));

  it('draws the readings as tiles, each the way to its curve, with the verdict under the figure', async () => {
    draw();

    const temperature = (await screen.findByRole('link', { name: 'Temperature' })).closest('div')!;
    expect(screen.getByRole('link', { name: 'Temperature' })).toHaveAttribute('href', '/timeline?space=space-1&focus=temperature');
    expect(temperature).toHaveTextContent('Temperature25.1 °Con target');
    expect(screen.getByRole('link', { name: 'Humidity' }).closest('div')).toHaveTextContent('Humidity61 %on target');
    // VPD leads to its own panel of Verlauf like every reading, and explains itself beside its name.
    const vpd = screen.getByRole('link', { name: 'VPD' });
    expect(vpd).toHaveAttribute('href', '/timeline?space=space-1&focus=vpd');
    expect(vpd.closest('div')).toHaveTextContent('1.03 kPa');
    expect(within(vpd.closest('div')!).getByRole('button', { name: /VPD/ })).toBeInTheDocument();
    // The lamp says how bright it is and when it switches next, by the account's clock.
    expect((await screen.findByRole('link', { name: 'Light' })).closest('div')).toHaveTextContent('Light65 %on until 18:00');
    // No grow, no diary: nothing about either but the one card that offers it.
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Whole diary ›' })).not.toBeInTheDocument();
  });

  /**
   * A lamp somebody holds off keeps to no schedule. "All on target" alone over
   * it read as a tent keeping its day, and the tile promised a switch at an
   * hour the hold would pass.
   */
  it('says a lamp held by hand in its tile and under the sentence, with the way to where it is handed back', async () => {
    localStorage.setItem('terp.lightHold.device-1', JSON.stringify({ state: 'off', until: new Date(Date.now() + 65 * 60_000).toISOString() }));
    server.live = { ...server.live, outputs: { light: { value: 0, measuredAt: ago(0.3), state: 'live' } } } as never;
    draw();

    expect((await screen.findByRole('link', { name: 'Light' })).closest('div')).toHaveTextContent('LightOffheld off until 12:05');
    expect(screen.getByRole('status')).toHaveTextContent('All on target.');
    const line = screen.getByText('Light held off until 12:05').closest('p')!;
    expect(within(line).getByRole('link', { name: 'Change ›' })).toHaveAttribute('href', '/control/outputs?space=space-1');
  });

  it('says nothing of a hold whose time is up', async () => {
    localStorage.setItem('terp.lightHold.device-1', JSON.stringify({ state: 'off', until: new Date(Date.now() - 60_000).toISOString() }));
    draw();

    expect((await screen.findByRole('link', { name: 'Light' })).closest('div')).toHaveTextContent('Light65 %on until 18:00');
    expect(screen.queryByText(/held off/)).not.toBeInTheDocument();
  });

  it('says the one thing that is off its target, and leads to that reading´s curve', async () => {
    onePlace(overviewOf({ values: values().map(value => (value.metric === 'temperature' ? { ...value, value: 28 } : value)) }));
    draw();

    // The figure is bound to its unit, so the sentence never breaks between the two.
    const sentence = await screen.findByRole('link', { name: 'Temperature 3.0\u00a0°C too high just now' });
    expect(sentence).toHaveAttribute('href', '/timeline?space=space-1&focus=temperature');
    expect(screen.getByRole('link', { name: 'Temperature' }).closest('div')).toHaveTextContent('3.0 °C too high');
  });

  it('says an open alarm, and leads to Meldungen', async () => {
    onePlace(
      overviewOf({
        openAlerts: [
          { alertId: 'alert-1', kind: 'threshold', severity: 'warning', startedAt: ago(20), value: 31, metric: 'temperature', name: 'Too warm' },
        ],
      }),
    );
    draw();

    expect(await screen.findByRole('link', { name: new RegExp(`^Too warm.*since ${hhmm(ago(20))}$`) })).toHaveAttribute('href', '/alerts');
  });

  it('names a second device gone silent beside the one that reports, and how many more alerts the place has open', async () => {
    server.devices = [fridge(), fridge({ id: 'device-2', type: 'controller', name: 'Mother controller', state: { lastSeenAt: ago(35) } as never })];
    const silent = { kind: 'offline', severity: 'critical', startedAt: ago(5), value: 1800, metric: 'offline', name: null };
    const mould = { kind: 'threshold', severity: 'warning', startedAt: ago(20), value: 75, metric: 'humidity', name: 'Mould watch' };
    server.alerts = [
      { id: 'alert-1', deviceId: 'device-1', spaceId: 'space-1', ...mould },
      { id: 'alert-2', deviceId: 'device-2', spaceId: 'space-1', ...silent },
    ];
    onePlace(
      overviewOf({
        deviceIds: ['device-1', 'device-2'],
        openAlerts: [
          { alertId: 'alert-1', ...mould },
          { alertId: 'alert-2', ...silent },
        ] as never,
      }),
    );
    draw();

    const sentence = await screen.findByRole('link', { name: new RegExp(`^Mother controller offline.*since ${hhmm(ago(35))}.*\\+1$`) });
    expect(sentence).toHaveAttribute('href', '/alerts');
  });

  it('says a work mode that is not the everyday one in two words, with the way to change it', async () => {
    server.devices = [fridge({ control: { running: true, drying: true, mode: 'standard', energySaving: false } as never })];
    draw();

    const mode = (await screen.findByText('Drying')).closest('p')!;
    expect(within(mode).getByRole('link', { name: 'Change ›' })).toHaveAttribute('href', '/control?space=space-1');
  });

  /** A grow moved out of here to no fixed place had no way back from the place's own question. */
  it('offers to move a grow here beside starting one, on the grow that left this place for no fixed place', async () => {
    server.grows = [
      standing(null, {
        id: 'grow-9',
        ownerId: 'user-1',
        name: 'Wanderer',
        endedAt: null,
        placements: [
          { spaceId: 'space-1', endedAt: ago(60) },
          { spaceId: null, endedAt: null },
        ],
        summary: { locations: [{ spaceId: null }] },
      }),
    ];
    draw();

    const card = (await screen.findByRole('heading', { name: 'What grows here?' })).closest('section')!;
    expect(within(card).getByRole('button', { name: 'Start a grow' })).toBeInTheDocument();
    fireEvent.click(await within(card).findByRole('button', { name: 'Move a grow here' }));
    const sheet = await screen.findByRole('dialog', { name: 'Fridge 1: move a grow here' });
    expect(within(sheet).getByRole('button', { name: /^Wanderer/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers the diary as a card, and keeps "no thanks" with the account', async () => {
    draw();

    // On the place's own Start the question says "here": the name stands in the head, not behind a preposition.
    const card = (await screen.findByRole('heading', { name: 'What grows here?' })).closest('section')!;
    expect(within(card).getByRole('button', { name: 'Start a grow' })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'No thanks' }));

    await waitFor(() => expect(server.bodies.get('PATCH /me')).toEqual({ preferences: { diary: 'off' } }));
    // The card is gone with the tap, so a toast answers it: what holds now, where it is changed, and the way back.
    await waitFor(() => expect(log.tell).toHaveBeenCalledTimes(1));
    const told = log.tell.mock.calls[0][0] as { label: string; undo: () => Promise<unknown> };
    expect(told.label).toBe('The diary stays off. You can switch it on under Me › Grow diary.');
    await told.undo();
    expect(server.bodies.get('PATCH /me')).toEqual({ preferences: { diary: null } });
  });

  it('does not ask what grows on a place whose setup was just left with "Not now"', async () => {
    localStorage.setItem('terp.growLater.space-1', new Date().toISOString());
    draw();

    expect(await screen.findByRole('heading', { level: 1, name: 'Fridge 1' })).toBeInTheDocument();
    await waitFor(() => expect(server.calls).toContain('GET /spaces'));
    expect(screen.queryByRole('heading', { name: 'What grows here?' })).not.toBeInTheDocument();
    localStorage.removeItem('terp.growLater.space-1');
  });

  it('opens the short form on the seedling, never on flower by the length of the day nor on germination', async () => {
    // Twelve hours of light, and figures nobody took from a preset: no stage's climate, and the grow begins today.
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Start a grow' }));
    const sheet = await screen.findByRole('dialog', { name: 'Fridge 1: What grows here?' });
    await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Seedling' })).toHaveAttribute('aria-pressed', 'true'));
    expect(within(sheet).getByRole('button', { name: 'Flower' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).getByRole('button', { name: 'Germination' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens the short form from the card, and an answer starts the grow and its phase without touching the climate', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Start a grow' }));
    const sheet = await screen.findByRole('dialog', { name: 'Fridge 1: What grows here?' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Strain or name' }), { target: { value: 'Blue Dream' } });
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'Plants' }), { target: { value: '3' } });
    await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Seedling' })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start a grow' }));

    await waitFor(() => expect(writes()).toContain('POST /grows/grow-new/phases'));
    expect(server.bodies.get('POST /grows')).toMatchObject({
      name: 'Blue Dream',
      type: 'photoperiod',
      spaceId: 'space-1',
      plants: [{ strain: 'Blue Dream', count: 3 }],
      scheme: null,
    });
    expect(server.bodies.get('POST /grows/grow-new/phases')).toMatchObject({ stage: 'seedling', preset: null });
    expect(writes()).not.toContain('POST /spaces/space-1/preset-applications');
    expect(await screen.findByText('elsewhere')).toBeInTheDocument();
  });

  it('offers no diary to an account that said no', async () => {
    onePlace(overviewOf());
    server.me = meOf(false, { preferences: { diary: 'off' } });
    draw();

    expect(await screen.findByRole('link', { name: 'Temperature' })).toBeInTheDocument();
    await waitFor(() => expect(server.calls).toContain('GET /spaces'));
    expect(screen.queryByRole('heading', { name: /What grows/ })).not.toBeInTheDocument();
  });

  it('keeps "no thanks" with the place for somebody who keeps a diary elsewhere, and asks no more there', async () => {
    onePlace(overviewOf(), true);
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'No thanks' }));
    await waitFor(() => expect(server.bodies.get('PATCH /spaces/space-1')).toEqual({ presetPrompt: 'never' }));
    expect(server.bodies.has('PATCH /me')).toBe(false);
    await waitFor(() => expect(log.tell).toHaveBeenCalledTimes(1));
    const told = log.tell.mock.calls[0][0] as { label: string; undo: () => Promise<unknown> };
    expect(told.label).toBe('The app no longer asks here. You start a grow under Grow › All grows.');
    await told.undo();
    expect(server.bodies.get('PATCH /spaces/space-1')).toEqual({ presetPrompt: 'ask' });
  });

  it('asks nothing of a place whose owner said it never holds a grow', async () => {
    onePlace(overviewOf(), true);
    server.spaces = [spaceWhere('own', { presetPrompt: 'never' })];
    draw();

    expect(await screen.findByRole('link', { name: 'Temperature' })).toBeInTheDocument();
    await waitFor(() => expect(server.calls).toContain('GET /spaces'));
    expect(screen.queryByRole('heading', { name: /What grows/ })).not.toBeInTheDocument();
  });

  it('offers what makes another place: a device, a grow, a camera of its own', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add a place' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a place' });
    expect(
      within(sheet)
        .getAllByRole('link')
        .map(link => link.getAttribute('href')),
    ).toEqual(['/claim', '/grows/new', '/cameras/add']);
  });

  it('offers the owner two things behind the ⋯ beside the name: the page that edits the place, and adding a device to it', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'More about Fridge 1' }));
    // Name, kind, room, devices, people and the end are that one page's.
    expect(screen.getByRole('link', { name: 'Edit place' })).toHaveAttribute('href', '/spaces/space-1/edit');
    // A fan for the one tent is three taps: the ⋯, this row, and the claim, which knows the place and asks nothing.
    expect(screen.getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '/claim?space=space-1');
  });

  it('leads a guest who manages the place from the ⋯ to the one page that edits it, and offers no device to add', async () => {
    server.youMay = 'manage';
    draw();

    // A device stands in a place of its owner, so there is nothing for a list: the ⋯ says what it is for and leads there.
    const menu = await screen.findByRole('link', { name: 'Edit place: Fridge 1' });
    expect(menu).toHaveTextContent(/^Edit place$/);
    expect(menu).toHaveAttribute('href', '/spaces/space-1/edit');
    expect(screen.queryByRole('button', { name: /^More about/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a device' })).not.toBeInTheDocument();
  });

  it('lets the device the server names as the place´s climate speak, where several stand there', async () => {
    server.devices = [fridge(), fridge({ id: 'device-2', type: 'controller', name: 'Mother controller' })];
    onePlace(
      overviewOf({
        deviceIds: ['device-1', 'device-2'],
        climates: [
          { deviceId: 'device-1', values: values(), setpoints, targets: overviewOf().targets, verdict: overviewOf().verdict },
          {
            deviceId: 'device-2',
            values: [{ metric: 'temperature', value: 31.5, measuredAt: ago(0.3), state: 'live' }],
            setpoints: [{ metric: 'temperature', value: 25, band: 1 }],
            targets: { day: [{ metric: 'temperature', value: 25, band: 1 }], night: [] },
            verdict: { ...overviewOf().verdict, deviceId: 'device-2' },
          },
        ],
      }),
    );
    draw();

    expect(await screen.findByText('25.1 °C')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('All on target.');
    expect(screen.queryByText('31.5 °C')).not.toBeInTheDocument();
    expect(screen.queryByText(/Mother controller/)).not.toBeInTheDocument();
  });
});

describe('the states of Start', () => {
  it('waits in the shape of a place, saying so to whoever cannot see it', () => {
    server.home = null;
    fetchStub.mockImplementationOnce(() => new Promise(() => {}));
    draw();

    expect(screen.getByLabelText('Home is loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('says the server cannot be reached and what that means for the tent, with the way to try again and when it last loaded', async () => {
    localStorage.setItem('terp.loaded.user-1', ago(180));
    server.reachable = false;
    draw();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No connection to the server');
    expect(alert).toHaveTextContent('Your devices keep controlling the climate.');
    expect(await screen.findByText(`Last loaded at ${hhmm(ago(180))}.`)).toBeInTheDocument();

    // The answer is held back, so the moment between the tap and it can be looked at: the button says it is trying.
    let answer = () => {};
    fetchStub.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => (answer = () => reject(new TypeError('Failed to fetch')))));
    fireEvent.click(await within(alert).findByRole('button', { name: 'Try again' }));
    expect(await within(alert).findByRole('button', { name: 'Trying …' })).toBeDisabled();
    answer();

    onePlace(overviewOf());
    server.reachable = true;
    fireEvent.click(await within(alert).findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Fridge 1' })).toBeInTheDocument();
    // An answer is noted, so the next failure can say how old the picture is.
    await waitFor(() => expect(localStorage.getItem('terp.loaded.user-1')).toBe('2026-11-12T11:00:00.000Z'));
  });

  it('tells an account that had no device, as this browser last saw it, nothing about devices that regulate on', async () => {
    localStorage.setItem('terp.shape.user-1', JSON.stringify({ steering: false, managed: false, diary: true }));
    server.reachable = false;
    draw();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No connection to the server');
    expect(alert).toHaveTextContent('The app shows anything again once the connection is back.');
    expect(alert).not.toHaveTextContent(/devices/);
    localStorage.removeItem('terp.shape.user-1');
  });

  it('tells a server that answered with a fault from a connection that is gone', async () => {
    server.fault = 500;
    draw();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server reports an error');
    expect(alert).toHaveTextContent('It is not your connection');
    expect(alert).not.toHaveTextContent('No connection');
  });

  it('asks an account with nothing what it starts with, and offers the device, the grow, the demo and the invitation', async () => {
    server.home = homeOf([]);
    draw();

    expect(await screen.findByRole('heading', { level: 1, name: 'What do you start with?' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Add a devicewith the code on its display', '/claim'],
      ['Start a grow without a deviceA diary with photos, watering and feeding', '/grows/new'],
      ['I have an invitation ›', '/join'],
    ]);
  });

  it('says what the demo costs, and asks before it takes it', async () => {
    server.home = homeOf([]);
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /^Look at the demo/ }));
    expect(session.openDemo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open the demo · sign out of mine' }));
    await waitFor(() => expect(session.openDemo).toHaveBeenCalledTimes(1));
  });

  it('offers no grow on the empty Start to somebody who said no to the diary', async () => {
    server.home = homeOf([]);
    server.me = meOf(false, { preferences: { diary: 'off' } });
    draw();

    expect(await screen.findByRole('link', { name: /^Add a device/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: /^Start a grow without a device/ })).not.toBeInTheDocument());
  });

  it('tells the demo that the demo is empty rather than asking it what it starts with', async () => {
    who.demo = true;
    server.home = homeOf([]);
    draw();

    expect(await screen.findByRole('heading', { level: 1, name: 'The demo is empty.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with my own account' }));
    await waitFor(() => expect(session.logOut).toHaveBeenCalledTimes(1));
  });

  it('says a place gone quiet is silent since when, keeps its last readings with their hour, and what to try a tap away', async () => {
    server.devices = [fridge({ state: { lastSeenAt: ago(42), hardware: {}, maintenanceUntil: null } as never })];
    onePlace(overviewOf({ values: values(42) }));
    draw();

    const box = (await screen.findByRole('heading', { name: `The device has not reported since ${hhmm(ago(42))}.` })).closest('section')!;
    expect(screen.getByText('offline')).toBeInTheDocument();
    expect(screen.getByText('· for 42 min')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Temperature' }).closest('div')).toHaveTextContent(`25.1 °Clast value ${hhmm(ago(42))}`),
    );
    // The box says it; no second sentence does, and nothing claims "on target" about a tent nobody has heard from.
    expect(screen.queryByText('All on target.')).not.toBeInTheDocument();
    expect(screen.queryByText('on target')).not.toBeInTheDocument();

    expect(within(box).queryByText('What you can check:')).not.toBeInTheDocument();
    fireEvent.click(within(box).getByRole('button', { name: 'What you can do ›' }));
    expect(within(box).getByText('Unplug the device, wait 10 seconds, plug it back in.')).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'See the device ›' })).toHaveAttribute('href', '/devices/device-1');
  });

  it('says a silent device still takes new targets, and offers no maintenance it could not hear', async () => {
    server.devices = [fridge({ state: { lastSeenAt: ago(42), hardware: {}, maintenanceUntil: null } as never })];
    onePlace(overviewOf({ values: values(42) }));
    draw();

    const row = await screen.findByRole('link', { name: /^Change targets and light/ });
    expect(row).toHaveAttribute('href', '/control?space=space-1');
    expect(row).toHaveTextContent('Works now too. It reaches the device as soon as it is back online.');
    expect(screen.queryByRole('button', { name: /^Maintenance/ })).not.toBeInTheDocument();
  });

  it('dims the last picture of a silent place and says how old picture and readings are', async () => {
    server.devices = [fridge({ state: { lastSeenAt: ago(42), hardware: {}, maintenanceUntil: null } as never })];
    onePlace(overviewOf({ values: values(42), cameras: [camera(43)], grows: [growOf()] }), true);
    draw();

    const picture = (await screen.findByRole('img', { name: 'Fridge 1: the newest picture' })).closest('a')!.parentElement!;
    expect(picture).toHaveAttribute('data-age', 'offline');
    await waitFor(() => expect(picture).toHaveTextContent(`last picture from ${hhmm(ago(43))}`));
    expect(picture).toHaveTextContent(`As of ${hhmm(ago(42))} · 42 min ago`);
  });

  it('says a device that has sent no value yet is waiting for its first ones, and not that it is offline', async () => {
    server.devices = [fridge({ state: { lastSeenAt: null, hardware: {}, maintenanceUntil: null } as never })];
    onePlace(overviewOf({ values: [] }));
    draw();

    expect(await screen.findByText('waiting for first values')).toBeInTheDocument();
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
    // The pill says it once; no sentence under it repeats it, no box calls the device silent, and nothing offers what it could not hear.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/has not reported since/)).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^Targets/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Maintenance/ })).not.toBeInTheDocument();
  });

  /** Regulation switched off is said once as a sentence, over the readings; the card of targets under it names the state and does not repeat it. */
  it('says once that control is off and that no targets are held, and names the state where the targets would stand', async () => {
    server.devices = [fridge({ control: { running: false, drying: false, mode: 'standard', energySaving: false } as never })];
    onePlace(overviewOf({ setpoints: [], targets: null }));
    draw();

    expect(await screen.findByText(/^Control off: the device holds no targets/)).toBeInTheDocument();
    expect(screen.getByText('Control off')).toBeInTheDocument();
    expect(screen.queryByText(/holds no targets right now/)).not.toBeInTheDocument();
  });

  /** A device that went quiet with its control off does not go on holding the last targets, and the card says what it was left on. */
  it('says of a silent device whose control was off that it was off, and keeps "Control off" on the targets', async () => {
    server.devices = [
      fridge({
        control: { running: false, drying: false, mode: 'standard', energySaving: false } as never,
        state: { lastSeenAt: ago(42), hardware: {}, maintenanceUntil: null } as never,
      }),
    ];
    onePlace(overviewOf({ values: values(42), setpoints: [], targets: null }));
    draw();

    const box = (await screen.findByRole('heading', { name: /^The device has not reported since/ })).closest('section')!;
    expect(box).toHaveTextContent('Control was off when it last reported.');
    expect(box).not.toHaveTextContent('keeps holding the last targets');
    expect(screen.getByRole('link', { name: /^Change targets and light/ })).toHaveTextContent('Control off');
  });

  /** Switched off after the device went quiet, it never heard it: Start says what Steuerung says, not that it was off. */
  it('says of a switch-off a silent device was never handed that it is saved and not with the device yet', async () => {
    server.devices = [
      fridge({
        control: { running: false, drying: false, mode: 'standard', energySaving: false } as never,
        state: { lastSeenAt: ago(42), hardware: {}, maintenanceUntil: null } as never,
      }),
    ];
    server.live = { ...server.live, pending: { since: ago(42), settings: [{ field: 'workmode', held: 'small', savedAt: ago(40) }] } } as never;
    onePlace(overviewOf({ values: values(42), setpoints: [], targets: null }));
    draw();

    const box = (await screen.findByRole('heading', { name: /^The device has not reported since/ })).closest('section')!;
    await waitFor(() => expect(box).toHaveTextContent(`Control off saved at ${hhmm(ago(40))}, not with the device yet`));
    expect(box).not.toHaveTextContent('Control was off when it last reported.');
  });

  /** Regulation off is never hidden behind maintenance: it is what the place is while the window runs, and after it. */
  it('says control is off before maintenance', async () => {
    server.devices = [
      fridge({
        control: { running: false, drying: false, mode: 'standard', energySaving: false } as never,
        state: { lastSeenAt: ago(0), hardware: {}, maintenanceUntil: ago(-10) } as never,
      }),
    ];
    onePlace(overviewOf({ setpoints: [], targets: null }));
    draw();

    const sentence = (await screen.findByText(/^Control off: the device holds no targets/)).closest('[data-tone]')!;
    expect(sentence).toHaveAttribute('data-tone', 'warn');
    expect(sentence).not.toHaveTextContent('Maintenance');
  });

  /** "Alles im Ziel" in green over a tent left drying under a grow in flower denied what the tent was doing. */
  it('says a work mode the grow´s phase contradicts in the status, once, leading to Control', async () => {
    server.devices = [fridge({ control: { running: true, drying: true, mode: 'standard', energySaving: false } as never })];
    onePlace(overviewOf({ grows: [growOf()] }), true);
    draw();

    const sentence = await screen.findByRole('link', { name: 'The device is drying, the grow is in the Flower phase' });
    expect(sentence).toHaveAttribute('href', '/control?space=space-1');
    expect(sentence).toHaveAttribute('data-tone', 'warn');
    expect(screen.queryByText('All on target.')).not.toBeInTheDocument();
    // Said in the status, the mode is not said again under it.
    expect(screen.queryByText('Drying')).not.toBeInTheDocument();
  });

  /** After a status that is not an alert's own sentence, what is open is said in words - never a lone "+3" - and in red where one is critical. */
  it('says during maintenance how many alerts stand open, in words and in the alarm´s colour, and leaves the warning´s ground to the control', async () => {
    server.devices = [fridge({ state: { lastSeenAt: ago(0), hardware: {}, maintenanceUntil: ago(-10) } as never })];
    const alert = { kind: 'threshold', startedAt: ago(20), value: 31, metric: 'temperature', name: 'Too warm' };
    onePlace(
      overviewOf({
        openAlerts: [
          { alertId: 'alert-1', severity: 'warning', ...alert },
          { alertId: 'alert-2', severity: 'critical', ...alert, name: 'Too hot' },
          { alertId: 'alert-3', severity: 'warning', ...alert, name: 'Mould watch' },
        ] as never,
      }),
    );
    draw();

    const said = await screen.findByText(reading('3 alerts open'));
    expect(said).toHaveAttribute('data-tone', 'alarm');
    const sentence = said.closest('[data-tone="quiet"]')!;
    // Maintenance itself is the control's to say, further down: the sentence says what stands open behind it.
    expect(sentence).toHaveTextContent(/^3 alerts open$/);
    expect(sentence).not.toHaveTextContent('+3');
    // What stands open is what the sentence leads to; the window is ended at its own control.
    expect(sentence).toHaveAttribute('href', '/alerts');
    // While maintenance pauses the alarms, that none would reach anybody is not a second warning beside it.
    expect(screen.queryByText('Alarms do not reach you')).not.toBeInTheDocument();
  });

  /** Silence is the box's and the pill's to say: the sentence beside them says what else stands open, and nothing more. */
  it('says of a silent place only what alerts stand open beside the box that says it is silent', async () => {
    server.devices = [fridge({ state: { lastSeenAt: ago(42), hardware: {}, maintenanceUntil: null } as never })];
    const alert = { kind: 'threshold', severity: 'warning', startedAt: ago(50), value: 31, metric: 'temperature', name: 'Too warm' };
    onePlace(overviewOf({ values: values(42), openAlerts: [{ alertId: 'alert-1', ...alert }] as never }));
    draw();

    const sentence = await screen.findByRole('link', { name: '1 alert open' });
    expect(sentence).toHaveAttribute('href', '/alerts');
    expect(sentence).toHaveAttribute('data-tone', 'warn');
  });

  it('says a device heard long ago, whose values have left the live read, is offline since it was last heard', async () => {
    server.devices = [fridge({ state: { lastSeenAt: ago(40 * 1440), hardware: {}, maintenanceUntil: null } as never })];
    onePlace(overviewOf({ values: [] }));
    draw();

    expect(await screen.findByText('offline')).toBeInTheDocument();
    expect(screen.queryByText('waiting for first values')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^The device has not reported since/ })).toBeInTheDocument();
  });

  it('says whose place it is to somebody let into it, what they may do, and who can change the targets', async () => {
    server.youMay = 'log';
    onePlace(overviewOf({ grows: [growOf()], people: [{ id: THE_HOST, handle: 'host' }] }), true);
    // A step of the plan is not sent to somebody who may not confirm it; were it, it is not theirs to settle.
    server.tasks = [
      due('task-1', 'water', 'Water', { type: 'grow', id: 'grow-1' }),
      { ...due('step-1', 'chore', 'Late flower', { type: 'space', id: 'space-1' }), source: 'plan_step' },
    ];
    draw();

    // Whose place it is leads to who else is here, which is where a member leaves; a reader who may change
    // nothing about the place has no menu beside its name.
    expect(await screen.findByRole('link', { name: 'by @host, see the members' })).toHaveAttribute('href', '/spaces/space-1/members');
    expect(screen.getByText('you can log')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Edit place/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^More about/ })).not.toBeInTheDocument();
    // What a member may do is there: the watering is theirs to enter.
    expect(await screen.findByRole('button', { name: 'Log: Water' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
    // What they may not is absent rather than refused: the targets are read, not opened.
    const targets = screen.getByRole('heading', { name: 'Targets' }).closest('section')!;
    expect(targets).toHaveTextContent('Day 25 °C · 60 % · CO₂ 900 ppm · Night 21 °C · 55 %');
    expect(targets).toHaveTextContent('Light 06:00 to 18:00');
    expect(targets).toHaveTextContent('Whoever manages Fridge 1 can change them.');
    expect(screen.queryByRole('link', { name: /^Targets/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Maintenance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /What grows/ })).not.toBeInTheDocument();
  });

  it('lists nothing as due to somebody who may only look, who could settle none of it', async () => {
    server.youMay = 'view';
    onePlace(overviewOf({ grows: [growOf()] }), true);
    const grow = { type: 'grow' as const, id: 'grow-1' };
    server.tasks = [due('task-1', 'water', 'Water', grow), due('task-2', 'chore', 'Clean', { type: 'space', id: 'space-1' })];
    draw();

    expect(await screen.findByRole('heading', { level: 1, name: 'Fridge 1' })).toBeInTheDocument();
    await waitFor(() => expect(server.calls).toEqual(expect.arrayContaining(['GET /tasks', 'GET /grows'])));
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
  });

  it('shows the demo what there is to see, says that nothing can be changed, and offers an account', async () => {
    who.demo = true;
    onePlace(
      overviewOf({
        cameras: [camera()],
        grows: [growOf()],
        entries: [entry('entry-1', { kind: 'water', text: null, authorId: 'user-9', growId: 'grow-1', values: { kind: 'water' } as never })],
      }),
      true,
    );
    server.tasks = [due('task-1', 'water', 'Water', { type: 'grow', id: 'grow-1' })];
    draw();

    expect(await screen.findByText('Demo · you are looking on, nothing can be changed')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Fridge 1: the newest picture' })).toBeInTheDocument();
    // A line says what was done, not who did it.
    expect(screen.getByRole('heading', { name: 'Latest' }).closest('section')).toHaveTextContent('Watered: Watered');
    // The demo has no account and so no zone of one: the hours are the reader's own.
    expect(screen.getByRole('heading', { name: 'Targets' }).closest('section')).toHaveTextContent(/Light \d\d:00 to \d\d:00/);
    // Nothing that writes: nothing to tick - no list is asked for -, no menu, no place to add, and nobody to ask for a change.
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    expect(server.calls).not.toContain('GET /tasks');
    expect(screen.queryByRole('link', { name: /^Edit place/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^More about/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add a place' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Whoever manages/)).not.toBeInTheDocument();
    // The demo has no account to read.
    expect(server.calls).not.toContain('GET /me');

    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    await waitFor(() => expect(session.logOut).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('elsewhere')).toBeInTheDocument();
  });

  it('heads a diary kept by hand with the place´s name too, the grow on its newest photo, and offers a device under it', async () => {
    onePlace(
      overviewOf({
        name: 'Balcony',
        kind: 'balcony',
        deviceIds: [],
        values: [],
        setpoints: [],
        targets: null,
        grows: [growOf({ name: 'Balcony autos' })],
        entries: [
          entry('entry-1', {
            kind: 'photo',
            text: null,
            growId: 'grow-1',
            values: { kind: 'photo' } as never,
            mediaIds: ['photo-1'],
            occurredAt: ago(26 * 60),
          }),
        ],
      }),
      true,
    );
    server.devices = [];
    draw();

    // One name per place: the head is what the header, the cards and the menu call it.
    expect(await screen.findByRole('heading', { level: 1, name: 'Balcony' })).toBeInTheDocument();
    const toGrow = (await screen.findByRole('img', { name: 'The newest photo of Balcony autos' })).closest('a')!;
    expect(toGrow).toHaveAttribute('href', '/grow');
    const photo = toGrow.parentElement!;
    expect(photo).toHaveTextContent('Balcony autos · Day 29');
    expect(photo).toHaveTextContent('your photo from yesterday');
    expect(screen.getByText('Flower · week 3')).toBeInTheDocument();
    // Nothing measures here, so nothing is judged and nothing is steered.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Targets/)).not.toBeInTheDocument();

    const offer = screen.getByRole('heading', { name: 'With a device it measures by itself here' }).closest('section')!;
    expect(within(offer).getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '/claim');
    fireEvent.click(within(offer).getByRole('button', { name: 'No thanks' }));
    await waitFor(() => expect(server.bodies.get('PATCH /me')).toEqual({ preferences: { deviceOfferDeclined: true } }));
  });

  it('draws a grow that stands in no place as Start, from the home´s own card', async () => {
    server.me = meOf(true);
    server.home = homeOf(
      [
        cardOf({
          spaceId: null,
          name: 'Windowsill',
          kind: null,
          deviceIds: [],
          values: [],
          setpoints: [],
          grow: growOf({ name: 'Windowsill' }),
          entries: [entry('entry-1', { text: 'Repotted', growId: 'grow-1', spaceId: null })],
        }),
      ],
      true,
    );
    // A grow standing nowhere is its owner's alone, and so is what is due on it.
    server.grows = [standing(null, { ownerId: YOU, name: 'Windowsill' })];
    server.tasks = [due('task-1', 'water', 'Water', { type: 'grow', id: 'grow-1' })];
    draw();

    expect(await screen.findByRole('heading', { level: 1, name: 'Windowsill' })).toBeInTheDocument();
    expect(screen.getByText('Flower · week 3').closest('a')).toHaveAttribute('href', '/grow');
    expect(screen.getByRole('heading', { name: 'Latest' }).closest('section')).toHaveTextContent('Repotted');
    fireEvent.click(await screen.findByRole('button', { name: 'Log: Water' }));
    expect(log.openSheet).toHaveBeenCalledWith({ growId: 'grow-1', spaceId: null, kind: 'water' });
  });

  it('says a place the reader was taken out of cannot be opened, and offers the way home rather than a retry', async () => {
    server.home = homeOf([cardOf(), cardOf({ spaceId: 'space-2', name: 'Tent 2' })]);
    draw('/spaces/space-9');

    expect(await screen.findByText('This place cannot be opened.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('says the same of somebody else´s place that was removed, whose own read still answers', async () => {
    server.home = homeOf([cardOf(), cardOf({ spaceId: 'space-2', name: 'Tent 2' })]);
    server.overviews.set('space-9', overviewOf({ spaceId: 'space-9', name: 'Removed tent', deviceIds: [] }));
    draw('/spaces/space-9');

    expect(await screen.findByRole('heading', { level: 1, name: 'Place' })).toBeInTheDocument();
    expect(screen.getByText('This place cannot be opened.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('Removed tent')).not.toBeInTheDocument();
  });

  /** Nobody took the owner out of a place they removed themselves: its address says that it has ended, as Verlauf and Steuerung do. */
  it('says of a place of one´s own that it has ended - an administrator´s too - and still draws a customer´s', async () => {
    who.admin = true;
    server.home = homeOf([cardOf(), cardOf({ spaceId: 'space-2', name: 'Tent 2' })]);
    server.overviews.set('space-9', overviewOf({ spaceId: 'space-9', name: 'Removed tent', deviceIds: [] }));
    server.overviews.set('space-7', overviewOf({ spaceId: 'space-7', name: 'A customer´s tent', deviceIds: [] }));
    server.ended = [spaceWhere('own', { id: 'space-9', name: 'Removed tent', archivedAt: '2026-05-01T00:00:00.000Z' })];
    const { unmount } = draw('/spaces/space-9');

    expect(await screen.findByText(/The place Removed tent no longer exists/)).toBeInTheDocument();
    expect(screen.queryByText('This place cannot be opened.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    unmount();

    draw('/spaces/space-7');
    expect(await screen.findByRole('heading', { level: 1, name: 'A customer´s tent' })).toBeInTheDocument();
  });
});

describe('Start with several places', () => {
  const tent = () =>
    cardOf({
      spaceId: 'space-2',
      name: 'Tent 2',
      kind: 'tent',
      roomId: 'room-1',
      deviceIds: ['device-2'],
      values: values().map(value => (value.metric === 'humidity' ? { ...value, value: 72 } : value)),
      grow: growOf({ growId: 'grow-2', name: 'Autumn cuttings', dayNumber: 9, stage: 'vegetative' }),
      latestStill: { mediaId: 'still-2', cameraId: 'cam-2', capturedAt: ago(4), lightOff: false },
    });

  beforeEach(() => {
    server.me = meOf(true);
    server.devices = [fridge(), fridge({ id: 'device-2', type: 'controller', spaceId: 'space-2' })];
    server.spaces = [
      spaceWhere('own'),
      spaceWhere('own', { id: 'space-2', name: 'Tent 2', roomId: 'room-1' }),
      spaceWhere('own', { id: 'room-1', name: 'Cellar', kind: 'room' }),
    ];
    server.home = homeOf([cardOf(), tent()], true);
    server.grows = [standing('space-2', { id: 'grow-2', name: 'Autumn cuttings' })];
    server.tasks = [due('task-2', 'water', 'Water', { type: 'grow', id: 'grow-2' })];
    server.overviews.set('space-1', overviewOf());
    server.overviews.set('space-2', overviewOf({ spaceId: 'space-2', name: 'Tent 2', deviceIds: ['device-2'] }));
  });

  it('is a card per place under its room, the one that needs a person first, each opening that place´s Start', async () => {
    draw();

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    const room = await screen.findByRole('region', { name: 'Cellar' });
    const cards = screen.getAllByRole('link').filter(link => link.getAttribute('href')?.startsWith('/spaces/'));
    expect(cards.map(card => card.getAttribute('href'))).toEqual(['/spaces/space-2', '/spaces/space-1']);
    expect(within(room).getByRole('link')).toBe(cards[0]);

    // The one that asks says what is wrong in the sentence of its own Start; the one that is fine says only that.
    // It also says that something is due there, which "Today" lists further down a phone's page.
    await waitFor(() =>
      expect(cards[0]).toHaveTextContent('Tent 2off targetHumidity 12 % too high25.1 °C · 72 % · Light 65 %Autumn cuttings · Day 9 · Veg1 task due'),
    );
    expect(within(cards[0]).getByRole('img', { name: 'Tent 2: the newest picture' })).toHaveAttribute('src', '/media/still-2');
    expect(cards[1]).toHaveTextContent('Fridge 1on target25.1 °C · 61 % · Light 65 %');
    expect(cards[1]).not.toHaveTextContent('due');
    // A place in no room that follows a room´s cards is set off from them by saying so.
    expect(screen.getByRole('region', { name: 'In no room' })).toContainElement(cards[1]);
  });

  it('names both grows on the card of a place that holds two', async () => {
    server.grows = [
      standing('space-2', { id: 'grow-2', name: 'Autumn cuttings', endedAt: null, summary: { locations: [{ spaceId: 'space-2' }] } }),
      standing('space-2', { id: 'grow-3', name: 'Mothers', endedAt: null, summary: { locations: [{ spaceId: 'space-2' }] } }),
    ];
    draw();

    const card = () => screen.getAllByRole('link').find(link => link.getAttribute('href') === '/spaces/space-2');
    await waitFor(() => expect(card()).toHaveTextContent('Autumn cuttings, Mothers'));
  });

  it('counts a step of the grow plan waiting for its word among what is due at a place', async () => {
    server.tasks.push({ ...due('step-1', 'custom', 'Late flower', { type: 'space', id: 'space-2' }, 10), source: 'plan_step' });
    draw();

    await waitFor(() => expect(screen.getByRole('link', { name: /^Tent 2: the newest picture/ })).toHaveTextContent('2 tasks due'));
  });

  it('leads the address of a room, which has no Start of its own, to Start', async () => {
    draw('/spaces/room-1');

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Cellar' })).not.toBeInTheDocument();
    expect(server.calls).not.toContain('GET /spaces/room-1/overview');
  });

  it('gathers what is due today across the places, each saying where and since when', async () => {
    draw();

    const today = (await screen.findByRole('heading', { name: 'Today' })).closest('section')!;
    fireEvent.click(await within(today).findByRole('button', { name: 'Log: Water' }));
    expect(within(today).getByRole('listitem')).toHaveTextContent(`WaterAutumn cuttings · Tent 2 · due since ${hhmm(ago(30))}Log`);
    expect(log.openSheet).toHaveBeenCalledWith({ growId: 'grow-2', spaceId: 'space-2', kind: 'water' });
  });

  /** The pill names the state as a device's pill and Steuerung do, and "check" named nothing. */
  it('says in the pill what state a place is in, in the words a device´s pill uses', async () => {
    server.devices = [
      fridge({ state: { lastSeenAt: ago(0), hardware: {}, maintenanceUntil: ago(-10) } as never }),
      fridge({
        id: 'device-2',
        type: 'controller',
        spaceId: 'space-2',
        state: { lastSeenAt: ago(5), hardware: {}, maintenanceUntil: null } as never,
      }),
    ];
    server.home = homeOf([cardOf(), { ...tent(), values: values(5).map(value => ({ ...value, state: 'stale' as const })) }], true);
    draw();

    const pill = (spaceId: string) =>
      screen
        .getAllByRole('link')
        .find(link => link.getAttribute('href') === `/spaces/${spaceId}`)
        ?.querySelector('[data-tone]');
    await waitFor(() => expect(pill('space-1')).toHaveTextContent(/^Maintenance$/));
    expect(pill('space-2')).toHaveTextContent(/^stale$/);
    expect(screen.queryByText('check')).not.toBeInTheDocument();
  });

  it('says a place gone quiet is offline, and judges none of its figures', async () => {
    server.home = homeOf([cardOf({ values: values(30) }), tent()], true);
    draw();

    // Asked for again on every look: the card is drawn anew once the rooms are known.
    const card = () => screen.getAllByRole('link').find(link => link.getAttribute('href') === '/spaces/space-1')!;
    await waitFor(() => expect(card()).toHaveTextContent(`Fridge 1offlineOffline since ${hhmm(ago(30))}25.1 °C · 61 %`));
  });

  it('opens a grow that stands in no place at the grow, because there is no place to open', async () => {
    server.home = homeOf(
      [
        cardOf(),
        cardOf({ spaceId: null, name: 'Windowsill', kind: null, deviceIds: [], values: [], setpoints: [], grow: growOf({ name: 'Windowsill' }) }),
      ],
      true,
    );
    draw();

    expect(await screen.findByRole('link', { name: /^Windowsill/ })).toHaveAttribute('href', '/grows/grow-1');
    expect(screen.getByRole('link', { name: /^Windowsill/ })).toHaveTextContent('No fixed place · Day 29 · Flower');
  });

  it('adds a place from under the cards', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add a place' }));
    expect(await screen.findByRole('dialog', { name: 'Add a place' })).toBeInTheDocument();
  });

  it('draws a place at its own address with the way back to the cards', async () => {
    draw('/spaces/space-2');

    expect(await screen.findByRole('heading', { level: 1, name: 'Tent 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  it('hands the address of an account´s only place over to Start, which is that place', async () => {
    server.home = homeOf([cardOf()]);
    const { container } = draw('/spaces/space-1');

    await waitFor(() => expect(server.calls).toContain('GET /home'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Fridge 1' })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });
});
