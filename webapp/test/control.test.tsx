import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, AlarmRule, Device, Plan, PlanStep, PlanTransition, Socket, SocketPage } from '@fg2/shared-types/v1';
import { ApiError } from '@/api/problem';
import type { PlaceCard } from '@/app/places';
import type { Told } from '@/log/log-context';
import { Control } from '@/screens/control/Control';
import { PlanEditor } from '@/screens/control/PlanEditor';
import { PlanPanel } from '@/screens/control/PlanPanel';
import { alarmsLine, followsPlan, modeLine, notTaken, offNotTaken, onNotTaken, outputsLine, outputsOf, planLine } from '@/screens/control/rows';
import { elapsedMs, leftMs, movesOf, throughStep } from '@/screens/control/plan-clock';
import {
  asWritableBy,
  CLIMATE_FIGURES,
  draftOf,
  editEffect,
  emptyDraft,
  figureOf,
  figuresFor,
  moveStep,
  otherSections,
  withFigure,
} from '@/screens/control/plan-edit';
import { climateLanding } from '@/ui/climate-hardware';
import { deviceWith } from './fixtures';
import { drawAt } from './harness';
import { Toast } from './toast';
import { catalogue, translate } from './translations';

/**
 * What the Control tab promises before anything is sent, and what it offers at
 * all.
 *
 * A plan is the one thing in the app that moves without being asked, so the two
 * ways this screen could lie are both checked here: offering a move the server
 * would refuse, and saying an edit leaves the tent where it is when it would
 * start the step over. The third is the settings a step carries - a figure
 * typed into one section carries only itself, and the server merges it into the
 * section the controller runs, so the tuning beside it is never sent at all.
 */

/*
 * The screen reads the browser's clock for every age on it, and that clock is
 * held at midday where the suite runs, which is the instant the arithmetic is
 * checked at too. A controller quiet for two hours is dated by the hour alone
 * only while those two hours fall on today: run between midnight and two in
 * the morning, the line rightly gains yesterday's date, and the case would fail
 * for the time of night rather than for anything the panel did. Only Date is
 * faked, so every timer still runs.
 */
const NOW = DateTime.fromISO('2026-09-19T12:00:00');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(NOW.toJSDate());
afterAll(() => vi.useRealTimers());

const state = vi.hoisted(() => ({
  plan: null as Plan | null,
  planError: null as unknown,
  moveError: null as unknown,
  sent: [] as PlanTransition[],
  removed: 0,
  devices: [] as unknown[],
  /** The account's cameras, of which the place's own get a row each. */
  cameras: [] as unknown[],
  /** What the template list answers; undefined is a list still on its way. */
  templates: undefined as { items: unknown[]; nextCursor: null } | undefined,
}));

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevices: () => ({ data: { items: state.devices, nextCursor: null }, isPending: false, refetch: () => {} }),
}));

vi.mock('@/api/cameras', async importOriginal => ({
  ...(await importOriginal<object>()),
  useCameras: () => ({ data: { items: state.cameras, nextCursor: null }, isPending: false }),
}));

vi.mock('@/api/plans', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevicePlan: () => ({
    data: state.plan,
    isPending: false,
    isError: state.planError !== null,
    error: state.planError,
    dataUpdatedAt: NOW.toMillis(),
    refetch: () => {},
  }),
  usePlanTransition: () => ({
    // A move the server takes answers the caller; one it refuses is said from `error`.
    mutate: (body: PlanTransition, options?: { onSuccess?: () => void }) => {
      state.sent.push(body);
      if (state.moveError === null) options?.onSuccess?.();
    },
    mutateAsync: (body: PlanTransition) => Promise.resolve(state.sent.push(body)),
    error: state.moveError,
    isPending: false,
  }),
  useStopPlan: () => ({ mutate: (_: undefined, options?: { onSuccess?: () => void }) => options?.onSuccess?.(), error: null, isPending: false }),
  useRemovePlan: () => ({
    mutate: (_: undefined, options?: { onSuccess?: () => void }) => {
      state.removed += 1;
      options?.onSuccess?.();
    },
    error: null,
    isPending: false,
  }),
  useSavePlan: () => ({ mutate: () => {}, error: null, isPending: false }),
  useDevicePlans: () => ({ plans: state.plan ? [state.plan] : [], isPending: false }),
  usePlanTemplates: () => ({ data: state.templates, isPending: state.templates === undefined, error: null }),
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/** What the reader may do in the tent, which is what the whole tab is gated on. */
const may = vi.hoisted(() => ({ youMay: 'own' as AccessNeed }));

vi.mock('@/api/spaces', async importOriginal => {
  const { spaceWhere, spacesAnswering } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    useSpaces: () => spacesAnswering(spaceWhere(may.youMay)),
    // The place as Steuerung reads it: its name, and no climate named - the first device that states one leads.
    useSpaceOverview: () => ({ data: { name: 'Tent', climates: [], deviceIds: null, cameras: [], verdict: undefined }, isPending: false }),
  };
});

const step = (over: Partial<PlanStep> = {}): PlanStep => ({
  id: 'step-1',
  name: 'Veg',
  stage: 'vegetative',
  preset: null,
  duration: { value: 2, unit: 'weeks' },
  settings: { day: { temperature: 26, humidity: 62 } },
  lightHours: null,
  waitForConfirmation: false,
  confirmationMessage: null,
  germinationChoices: null,
  ...over,
});

const plan = (over: Partial<Plan> = {}, stateOver: Partial<Plan['state']> = {}): Plan => ({
  id: 'plan-1',
  createdAt: NOW.minus({ days: 30 }).toISO()!,
  deviceId: 'device-1',
  templateId: null,
  name: 'Autoflower, 12 weeks',
  steps: [step(), step({ id: 'step-2', name: 'Flower', stage: 'flowering', duration: { value: 3, unit: 'weeks' } })],
  loop: false,
  notify: { mode: 'off', email: null, writeEntries: true },
  ...over,
  state: {
    status: 'running',
    activeStepIndex: 0,
    stepStartedAt: NOW.minus({ days: 4 }).toISO()!,
    pausedElapsedMs: 0,
    pauseReason: null,
    lastAppliedAt: NOW.minus({ minutes: 20 }).toISO()!,
    confirmationNotifiedAt: null,
    confirmationAskedAt: null,
    confirmationAskTriedAt: null,
    ...stateOver,
  },
});

/** What the controller is running now: two sections, each with a figure beside the ones a step edits. */
const CONFIGURATION = { day: { temperature: 25, humidity: 60, heating: 'hard' }, lights: { limit: 80, sunrise: 15 } };

const device = (lastSeenAt = NOW.minus({ seconds: 20 })): Device =>
  deviceWith({
    createdAt: NOW.minus({ days: 60 }).toISO()!,
    name: 'Blue Dream tent',
    configuration: CONFIGURATION,
    state: { lastSeenAt: lastSeenAt.toISO()!, claimedAt: NOW.minus({ days: 60 }).toISO()!, firmwareId: 'build-1' },
  });

/** The same controller with the sensor the CO2 target needs, which the one above does not report. */
const withCo2 = (): Device => {
  const one = device();
  return { ...one, state: { ...one.state, hardware: { ...one.state.hardware, co2: 'on' } } };
};

/**
 * The same controller saying it looked for a CO2 sensor and found none. The
 * base one above reports no key at all, which is a build too old to have been
 * asked rather than a missing sensor, and is read as "may have one".
 */
const withoutCo2 = (): Device => {
  const one = device();
  return { ...one, state: { ...one.state, hardware: { ...one.state.hardware, co2: 'off' } } };
};

/** What the page answered its writes with: each toast, with the way it is taken back. */
let told: Told[] = [];

const draw = (one: Device = device()) =>
  drawAt(
    <Toast told={told}>
      <PlanPanel device={one} mayManage landing={climateLanding(one)} />
    </Toast>,
  );

beforeAll(() => translate());

beforeEach(() => {
  may.youMay = 'own';
  told = [];
  state.plan = plan();
  state.planError = null;
  state.moveError = null;
  state.sent = [];
  state.removed = 0;
  state.devices = [];
  state.cameras = [];
  state.templates = undefined;
});

const drawTab = (sub: string | null = null, at = '/control', here: PlaceCard | null = null) =>
  drawAt(
    <Toast told={told}>
      <Control spaceId="space-1" sub={sub} here={here} />
    </Toast>,
    { at },
  );

describe('Steuerung of a place with nothing standing in it', () => {
  it('offers the one thing that would change that, and no row to a page that would be as empty', () => {
    drawTab();

    expect(screen.getByText(/Nothing to control yet/)).toBeInTheDocument();
    // One way to add, not a link in the note and a button under it.
    expect(screen.queryByRole('link', { name: 'Add a device' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Add a device or a camera' }));
    expect(within(screen.getByRole('dialog')).getAllByRole('link')[0]).toHaveAttribute('href', '/claim');
    expect(screen.queryByRole('link', { name: /^Alarms/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Targets' })).not.toBeInTheDocument();
  });
});

/**
 * What the tab offers a lamp or a plug. A step writes a climate and nothing
 * else, and a lamp's own document states its on and off times as plain seconds
 * under the same `day` and `night` keys a step would put an object over - so the
 * panel has to ask what the Manual targets page one tap below has always asked,
 * rather than heading itself "this controller" and offering six climate fields.
 */
describe('the plan panel over hardware that states no climate', () => {
  const lamp = (): Device => ({
    ...device(),
    id: 'device-2',
    type: 'light',
    name: 'Bar light',
    configuration: { day: 68400, night: 25200, limit: 65 },
  });

  beforeEach(() => {
    state.plan = null;
    state.planError = new ApiError({
      status: 404,
      code: 'plan_not_found',
      title: 'Not found',
      detail: 'This device is not running a plan.',
      errors: [],
    });
  });

  it('lists no lamp on the plan page, and says what is missing with the way back where that leaves it empty', async () => {
    state.devices = [lamp()];
    drawTab('plan');

    expect(await screen.findByText(/No device here takes targets from a plan\./)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Back to Control' }).at(-1)).toHaveAttribute('href', '/control?space=space-1');
    expect(screen.queryByText('Bar light')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write a plan' })).not.toBeInTheDocument();
  });

  it('refuses a controller whose document has not arrived the way the targets page refuses it', () => {
    const waiting = { ...device(), configuration: null };
    draw(waiting);

    expect(screen.getByText(/has not sent its settings yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write a plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start from a template' })).not.toBeInTheDocument();
  });
});

/**
 * Everything under Steuerung writes to a device standing in the place, which
 * the decision record puts at `manage`: the figures, the plan's moves, the
 * alarm rules, the devices' own buttons. A member who was let in to write in
 * the diary reads what is set and is offered none of it - absent, not
 * disabled - and is told once whose it is.
 */
describe('what Steuerung offers, by who is reading', () => {
  /** A device standing in somebody else's place: what the reader may do there is the place's to say. */
  const theirs = (): Device => ({ ...device(), ownerId: 'user-2' });

  beforeEach(() => {
    state.devices = [device()];
  });

  it('gives whoever steers the place each figure as a button, the rows, and the way to add a device', async () => {
    drawTab();

    expect(await screen.findByRole('button', { name: /^Change Day temperature, 25.0 °C/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Alarms/ })).toHaveAttribute('href', '/control/alarms?space=space-1');
    expect(screen.getByRole('link', { name: /^Grow plan/ })).toHaveAttribute('href', '/control/plan?space=space-1');
    expect(screen.getByRole('button', { name: '+ Add a device or a camera' })).toBeInTheDocument();
    expect(screen.queryByText(/You can log in this place but not manage it/)).not.toBeInTheDocument();
  });

  it('gives a member the figures to read, nothing that writes, and the reason once', async () => {
    may.youMay = 'log';
    state.devices = [theirs()];
    drawTab();

    expect(await screen.findByRole('table', { name: 'Targets' })).toHaveTextContent('25.0 °C');
    expect(screen.getAllByText(/You can log in this place but not manage it/)).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: /^Change|^Climate preset|the light limit$|Maintenance|Restart|Add a device/ }),
    ).not.toBeInTheDocument();
    // The pages behind the rows still open: what the tent is set to is worth reading.
    expect(screen.getByRole('link', { name: /^Alarms/ })).toBeInTheDocument();
  });

  it('gives a member the plan to read and none of its moves', async () => {
    may.youMay = 'log';
    state.devices = [theirs()];
    drawTab('plan');

    expect(await screen.findByText('Autoflower, 12 weeks')).toBeInTheDocument();
    for (const move of ['Pause', 'Extend', 'Skip', 'Stop', 'Confirm the step'])
      expect(screen.queryByRole('button', { name: move })).not.toBeInTheDocument();
    expect(screen.getByText(/You can log in this place but not manage it/)).toBeInTheDocument();
  });
});

/**
 * What Steuerung opens on. Somebody with one tent comes here to change a
 * temperature, so it opens on the climate - also while a plan runs, which
 * says where it stands in its own row rather than taking the page.
 */
describe('what Steuerung opens on, and the rows under the climate', () => {
  const noPlan = () => {
    state.plan = null;
    state.planError = new ApiError({ status: 404, code: 'plan_not_found', title: 'Not found', detail: 'No plan.', errors: [] });
  };

  beforeEach(() => {
    state.devices = [device()];
  });

  it('opens on the climate while a plan runs, and says where the plan stands in its row', async () => {
    drawTab();

    expect(await screen.findByRole('table', { name: 'Targets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Control/);
    // The plan's moves are on its own page.
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Grow plan/ })).toHaveTextContent(/Veg/);
  });

  it('says in the plan’s row that the targets are set by hand where no plan runs', async () => {
    noPlan();
    drawTab();

    expect(await screen.findByRole('table', { name: 'Targets' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Grow plan/ })).toHaveTextContent('off · you set the targets by hand');
    expect(screen.queryByText('No plan yet.')).not.toBeInTheDocument();
  });

  it('names a paused plan in its row, in the colour of what needs a person, and leaves continuing it to the plan page', async () => {
    state.plan = plan({}, { status: 'paused' });
    drawTab();

    expect(await screen.findByRole('table', { name: 'Targets' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume plan' })).not.toBeInTheDocument();
    const row = screen.getByRole('link', { name: /^Grow plan/ });
    const line = within(row).getByText(/paused/i);
    expect(line.closest('[data-tone="warn"]')).not.toBeNull();
    // The row leads to where it is continued, and does not send the reader to the page they are on.
    expect(row).toHaveAttribute('href', '/control/plan?space=space-1');
    expect(row).not.toHaveTextContent(/under Control/);
  });

  it('says why a paused plan stands still, as the pause wrote it down', () => {
    const t = i18next.t.bind(i18next);
    const paused = plan({}, { status: 'paused', stepStartedAt: null, pausedElapsedMs: 3_600_000, pauseReason: 'Targets set by hand' });

    expect(planLine(t, [paused], NOW)).toEqual({ text: 'Veg paused · Targets set by hand', warn: true });
  });

  /** The server stores the reason as words, in the language of whoever paused: the app's own are read back by them. */
  it('says a pause reason the app wrote in the reader´s language, and any other as it was stored', async () => {
    const t = i18next.t.bind(i18next);
    const paused = (pauseReason: string) => plan({}, { status: 'paused', stepStartedAt: null, pauseReason });
    // An English session holds no German catalogue: until it is fetched the words stand as stored.
    expect(planLine(t, [paused('Zielwerte von Hand gesetzt')], NOW).text).toBe('Veg paused · Zielwerte von Hand gesetzt');

    const german = await catalogue('de');
    const fetched = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(german) }));
    vi.stubGlobal('fetch', fetched);
    state.plan = paused('Zielwerte von Hand gesetzt');
    draw();

    expect(await screen.findByText('Paused: Targets set by hand')).toBeInTheDocument();
    expect(fetched).toHaveBeenCalledWith('/assets/i18n/de.json');
    expect(planLine(t, [paused('Die Regelung wurde ausgeschaltet.')], NOW).text).toBe('Veg paused · Control was switched off.');
    expect(planLine(t, [paused('Urlaub bis Montag')], NOW).text).toBe('Veg paused · Urlaub bis Montag');
    vi.unstubAllGlobals();
    i18next.removeResourceBundle('de', 'translation');
  });

  it('draws the plan page behind its row, titled by itself, with the way back to Steuerung', async () => {
    noPlan();
    drawTab('plan');

    expect(await screen.findByText('No plan yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Grow plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write a plan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Control' })).toHaveAttribute('href', '/control?space=space-1');
  });

  it('offers no template to start from while there is none', async () => {
    noPlan();
    state.templates = { items: [], nextCursor: null };
    drawTab('plan');

    expect(await screen.findByRole('button', { name: 'Write a plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start from a template' })).not.toBeInTheDocument();
  });

  it('leaves the rows out whose page would hold nothing: no plan and no mode for a lamp', async () => {
    noPlan();
    state.devices = [{ ...device(), id: 'device-2', type: 'light', name: 'Bar light', configuration: { day: 68400, night: 25200, limit: 65 } }];
    drawTab();

    expect(await screen.findByRole('region', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Alarms/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Grow plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Operating mode/ })).not.toBeInTheDocument();
  });

  /** The bar has no item for the devices: this is where one is found. */
  it('lists the devices standing in the place under the climate, each with the way to its own page', async () => {
    drawTab();

    expect(await screen.findByRole('heading', { name: 'Devices · Tent' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Everything about Blue Dream tent/ })).toHaveAttribute('href', '/devices/device-1');
  });
});

/**
 * A place holds any number of devices. Steuerung stays short with them, and a
 * page behind one of its rows leads with the place's own device.
 */
describe('Steuerung of a place with several devices', () => {
  const regulating = { running: true, drying: false, mode: 'standard', energySaving: false } as Device['control'];
  const plug = (): Device => ({ ...device(), id: 'device-2', type: 'plug', name: 'Pump socket', configuration: { workmode: 'heater' } });
  const second = (): Device => ({ ...device(), id: 'device-3', name: 'Second controller' });
  const here = (deviceIds: string[], climates: PlaceCard['climates'] = []): PlaceCard =>
    ({
      spaceId: 'space-1',
      name: 'Tent',
      deviceIds,
      values: [{ metric: 'temperature', value: 24, measuredAt: NOW.toISO(), state: 'live' }],
      climates,
    }) as unknown as PlaceCard;

  it('gives the place´s own device its card with what is done to the hardware, and every further device a short one', async () => {
    state.devices = [plug(), device()];
    drawTab();

    const lead = await screen.findByRole('region', { name: 'Blue Dream tent' });
    expect(within(lead).getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    // The further device says how it is and what it is set to, and leads to its page: its restart is there.
    const short = screen.getByRole('region', { name: 'Pump socket' });
    expect(short).toHaveTextContent('Switches by: Heating');
    expect(within(short).queryByRole('button')).not.toBeInTheDocument();
    expect(within(short).getByRole('link', { name: /Everything about Pump socket/ })).toHaveAttribute('href', '/devices/device-2');
    // The place's own device stands first, whatever order the account lists them in.
    expect(lead.compareDocumentPosition(short) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /** How a device is heard is said one way: the card's line has the words of the pill on its page, not some of its own. */
  it('says a device heard late and one gone silent in the pill´s words', async () => {
    state.devices = [
      device(),
      { ...plug(), state: { ...device().state, lastSeenAt: NOW.minus({ minutes: 4 }).toISO()! } },
      { ...second(), state: { ...device().state, lastSeenAt: NOW.minus({ minutes: 25 }).toISO()! } },
    ];
    drawTab();

    expect(await screen.findByRole('region', { name: 'Blue Dream tent' })).toHaveTextContent(/^Blue Dream tentonline(?! ·)/);
    expect(screen.getByRole('region', { name: 'Pump socket' })).toHaveTextContent('stale · 4 min ago');
    expect(screen.getByRole('region', { name: 'Second controller' })).toHaveTextContent('offline · for 25 min');
  });

  /** The tag printed on a cam tells two apart and nothing else: the place's only one is "Terp Cam", as in "Ort bearbeiten". */
  it('calls the place´s only camera by no tag, and tags two that nobody named', async () => {
    const paired = (id: string, did: string) => ({
      id,
      did,
      name: 'Blue Dream tent',
      kind: 'terpcam_controller',
      spaceId: 'space-1',
      deviceId: 'device-1',
      removedAt: null,
      state: { lastStillAt: null },
    });
    state.devices = [device()];
    state.cameras = [paired('cam-1', 'VSTC007171'), { ...paired('cam-9', 'VSTC009999'), spaceId: 'space-2' }];
    const { unmount } = drawTab();

    expect(await screen.findByRole('link', { name: /^Terp Cam(?! ·)/ })).toHaveAttribute('href', '/cameras/cam-1');
    unmount();

    state.cameras = [paired('cam-1', 'VSTC007171'), paired('cam-2', 'VSTC008282')];
    drawTab();
    expect(await screen.findByRole('link', { name: /^Terp Cam\s·\s7171/ })).toHaveAttribute('href', '/cameras/cam-1');
    expect(screen.getByRole('link', { name: /^Terp Cam\s·\s8282/ })).toHaveAttribute('href', '/cameras/cam-2');
  });

  it('names the three things that can be added, the Terp Cam among them', async () => {
    state.devices = [device()];
    drawTab();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add a device or a camera' }));
    const links = within(screen.getByRole('dialog')).getAllByRole('link');
    expect(links.map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Devicewith the code on its display', '/claim'],
      ['Terp Campaired at a device’s display', '/cameras/add'],
      ['Another camera (RTSP)an RTSP stream that shows a place', '/cameras/add?kind=rtsp'],
    ]);
  });

  /** The place lives and falls silent with its lead: a socket still reporting keeps no "Control on" in the head. */
  it('says a silent lead silent, once in its box, and claims no state of it, also while another device keeps the place live', async () => {
    const silent = { ...device(NOW.minus({ hours: 2 })), control: regulating };
    state.devices = [silent, plug()];
    drawTab(null, '/control', here(['device-1', 'device-2']));

    expect(await screen.findByRole('heading', { name: /^Blue Dream tent has been offline since / })).toBeInTheDocument();
    const head = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(head).not.toHaveTextContent('Control on');
    expect(head).not.toHaveTextContent('online');
  });

  /**
   * A controller never heard leaves its place waiting, whatever else of it reports: a socket that reported first made
   * the server's first climate, and the head read "online · 2 s ago" over "Controller · waiting for first readings".
   */
  it('waits for a controller never heard, named, while a socket beside it reports, and lists the controller first', async () => {
    const never = { ...device(), configuration: null, state: { ...device().state, lastSeenAt: null } } as unknown as Device;
    const socket = { ...plug(), configuration: { workmode: 'heater', heat: { on: 20, off: 22 } } } as unknown as Device;
    state.devices = [socket, never];
    drawTab(
      null,
      '/control',
      here(['device-2', 'device-1'], [
        { deviceId: 'device-2', values: [{ metric: 'temperature', value: 24, measuredAt: NOW.toISO(), state: 'live' }], setpoints: [] },
      ] as PlaceCard['climates']),
    );

    const head = (await screen.findByRole('heading', { level: 1 })).closest('header')!;
    await waitFor(() => expect(head).toHaveTextContent('waiting for first values · Blue Dream tent'));
    expect(head).not.toHaveTextContent('online');
    // Its note waits for it to be heard; nobody is sent to change a setting at the device.
    expect(await screen.findByText(/Blue Dream tent has not been heard from yet/)).toBeInTheDocument();
    expect(screen.queryByText(/on the device itself/)).not.toBeInTheDocument();
    // "Geräte hier" lists the lead first.
    const listed = document.body.textContent ?? '';
    expect(listed.lastIndexOf('Blue Dream tent')).toBeLessThan(listed.lastIndexOf('Pump socket'));
  });

  it('dates the device the page leads with in a place of two climates, not whichever of them spoke last', async () => {
    // The lead went quiet two hours ago; a second climate in the same place is live, and the place's merged values with it.
    const quiet = NOW.minus({ hours: 2 }).toISO();
    state.devices = [{ ...device(NOW.minus({ hours: 2 })), control: regulating }, second()];
    drawTab(
      null,
      '/control',
      here(['device-1', 'device-3'], [
        { deviceId: 'device-1', values: [{ metric: 'temperature', value: 22, measuredAt: quiet, state: 'offline' }], setpoints: [] },
        { deviceId: 'device-3', values: [{ metric: 'temperature', value: 24, measuredAt: NOW.toISO(), state: 'live' }], setpoints: [] },
      ] as PlaceCard['climates']),
    );

    const head = (await screen.findByRole('heading', { level: 1 })).closest('header')!;
    // The lead's silence is the box's under the head to say, once.
    expect(await screen.findByRole('heading', { name: /^Blue Dream tent has been offline since / })).toBeInTheDocument();
    expect(head).not.toHaveTextContent('Control on');
  });

  /** On a phone the head's pill, the box under it and the lead's card each said "offline", one under the other. */
  it('says a silent lead is offline once: in the box, not again in the head´s pill or on its card', async () => {
    state.devices = [{ ...device(NOW.minus({ hours: 2 })), control: regulating }];
    drawTab(
      null,
      '/control',
      here(['device-1'], [
        {
          deviceId: 'device-1',
          values: [{ metric: 'temperature', value: 22, measuredAt: NOW.minus({ hours: 2 }).toISO(), state: 'offline' }],
          setpoints: [],
        },
      ] as PlaceCard['climates']),
    );

    await screen.findByRole('heading', { name: /^Blue Dream tent has been offline since / });
    const said = (document.body.textContent ?? '').match(/\boffline\b/g) ?? [];
    expect(said).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Blue Dream tent' })).not.toHaveTextContent(/offline/);
  });

  it('names a device that has not sent its settings as its card does: no tail of its id beside one of its kind standing elsewhere', async () => {
    const unnamed = { ...device(), name: null, configuration: null };
    state.devices = [unnamed, { ...unnamed, id: 'device-9', spaceId: 'space-2' }];
    drawTab();

    expect(await screen.findByText(/^Controller has not sent its settings yet/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Controller' })).toBeInTheDocument();
  });

  it('says a heard lead regulates, and dates a place led by a device with no regulation of its own', async () => {
    state.devices = [{ ...device(), control: regulating }];
    const live = drawTab(null, '/control', here(['device-1']));

    const pill = await screen.findByText('Control on');
    expect(pill.closest('[data-tone]')).toBeNull();
    live.unmount();

    // A socket has no regulation to report: the head says how fresh the place is instead of nothing.
    state.devices = [plug()];
    drawTab(null, '/control', here(['device-2']));
    await screen.findByRole('region', { name: 'Pump socket' });
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).toHaveTextContent(/online/);
  });

  it('leads a page with the place´s own device, folds every other behind a row and lists none with nothing for the page', async () => {
    state.plan = plan({}, { status: 'paused', stepStartedAt: null, pauseReason: null });
    state.devices = [plug(), device(), second()];
    drawTab('plan');

    // The plan mock answers one plan, the first controller's: it stands open under its name.
    expect(await screen.findByRole('heading', { level: 2, name: 'Blue Dream tent' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Autoflower, 12 weeks' })).toBeInTheDocument();
    // The second controller is one row; the socket follows no plan and is not listed at all.
    const fold = screen.getByRole('button', { name: /Second controller/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Pump socket')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing here runs on a plan.')).not.toBeInTheDocument();

    fireEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('region', { name: 'Second controller' })).getByText('Autoflower, 12 weeks')).toBeInTheDocument();
  });

  it('opens a page with the device a link names unfolded', async () => {
    state.devices = [device(), second()];
    drawTab('plan', '/control/plan?space=space-1&device=device-3');

    expect(await screen.findByRole('button', { name: /Second controller/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says what is missing on a page with nothing for the place, with the way back', async () => {
    // A tent controller has no mode to choose: germination and drying come with the climate preset.
    state.devices = [{ ...device(), control: regulating }];
    drawTab('mode');

    expect(
      await screen.findByText(/There is no operating mode to choose here\. Germination and drying come with the climate preset\./),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Back to Control' }).at(-1)).toHaveAttribute('href', '/control?space=space-1');
  });

  it('says nothing of germination on the empty mode page of a place whose hardware has no work mode', async () => {
    state.devices = [plug()];
    drawTab('mode');

    expect(await screen.findByText(/There is no operating mode to choose here\./)).toBeInTheDocument();
    expect(screen.queryByText(/Germination/)).not.toBeInTheDocument();
  });

  /** A fan's card is everything it has: no plan while it follows no target, and no row to a page that says the card again. */
  it('offers a fan place only what the fan has in the mode it runs', async () => {
    state.plan = null;
    state.planError = new ApiError({ status: 404, code: 'plan_not_found', title: 'Not found', detail: 'No plan.', errors: [] });
    const fan = (mode: number): Device =>
      ({
        ...device(),
        id: 'device-2',
        type: 'fan',
        name: null,
        control: null,
        configuration: { mode, day: { temperature: 25, humidity: 60, fixed_speed: 70 }, night: { temperature: 21, humidity: 55, fixed_speed: 40 } },
      }) as Device;
    state.devices = [fan(0)];
    const fixed = drawTab();

    expect((await screen.findAllByRole('region', { name: 'Fan' }))[0]).toHaveTextContent('Fixed');
    expect(screen.getByRole('link', { name: /^Alarms/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Grow plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Outputs/ })).not.toBeInTheDocument();
    fixed.unmount();

    // Following the temperature it holds targets, which a plan could set.
    state.devices = [fan(1)];
    const following = drawTab();
    expect(await screen.findByRole('link', { name: /^Grow plan/ })).toHaveTextContent('off · you set the targets by hand');
    expect(screen.queryByRole('link', { name: /^Outputs/ })).not.toBeInTheDocument();
    following.unmount();

    // The page reached by its address says so rather than repeating the card.
    drawTab('outputs');
    expect(await screen.findByText(/Nothing here has outputs of its own/)).toBeInTheDocument();
  });

  it('says the fan of a further device among the outputs, which lead to its page', async () => {
    const fan = {
      ...device(),
      id: 'device-2',
      type: 'fan',
      name: null,
      control: null,
      configuration: { mode: 0, day: { fixed_speed: 70 }, night: { fixed_speed: 40 } },
    } as Device;
    state.devices = [device(), fan];
    drawTab();

    expect(await screen.findByRole('link', { name: /^Outputs/ })).toHaveTextContent('Fan fixed · By day 70 % · At night 40 %');
  });

  /** Every setting has one place: among the outputs a further fan's speed is said, and its row leads to where it is set. */
  it('says a further fan´s speed on the outputs page, with the way to its own page and no control of its own', async () => {
    const fan = {
      ...device(),
      id: 'device-2',
      type: 'fan',
      name: null,
      control: null,
      configuration: { mode: 0, day: { fixed_speed: 70 }, night: { fixed_speed: 40 } },
    } as Device;
    state.devices = [device(), fan];
    drawTab('outputs');

    const row = await screen.findByRole('link', { name: /^Fan/ });
    expect(row).toHaveTextContent('Fixed · By day 70 % · At night 40 %');
    expect(row).toHaveAttribute('href', '/devices/device-2');
  });

  it('does not say that the targets are set by hand of a device whose control is off', async () => {
    state.plan = null;
    state.planError = new ApiError({ status: 404, code: 'plan_not_found', title: 'Not found', detail: 'No plan.', errors: [] });
    state.devices = [{ ...device(), control: { ...regulating!, running: false } }];
    drawTab();

    const row = await screen.findByRole('link', { name: /^Grow plan/ });
    expect(row).toHaveTextContent(/off$/);
    expect(row).not.toHaveTextContent(/by hand/);
  });
});

/**
 * Every move of a plan is answered by a toast that names what changed, since
 * the button that asked may be gone with it; only a pause is taken back.
 */
describe('what a plan´s move is answered with', () => {
  it('names the plan that was paused, and takes the pause back by continuing it', async () => {
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(told.map(one => one.label)).toEqual(['“Autoflower, 12 weeks” paused']);
    await told[0].undo!();
    expect(state.sent).toEqual([{ kind: 'pause', reason: null }, { kind: 'resume' }]);
  });

  it('says where a skip led and that a stop stopped, with nothing to take back', () => {
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip the step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop the plan' }));

    expect(told.map(one => [one.label, one.undo])).toEqual([
      ['On to Flower', null],
      ['“Autoflower, 12 weeks” stopped', null],
    ]);
    // One toast per plan: the next move's answer takes the last one's place.
    expect(new Set(told.map(one => one.from))).toEqual(new Set(['plan-device-1']));
  });

  it('says nothing of a move the server refused', () => {
    state.moveError = new ApiError({ status: 409, code: 'plan_not_running', title: 'Conflict', detail: 'Not running.', errors: [] });
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(told).toEqual([]);
  });
});

/**
 * A lamp held by hand keeps to no schedule, so the card that states the
 * schedule says so - by what this browser asked of it, the device reporting
 * no hold of its own lamp - with the way to where it is handed back.
 */
describe('the Licht card of a lamp held by hand', () => {
  afterEach(() => localStorage.clear());

  it('says which way it is held and until when, and leads to the hold´s own control', async () => {
    localStorage.setItem('terp.lightHold.device-1', JSON.stringify({ state: 'off', until: NOW.plus({ minutes: 65 }).toISO() }));
    state.devices = [device()];
    drawTab();

    const light = await screen.findByRole('region', { name: 'Light' });
    expect(within(light).getByRole('status')).toHaveTextContent('held off until 13:05');
    expect(within(light).getByRole('link', { name: 'Back to auto ›' })).toHaveAttribute('href', '/control/outputs?space=space-1&device=device-1');
  });

  it('says nothing once the hold has run out', async () => {
    localStorage.setItem('terp.lightHold.device-1', JSON.stringify({ state: 'off', until: NOW.minus({ minutes: 1 }).toISO() }));
    state.devices = [device()];
    drawTab();

    const light = await screen.findByRole('region', { name: 'Light' });
    expect(within(light).queryByText(/held off/)).not.toBeInTheDocument();
  });
});

/**
 * A row is read rather than opened to find out: its line is the page's state
 * in a few words, and amber only where somebody is needed.
 */
describe('what a row says about the page behind it', () => {
  const t = i18next.t.bind(i18next);
  const rule = (over: object) => ({ id: 'rule', enabled: true, name: 'Too warm', state: { triggered: false }, ...over }) as unknown as AlarmRule;
  const socket = (role: string, slot: number, over: object = {}) =>
    ({ slot, role, hardwareId: '', address: '', state: 'on', override: null, timer: null, stateChangedAt: null, ...over }) as Socket;
  const sockets = (...items: Socket[]) =>
    ({
      items,
      nextCursor: null,
      capabilities: { socketOverride: true, socketTimer: true, lightOverride: false, roles: [], pulseSeconds: {} },
    }) as SocketPage;

  /** A place read as "1 rule · all quiet" while six of its seven rules were off, the offline rule among them. */
  it('counts the alarm rules that are on against those there are, and says in amber that the offline rule is off', () => {
    expect(alarmsLine(t, [rule({}), rule({ id: 'b' })])).toEqual({ text: '2 rules · all quiet', warn: false });
    expect(alarmsLine(t, [rule({}), rule({ id: 'b' }), rule({ id: 'c', enabled: false })])).toEqual({
      text: '2 of 3 rules on · all quiet',
      warn: false,
    });
    expect(alarmsLine(t, [rule({}), rule({ id: 'b', name: 'Too humid', state: { triggered: true } })])).toEqual({
      text: '2 rules · “Too humid” has gone off',
      warn: true,
    });
    expect(alarmsLine(t, [rule({}), rule({ id: 'b', enabled: false }), rule({ id: 'c', origin: 'always', enabled: false })])).toEqual({
      text: '1 of 3 rules on · all quiet · “Device offline” off',
      warn: true,
    });
    expect(alarmsLine(t, [rule({ enabled: false })])).toEqual({ text: 'no rule on', warn: false });
    expect(alarmsLine(t, [rule({ origin: 'always', enabled: false })])).toEqual({ text: 'no rule on', warn: true });
  });

  /** "Alarme · 100 Regeln" was said of a device with 110: the list is read one page deep, the figures are the server's. */
  it('counts the rules the server counts, not the ones on the page it read', () => {
    const page = [rule({}), rule({ id: 'b', name: 'Too humid', state: { triggered: true } })];

    expect(alarmsLine(t, page, [{ total: 110, enabled: 104, triggered: 1 }])).toEqual({
      text: '104 of 110 rules on · “Too humid” has gone off',
      warn: true,
    });
    // A rule raised on a page not read is counted, not named.
    expect(
      alarmsLine(t, page, [
        { total: 60, enabled: 60, triggered: 2 },
        { total: 50, enabled: 50, triggered: 1 },
      ]),
    ).toEqual({
      text: '110 rules · 3 have gone off',
      warn: true,
    });
  });

  /** Only a smart socket reports a hold: "all on auto" is claimed of a list made of sockets, and never of a lamp. */
  it('says each output with what it does, and "all on auto" only of sockets', () => {
    const lampless = { ...device(), configuration: { day: { temperature: 25 } } } as Device;
    const withSockets = outputsOf(lampless, sockets(socket('exhaust', 0), socket('humidifier', 1, { state: 'off' })), null);
    expect(outputsLine(t, [withSockets], NOW, null)).toEqual({ text: 'Exhaust on · Humidifier off · all on auto', warn: false });

    const held = outputsOf(
      lampless,
      sockets(socket('exhaust', 0, { override: { state: 'on', validUntil: NOW.plus({ minutes: 40 }).toISO() } })),
      null,
    );
    expect(outputsLine(t, [held], NOW, null, 'as of 13:49')).toEqual({ text: 'as of 13:49 · Exhaust held on, 40 min', warn: true });

    // The controller's own lamp reports no hold back, so nothing is claimed about it - only what it runs at.
    const level = { percent: 80, measuredAt: NOW.toISO()!, state: 'live' as const };
    const lamp = outputsOf(device(), sockets(socket('exhaust', 0)), level);
    expect(outputsLine(t, [lamp], NOW, null)).toEqual({ text: 'Light 80 % · Exhaust on', warn: false });
    expect(outputsLine(t, [outputsOf(device(), sockets(), { ...level, percent: 0 })], NOW, null).text).toBe('Light off');
  });

  it('says a lamp held by hand in the outputs´ line, until when, in the colour of what needs a person', () => {
    const lamp = outputsOf(device(), sockets(socket('exhaust', 0)), { percent: 0, measuredAt: NOW.toISO()!, state: 'live' });
    const hold = new Map([['device-1', { state: 'off' as const, until: NOW.plus({ minutes: 65 }).toISO()! }]]);

    expect(outputsLine(t, [lamp], NOW, null, null, hold)).toEqual({ text: 'Light held off until 13:05 · Exhaust on', warn: true });
  });

  /** A fan's mode stands with the fan it is of as one fact, so no line ends on a bare "Fixed" nor reads "Fan: Fixed". */
  it('binds an AIR fan´s mode to its name', () => {
    const fan = { ...device(), type: 'fan', configuration: { mode: 0, day: { fixed_speed: 70 }, night: { fixed_speed: 40 } } } as unknown as Device;
    const line = outputsLine(t, [outputsOf(fan, sockets(), null)], NOW, null).text;

    expect(line).toBe('Fan fixed · By day 70 % · At night 40 %');
  });

  /**
   * The one rule of a line that sums up a device. A fan silent since 13:54 whose mode was changed at 16:07 read "as of
   * 13:54 · Fan by temperature": a setting dated to a moment at which the device held another.
   */
  it('dates what a silent device reported and says a setting it has not been handed as stored, never as of then', () => {
    const saved = NOW.minus({ minutes: 20 }).toISO()!;
    const fan = {
      ...device(),
      type: 'fan',
      name: null,
      configuration: { mode: 1, day: { max_speed: 100 }, night: { max_speed: 60 } },
    } as unknown as Device;
    const waits = new Map([['mode', { field: 'mode', held: 0, savedAt: saved }]]);
    expect(outputsLine(t, [outputsOf(fan, sockets(), null)], NOW, null, 'as of 09:54', new Map(), waits)).toEqual({
      text: 'Fan by temperature saved at 11:40, not with the device yet',
      warn: true,
    });
    // Handed to the device before it fell silent, the setting is what is stored and carries no date either.
    expect(outputsLine(t, [outputsOf(fan, sockets(), null)], NOW, null, 'as of 09:54').text).toBe('Fan by temperature');

    // A fridge's lamp is a report and stands as of then; its fans are settings, and the one stored since is said as that.
    const fridge = {
      ...device(),
      type: 'fridge',
      configuration: { day: { temperature: 25 }, fans: { external: 50, internal: 60 } },
    } as unknown as Device;
    const level = { percent: 100, measuredAt: NOW.minus({ hours: 2 }).toISO()!, state: 'offline' as const };
    const pending = new Map([['fans.external', { field: 'fans.external', held: 40, savedAt: saved }]]);
    expect(outputsLine(t, [outputsOf(fridge, sockets(), level)], NOW, null, 'as of 09:54', new Map(), pending)).toEqual({
      text: 'as of 09:54 · Light 100 % · Clip fan 50 % saved at 11:40, not with the device yet · Inner fans, at least 60 %',
      warn: true,
    });
    // Only the place's own device is read for what it has not taken: a further device's settings stand as stored.
    expect(
      outputsLine(t, [outputsOf(device(), sockets(), level), outputsOf(fan, sockets(), null)], NOW, null, 'as of 09:54', new Map(), waits).text,
    ).toBe('as of 09:54 · Light 100 % · Fan by temperature');
    expect(notTaken(t, 'Control off', saved, NOW, null)).toBe('Control off saved at 11:40, not with the device yet');
  });

  /** The fan's card is its speed: where the card stands, Ausgänge has nothing more to say of it. */
  it('counts an AIR fan´s speed among the outputs only where its card does not stand', () => {
    const fan = { ...device(), type: 'fan', configuration: { mode: 0, day: { fixed_speed: 70 }, night: { fixed_speed: 40 } } } as unknown as Device;
    expect(outputsOf(fan, sockets(), null).speed).toBe(true);
    expect(outputsOf(fan, sockets(), null, true).speed).toBe(false);
  });

  it('offers a plan only to a device that could follow one as it runs', () => {
    const fan = (mode: number) =>
      ({ ...device(), type: 'fan', control: null, configuration: { mode, day: { temperature: 25, humidity: 60 } } }) as unknown as Device;
    expect(followsPlan(device())).toBe(true);
    expect(followsPlan(fan(1))).toBe(true);
    expect(followsPlan(fan(0))).toBe(false);
    expect(followsPlan({ ...device(), type: 'plug', configuration: { mode: 2 } } as unknown as Device)).toBe(false);
  });

  it('says of no plan that the targets are set by hand only while something holds targets', () => {
    expect(planLine(t, [], NOW)).toEqual({ text: 'off · you set the targets by hand' });
    expect(planLine(t, [], NOW, false)).toEqual({ text: 'off' });
  });

  it('leads a further device´s outputs with its name, unless its one output is called the same', () => {
    const level = { percent: 100, measuredAt: NOW.toISO()!, state: 'live' as const };
    const second = { ...device(), id: 'device-3', name: 'Second controller' } as Device;
    const lamp = { ...device(), id: 'device-4', type: 'light', name: null, configuration: { day: 68400, night: 25200, limit: 65 } } as Device;

    expect(
      outputsLine(t, [outputsOf(device(), sockets(), level), outputsOf(second, sockets(), level), outputsOf(lamp, sockets(), level)], NOW, null).text,
    ).toBe('Light 100 % · Second controller · Light 100 % · Light 100 %');
  });

  it('says the mode that runs and what else its page offers', () => {
    const fridge = { ...device(), type: 'fridge', control: { running: true, drying: false, mode: 'standard', energySaving: false } } as Device;
    expect(modeLine(t, fridge, NOW, null)).toEqual({ text: 'Standard · also Greenhouse, Energy saving', warn: false });
    expect(modeLine(t, { ...fridge, control: { ...fridge.control!, drying: true } }, NOW, null)).toEqual({
      text: 'Drying · set by the climate preset',
      warn: true,
    });
  });

  /** A mode, the energy saving and control off are one key of the document: each is said as what was stored. */
  it('says a mode a silent device has not been handed as stored, in the row it lives behind', () => {
    const control = { running: true, drying: false, mode: 'greenhouse', energySaving: false };
    const fridge = { ...device(), type: 'fridge', control } as unknown as Device;
    const held = (was: string) => new Map([['workmode', { field: 'workmode', held: was, savedAt: NOW.minus({ minutes: 20 }).toISO()! }]]);

    expect(modeLine(t, fridge, NOW, null, held('small'))).toEqual({
      text: 'Greenhouse saved at 11:40, not with the device yet · also Standard, Energy saving',
      warn: true,
    });
    expect(modeLine(t, { ...fridge, control: { ...control, mode: 'standard', running: false } } as Device, NOW, null, held('small')).text).toBe(
      'Standard · also Greenhouse, Energy saving · Control off saved at 11:40, not with the device yet',
    );
    expect(modeLine(t, { ...fridge, control: { ...control, mode: 'standard', energySaving: true } } as Device, NOW, null, held('small')).text).toBe(
      'Standard · also Greenhouse, Energy saving · Energy saving on saved at 11:40, not with the device yet',
    );
    expect(offNotTaken({ ...fridge, control: { ...control, running: false } } as Device, held('small'))?.held).toBe('small');
    expect(offNotTaken({ ...fridge, control: { ...control, running: false } } as Device, held('off'))).toBeNull();
    expect(offNotTaken(fridge, held('small'))).toBeNull();
    // Switched on while it held none, it is "Control on" that waits, not the mode it comes back to.
    const on = { ...fridge, control: { ...control, mode: 'standard' } } as Device;
    expect(modeLine(t, on, NOW, null, held('off')).text).toBe(
      'Standard · also Greenhouse, Energy saving · Control on saved at 11:40, not with the device yet',
    );
    expect(onNotTaken(on, held('off'))?.savedAt).toBe(NOW.minus({ minutes: 20 }).toISO());
    expect(onNotTaken(on, held('small'))).toBeNull();
  });
});

/**
 * The clock line carries a served age and a countdown, and they are rounded in
 * opposite directions. Rounded the same way, the remainder read a full day
 * short of the step length printed one line above it for the whole of the
 * step's first day - which is the day somebody decides in whether to flush or
 * harvest before the step turns over.
 */
describe('the clock under a running step', () => {
  it('leaves a step that has barely begun the whole length it states', () => {
    state.plan = plan(
      { steps: [step({ stage: null, duration: { value: 7, unit: 'days' } })] },
      { stepStartedAt: NOW.minus({ minutes: 25 }).toISO()! },
    );

    draw();

    // The header states the step's length and the ladder below it repeats it.
    expect(screen.getAllByText('No phase · 7 days')).not.toHaveLength(0);
    expect(screen.getByText('25 min on this step · 7 d left')).toBeInTheDocument();
  });

  it('still counts what has been served the way every other age is counted', () => {
    state.plan = plan(
      { steps: [step({ stage: null, duration: { value: 7, unit: 'days' } })] },
      { stepStartedAt: NOW.minus({ days: 3, hours: 23 }).toISO()! },
    );

    draw();

    expect(screen.getByText('3 d on this step · 4 d left')).toBeInTheDocument();
  });

  /**
   * "More time" is the server pushing the step's clock forward by what was
   * added, so for that long the step has served less than none of itself.
   * Holding that at zero threw the whole extension away: the panel repeated one
   * line for as long as the extension lasted, on a step the server could not end
   * until it was over.
   */
  it('counts an extension into what is left, rather than freezing the line for its length', () => {
    state.plan = plan(
      { steps: [step({ stage: null, duration: { value: 10, unit: 'minutes' } })] },
      { stepStartedAt: NOW.plus({ hours: 5 }).toISO()! },
    );

    draw();

    expect(screen.getByText('extended: this step’s clock starts in 5 h · 6 h left')).toBeInTheDocument();
  });

  it('calls a step that has only just been started started, not extended', () => {
    state.plan = plan(
      { steps: [step({ stage: null, duration: { value: 2, unit: 'minutes' } })] },
      { stepStartedAt: NOW.plus({ seconds: 1 }).toISO()! },
    );

    draw();

    expect(screen.queryByText(/extended/)).not.toBeInTheDocument();
    expect(screen.getByText(/on this step · 2 min left/)).toBeInTheDocument();
  });

  it('reads the same elapsed the engine reads, so a step that is over is over on both sides', () => {
    const extended = plan(
      { steps: [step({ duration: { value: 10, unit: 'minutes' }, waitForConfirmation: true })] },
      { stepStartedAt: NOW.plus({ hours: 5 }).toISO()! },
    );

    expect(elapsedMs(extended.state, NOW)).toBeLessThan(0);
    expect(throughStep(extended, NOW)).toBe(0);
    expect(leftMs(extended, NOW)).toBe(5 * 60 * 60 * 1000 + 10 * 60 * 1000);
    expect(movesOf(extended, NOW).confirm).toBe(false);
  });
});

describe('what saving an edited recipe would do to the tent', () => {
  it('keeps the running step and its clock when another is inserted above it', () => {
    const running = plan();
    const draft = draftOf(running);
    const effect = editEffect(running, [{ ...draft.steps[0], key: 'new', id: undefined, name: 'Soak' }, ...draft.steps], NOW);

    expect(effect.keeps).toMatchObject({ name: 'Veg', from: 1, to: 2, relength: false });
    expect(effect.restarts).toBeNull();
    expect(effect.keeps!.servedMs).toBe(4 * 86_400_000);
  });

  it('says the replacement starts from zero when the running step is removed', () => {
    const running = plan();
    const draft = draftOf(running);
    const effect = editEffect(running, draft.steps.slice(1), NOW);

    expect(effect.restarts).toEqual({ gone: 'Veg', starts: 'Flower', at: 1 });
    expect(effect.keeps).toBeNull();
  });

  it('says a plan left without steps stops', () => {
    const effect = editEffect(plan(), [], NOW);

    expect(effect.empties).toBe(true);
    expect(effect.resends).toBe(false);
  });

  it('promises nothing about a plan that is not running', () => {
    const effect = editEffect(plan({}, { status: 'stopped', stepStartedAt: null }), draftOf(plan()).steps, NOW);

    expect(effect.atRest).toBe(true);
    expect(effect.keeps).toBeNull();
  });

  it('says the new length is measured against the time already served', () => {
    const running = plan();
    const draft = draftOf(running);
    const effect = editEffect(running, [{ ...draft.steps[0], duration: { value: 3, unit: 'days' } }, draft.steps[1]], NOW);

    expect(effect.keeps).toMatchObject({ relength: true, from: 1, to: 1 });
  });

  it('leaves the list alone when a step is moved off either end', () => {
    const steps = draftOf(plan()).steps;

    expect(moveStep(steps, 0, -1)).toBe(steps);
    expect(moveStep(steps, 1, 1)).toBe(steps);
    expect(moveStep(steps, 0, 1).map(one => one.name)).toEqual(['Flower', 'Veg']);
  });
});

describe('the moves a plan offers', () => {
  const at = (over: Partial<Plan['state']>) => movesOf(plan({}, over), NOW);

  it('offers a confirmation only once the step that waits has run out', () => {
    const waiting = plan(
      { steps: [step({ waitForConfirmation: true, duration: { value: 1, unit: 'days' } })] },
      { stepStartedAt: NOW.minus({ hours: 2 }).toISO()! },
    );
    const over = plan(
      { steps: [step({ waitForConfirmation: true, duration: { value: 1, unit: 'days' } })] },
      { stepStartedAt: NOW.minus({ days: 2 }).toISO()! },
    );

    expect(movesOf(waiting, NOW).confirm).toBe(false);
    expect(movesOf(over, NOW).confirm).toBe(true);
  });

  it('offers to start a plan at rest and to pause one that runs, never both', () => {
    expect(at({ status: 'running' })).toMatchObject({ pause: true, resume: false, stop: true });
    expect(at({ status: 'stopped', stepStartedAt: null })).toMatchObject({ pause: false, resume: true, stop: false, skip: false });
    expect(at({ status: 'paused', stepStartedAt: null, pausedElapsedMs: 600_000 })).toMatchObject({
      pause: false,
      resume: true,
      skip: true,
      extend: true,
    });
  });

  it('offers to remove a plan only once it is at rest', () => {
    expect(at({ status: 'running' }).remove).toBe(false);
    expect(at({ status: 'paused', stepStartedAt: null, pausedElapsedMs: 600_000 }).remove).toBe(false);
    expect(at({ status: 'stopped', stepStartedAt: null }).remove).toBe(true);
    expect(at({ status: 'completed', stepStartedAt: null }).remove).toBe(true);
  });

  it('offers nothing to start on a plan that has no steps to run', () => {
    expect(movesOf(plan({ steps: [] }, { status: 'stopped', stepStartedAt: null }), NOW).resume).toBe(false);
  });
});

describe('the settings a step carries', () => {
  const day = CLIMATE_FIGURES[0];
  const dayHumidity = CLIMATE_FIGURES[1];

  it('carries only the figure that is written, leaving the rest of the section to the controller', () => {
    const written = withFigure({}, day, 28);

    expect(written.day).toEqual({ temperature: 28 });
    expect(otherSections(written)).toEqual([]);
  });

  it('drops the whole section when its last figure is cleared, so the step writes nothing there', () => {
    const one = withFigure({}, day, 28);
    const both = withFigure(one, dayHumidity, 55);

    expect(figureOf(withFigure(both, day, null), dayHumidity)).toBe(55);
    expect(withFigure(withFigure(both, day, null), dayHumidity, null).day).toBeUndefined();
  });

  it('reads a figure a migrated recipe wrote flat as the same figure', () => {
    expect(figureOf({ 'day.temperature': 24 }, day)).toBe(24);
  });

  it('names the sections it does not edit rather than hiding them', () => {
    expect(otherSections({ day: { temperature: 24 }, workmode: 'small' })).toEqual(['workmode']);
  });

  /**
   * A controller without the sensor forces its CO2 target to nothing as it reads
   * the document, so a step offering the figure would be storing a number the
   * hardware is known not to run - the figure the manual targets page on the
   * same tab draws as a dead row.
   */
  it('offers no CO2 figure for a controller that reports no sensor, and offers one for a controller that does', () => {
    expect(figuresFor(withoutCo2()).map(one => one.key)).not.toContain('co2');
    expect(figuresFor(withCo2()).map(one => one.key)).toContain('co2');
  });

  it('keeps the CO2 figure for a build too old to say whether it has a sensor', () => {
    // A fridge on older firmware streamed 300 ppm while reporting no co2 key at
    // all; reading that absence as "no sensor" hid a target the device holds.
    expect(figuresFor(device()).map(one => one.key)).toContain('co2');
  });

  it('draws the CO2 row of the step editor dead for such a controller, in the words the targets page uses', () => {
    const draft = draftOf(plan({ steps: [step({ settings: { day: { temperature: 26 }, co2: { target: 900 } } })] }));
    drawAt(<PlanEditor device={withoutCo2()} plan={null} draft={draft} onClose={() => {}} />);

    // A draft of one step opens that step, which is the sheet's own rule.
    expect(screen.getByText('needs a CO₂ sensor')).toBeInTheDocument();
    expect(screen.queryByText('CO₂ target · ppm')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('900')).not.toBeInTheDocument();
  });

  it('takes a CO2 target out of a step opened for such a controller, so the step writes what it shows', () => {
    const carried = {
      ...emptyDraft('A plan', { mode: 'off' as const, email: null, writeEntries: true }),
      steps: [
        {
          key: 'draft-x',
          name: 'Veg',
          stage: null,
          preset: null,
          duration: { value: 1, unit: 'weeks' as const },
          settings: { co2: { target: 900 }, day: { temperature: 24 } },
          lightHours: null,
          waitForConfirmation: false,
          confirmationMessage: null,
          germinationChoices: null,
        },
      ],
    };

    expect(asWritableBy(carried, withoutCo2()).steps[0].settings).toEqual({ day: { temperature: 24 } });
    expect(asWritableBy(carried, withCo2()).steps[0].settings).toEqual({ co2: { target: 900 }, day: { temperature: 24 } });

    // A drying step is opened holding what drying holds: the night's two figures, no day, CO₂, light limit or light hours.
    const drying = {
      ...carried,
      steps: [
        {
          ...carried.steps[0],
          stage: 'drying' as const,
          lightHours: 18,
          settings: { co2: { target: 900 }, day: { temperature: 24 }, night: { temperature: 18, humidity: 58 }, lights: { limit: 0 } },
        },
      ],
    };
    expect(asWritableBy(drying, withCo2()).steps[0]).toMatchObject({ lightHours: null, settings: { night: { temperature: 18, humidity: 58 } } });
    expect(Object.keys(asWritableBy(drying, withCo2()).steps[0].settings)).toEqual(['night']);
  });
});

describe('the plan panel', () => {
  it('says plainly that a step is standing still until it is confirmed, and offers the answer', () => {
    state.plan = plan(
      { steps: [step({ waitForConfirmation: true, confirmationMessage: 'Check the buds', duration: { value: 1, unit: 'days' } })] },
      { stepStartedAt: NOW.minus({ days: 2 }).toISO()! },
    );
    draw();

    expect(screen.getByText('Check the buds')).toBeInTheDocument();
    expect(screen.getByText(/the plan goes no further until it is confirmed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm the step' }));
    expect(state.sent).toEqual([{ kind: 'confirm' }]);
  });

  it('says what a skip will do before it does it', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.getByText(/The plan moves on to step 2, Flower/)).toBeInTheDocument();
    expect(state.sent).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Skip the step' }));
    expect(state.sent).toEqual([{ kind: 'skip' }]);
  });

  it('says that a paused plan stays paused when a step is skipped', () => {
    state.plan = plan({}, { status: 'paused', stepStartedAt: null, pausedElapsedMs: 600_000 });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.getByText(/moves on to step 2, Flower and stays paused/)).toBeInTheDocument();
  });

  it('turns a refusal into the thing to do about it', () => {
    state.moveError = new ApiError({
      status: 409,
      code: 'plan_already_running',
      title: 'Conflict',
      detail: 'This plan is already running.',
      errors: [],
    });
    draw();

    expect(screen.getAllByText('This plan is already running.')[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Read it again' })[0]).toBeInTheDocument();
  });

  it('says what removing a plan keeps before it takes the plan away', () => {
    state.plan = plan({}, { status: 'stopped', stepStartedAt: null });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the plan' }));

    expect(screen.getByText(/The device keeps whatever it was last set to/)).toBeInTheDocument();
    expect(state.removed).toBe(0);

    const buttons = screen.getAllByRole('button', { name: 'Remove the plan' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(state.removed).toBe(1);
  });

  /** "Als Nächstes · Schritt 2, Schritt 2": a step that kept the name it was given names its number once. */
  it('names the next step by its number, and by its name only where it has one of its own', () => {
    draw();
    expect(screen.getByText('Next · step 2, Flower')).toBeInTheDocument();
    cleanup();

    state.plan = plan({ steps: [step(), step({ id: 'step-2', name: 'Step 2' })] });
    draw();
    expect(screen.getByText('Next · step 2')).toBeInTheDocument();
    cleanup();

    state.plan = plan({ steps: [step({ name: 'Step 1' }), step({ id: 'step-2', name: 'Step 2' })], loop: true }, { activeStepIndex: 1 });
    draw();
    expect(screen.getByText('Next · back to step 1 – this plan loops.')).toBeInTheDocument();
  });

  /** The head said "Step 1 of 2 Step 1", and a step its German writer left as "Schritt 2" read so in English. */
  it('says a step whose name is its number once, by the number, in the reader´s language whoever wrote it', async () => {
    state.plan = plan({ steps: [step({ name: 'Step 1' }), step({ id: 'step-2', name: 'Flower' })] });
    draw();
    expect(screen.getByText('Step 1 of 2').closest('p')).toHaveTextContent(/^Step 1 of 2$/);
    cleanup();

    const german = await catalogue('de');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(german) })),
    );
    state.plan = plan({ steps: [step({ name: 'Schritt 1' }), step({ id: 'step-2', name: 'Schritt 2' })] });
    draw();

    expect(await screen.findByText('Next · step 2')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2').closest('p')).toHaveTextContent(/^Step 1 of 2$/);
    expect(screen.getAllByText('Step 2').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Schritt/)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
    i18next.removeResourceBundle('de', 'translation');
  });

  it('puts a plan that has run every step at none of them', () => {
    state.plan = plan({}, { status: 'completed', activeStepIndex: 0, stepStartedAt: null });
    draw();

    expect(screen.getAllByText('Completed')[0]).toBeInTheDocument();
    expect(screen.queryByText(/Step 1 of/)).not.toBeInTheDocument();
    expect(screen.getByText('Every step has run; started again, it begins at step 1.')).toBeInTheDocument();
  });

  it('dates the last time the step reached the controller rather than claiming it is running it', () => {
    state.plan = plan({}, { lastAppliedAt: NOW.minus({ minutes: 20 }).toISO()! });
    draw();

    expect(screen.getByText(/Step sent to the device 20 min ago/)).toBeInTheDocument();
  });

  it('dims that line and says so when the controller itself has gone quiet', () => {
    state.plan = plan({}, { lastAppliedAt: NOW.minus({ minutes: 20 }).toISO()! });
    draw(device(NOW.minus({ hours: 2 })));

    // In the one wording the app has for a device gone quiet, rather than "the controller has said nothing for 2 h" about a fridge module.
    const line = screen.getByText(/offline since 10:00 · what the device is really running may be older than this/);
    expect(line).toHaveAttribute('data-age', 'offline');
  });
});
