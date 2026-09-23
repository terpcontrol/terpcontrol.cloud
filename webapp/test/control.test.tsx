import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Device, Plan, PlanStep, PlanTransition } from '@fg2/shared-types/v1';
import { ApiError } from '@/api/problem';
import { Control } from '@/screens/control/Control';
import { PlanPanel } from '@/screens/control/PlanPanel';
import { movesOf } from '@/screens/control/plan-clock';
import { CLIMATE_FIGURES, draftOf, editEffect, figureOf, moveStep, otherSections, withFigure } from '@/screens/control/plan-edit';

/**
 * What the Control tab promises before anything is sent, and what it offers at
 * all.
 *
 * A plan is the one thing in the app that moves without being asked, so the two
 * ways this screen could lie are both checked here: offering a move the server
 * would refuse, and saying an edit leaves the tent where it is when it would
 * start the step over. The third is the settings a step carries - a figure
 * typed into one section must not quietly drop the tuning that sits beside it,
 * because the merge on the way to the device is by whole section.
 */

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

const state = vi.hoisted(() => ({
  plan: null as Plan | null,
  moveError: null as unknown,
  sent: [] as PlanTransition[],
  devices: [] as unknown[],
}));

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevices: () => ({ data: { items: state.devices, nextCursor: null }, isPending: false, refetch: () => {} }),
}));

vi.mock('@/api/plans', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevicePlan: () => ({ data: state.plan, isPending: false, isError: false, error: null, dataUpdatedAt: NOW.toMillis(), refetch: () => {} }),
  usePlanTransition: () => ({
    mutate: (body: PlanTransition) => state.sent.push(body),
    error: state.moveError,
    isPending: false,
  }),
  useStopPlan: () => ({ mutate: () => {}, error: null, isPending: false }),
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/** What the reader may do in the tent, which is what the whole tab is gated on. */
const may = vi.hoisted(() => ({ youMay: 'own' as AccessNeed }));

vi.mock('@/api/spaces', async importOriginal => {
  const { spaceWhere, spacesAnswering } = await import('./session');

  return { ...(await importOriginal<object>()), useSpaces: () => spacesAnswering(spaceWhere(may.youMay)) };
});

const step = (over: Partial<PlanStep> = {}): PlanStep => ({
  id: 'step-1',
  name: 'Veg',
  stage: 'vegetative',
  preset: null,
  duration: { value: 2, unit: 'weeks' },
  settings: { day: { temperature: 26, humidity: 62 } },
  waitForConfirmation: false,
  confirmationMessage: null,
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

/**
 * The screen reads the browser's clock for every age on it, so a device under
 * test is placed against that clock rather than against the fixed instant the
 * arithmetic is checked at.
 */
const device = (lastSeenAt = DateTime.now().minus({ seconds: 20 })): Device => ({
  id: 'device-1',
  createdAt: NOW.minus({ days: 60 }).toISO()!,
  type: 'controller',
  classId: null,
  serialNumber: 42,
  ownerId: 'user-1',
  spaceId: 'space-1',
  name: 'Blue Dream tent',
  firmware: { channel: 'stable', targetId: null },
  configuration: CONFIGURATION,
  settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  isDemo: false,
  state: {
    lastSeenAt: lastSeenAt.toISO()!,
    claimedAt: NOW.minus({ days: 60 }).toISO()!,
    firmwareId: 'build-1',
    updateStartedAt: null,
    updateEndedAt: null,
    maintenanceUntil: null,
    hardware: {},
    socketStateChangedAt: {},
    socketsReportedAt: null,
  },
});

const draw = (one: Device = device()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PlanPanel device={one} mayManage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  may.youMay = 'own';
  state.plan = plan();
  state.moveError = null;
  state.sent = [];
  state.devices = [];
});

describe('the tab of a place with nothing standing in it', () => {
  it('offers the one thing that would change that, and no page that would be as empty', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Control spaceId="space-1" sub={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText(/Nothing stands here for a plan to run on/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '/spaces/space-1/devices');
    expect(screen.queryByRole('link', { name: 'Manual targets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Advanced/ })).not.toBeInTheDocument();
  });
});

/**
 * The tab, by who is reading it. Everything on it writes to a controller
 * standing here, which the decision record puts at `manage`: the moves, the
 * manual targets, the alarm rules. A member who was let in to write in the
 * diary sees the plan and none of the buttons, and is told whose they are
 * rather than left in front of a half-drawn tab.
 */
describe('what the Control tab offers, by who is reading', () => {
  const drawTab = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Control spaceId="space-1" sub={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  beforeEach(() => {
    state.devices = [device()];
  });

  it('gives the owner the moves and both pages below them', async () => {
    drawTab();

    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manual targets' })).toBeInTheDocument();
    expect(screen.queryByText(/You may log in this space, not steer it/)).not.toBeInTheDocument();
  });

  it('gives a member the plan to read, no move at all, and the reason', async () => {
    may.youMay = 'log';
    drawTab();

    expect(await screen.findByText(/You may log in this space, not steer it/)).toBeInTheDocument();
    for (const move of ['Pause', 'Extend', 'Skip', 'Stop', 'Confirm the step'])
      expect(screen.queryByRole('button', { name: move })).not.toBeInTheDocument();
    // The two pages below still open: what the tent is set to is worth reading.
    expect(screen.getByRole('link', { name: 'Manual targets' })).toBeInTheDocument();
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
      { stepStartedAt: DateTime.now().minus({ minutes: 25 }).toISO()! },
    );

    draw();

    // The header states the step's length and the ladder below it repeats it.
    expect(screen.getAllByText('No stage · 7 d')).not.toHaveLength(0);
    expect(screen.getByText('25 min on this step · 7 d left')).toBeInTheDocument();
  });

  it('still counts what has been served the way every other age is counted', () => {
    state.plan = plan(
      { steps: [step({ stage: null, duration: { value: 7, unit: 'days' } })] },
      { stepStartedAt: DateTime.now().minus({ days: 3, hours: 23 }).toISO()! },
    );

    draw();

    expect(screen.getByText('3 d on this step · 4 d left')).toBeInTheDocument();
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

  it('offers nothing to start on a plan that has no steps to run', () => {
    expect(movesOf(plan({ steps: [] }, { status: 'stopped', stepStartedAt: null }), NOW).resume).toBe(false);
  });
});

describe('the settings a step carries', () => {
  const day = CLIMATE_FIGURES[0];
  const dayHumidity = CLIMATE_FIGURES[1];

  it('keeps the rest of the section the controller is running when a figure is written', () => {
    const written = withFigure({}, day, 28, CONFIGURATION);

    expect(written.day).toEqual({ temperature: 28, humidity: 60, heating: 'hard' });
    expect(otherSections(written)).toEqual([]);
  });

  it('drops the whole section when its last figure is cleared, so the step writes nothing there', () => {
    const one = withFigure({}, day, 28, CONFIGURATION);
    const both = withFigure(one, dayHumidity, 55, CONFIGURATION);

    expect(figureOf(withFigure(both, day, null, CONFIGURATION), dayHumidity)).toBe(55);
    expect(withFigure(withFigure(both, day, null, CONFIGURATION), dayHumidity, null, CONFIGURATION).day).toBeUndefined();
  });

  it('reads a figure a migrated recipe wrote flat as the same figure', () => {
    expect(figureOf({ 'day.temperature': 24 }, day)).toBe(24);
  });

  it('names the sections it does not edit rather than hiding them', () => {
    expect(otherSections({ day: { temperature: 24 }, workmode: 'small' })).toEqual(['workmode']);
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

  it('turns a refusal into the thing to do about it', () => {
    state.moveError = new ApiError({
      status: 409,
      code: 'plan_already_running',
      title: 'Conflict',
      detail: 'This plan is already running.',
      errors: [],
    });
    draw();

    expect(screen.getByText('This plan is already running.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read it again' })).toBeInTheDocument();
  });

  it('dates the last time the step reached the controller rather than claiming it is running it', () => {
    state.plan = plan({}, { lastAppliedAt: DateTime.now().minus({ minutes: 20 }).toISO()! });
    draw();

    expect(screen.getByText(/Step sent to the controller 20 min ago/)).toBeInTheDocument();
  });

  it('dims that line and says so when the controller itself has gone quiet', () => {
    state.plan = plan({}, { lastAppliedAt: DateTime.now().minus({ minutes: 20 }).toISO()! });
    draw(device(DateTime.now().minus({ hours: 2 })));

    const line = screen.getByText(/the controller has said nothing for 2 h/);
    expect(line).toHaveAttribute('data-age', 'offline');
  });
});
