import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, Plan, PlanReplace, PlanStep, PlanTransition } from '@fg2/shared-types/v1';
import { ApiError } from '@/api/problem';
import { planLineOf } from '@/screens/cockpit/plan-line';
import { PlanEditor } from '@/screens/control/PlanEditor';
import { PlanPanel } from '@/screens/control/PlanPanel';
import { emptyDraft, newStep, type PlanDraft } from '@/screens/control/plan-edit';
import { stepMeta } from '@/screens/control/plan-labels';
import { READY_PLANS, readyDraft } from '@/screens/control/ready-plans';
import { items as continueItems } from '@/screens/devices/advanced/ContinuePlan.advanced';
import { climateLanding } from '@/ui/climate-hardware';

/**
 * What came back of the old app's plans: light hours in a step, which is what
 * a photoperiod plan turns to flower with; the two ready-made plans a fridge
 * starts from; going on with a plan at a step of one's choosing; and the line
 * on the cockpit that says where a running plan stands.
 */

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

const state = vi.hoisted(() => ({
  plan: null as Plan | null,
  planError: null as unknown,
  saved: [] as PlanReplace[],
  sent: [] as PlanTransition[],
  templates: { items: [] as unknown[], nextCursor: null },
}));

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevices: () => ({ data: { items: [], nextCursor: null }, isPending: false, refetch: () => {} }),
  useHeardAt: () => null,
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
  usePlanTransition: () => ({ mutate: (body: PlanTransition) => state.sent.push(body), error: null, isPending: false, isSuccess: false }),
  useStopPlan: () => ({ mutate: () => {}, error: null, isPending: false }),
  useRemovePlan: () => ({ mutate: () => {}, error: null, isPending: false }),
  useSavePlan: () => ({ mutate: (body: PlanReplace) => state.saved.push(body), error: null, isPending: false }),
  usePlanTemplates: () => ({ data: state.templates, isPending: false, error: null }),
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const step = (over: Partial<PlanStep> = {}): PlanStep => ({
  id: 'step-1',
  name: 'Veg',
  stage: 'vegetative',
  preset: null,
  duration: { value: 2, unit: 'weeks' },
  settings: { day: { temperature: 26 } },
  lightHours: 18,
  waitForConfirmation: false,
  confirmationMessage: null,
  ...over,
});

const plan = (over: Partial<Plan> = {}, stateOver: Partial<Plan['state']> = {}): Plan => ({
  id: 'plan-1',
  createdAt: NOW.minus({ days: 30 }).toISO()!,
  deviceId: 'device-1',
  templateId: null,
  name: 'Photoperiod',
  steps: [step(), step({ id: 'step-2', name: 'Flower', stage: 'flowering', lightHours: 12, duration: { value: 6, unit: 'weeks' } })],
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

const device = (type = 'fridge', hardware: Record<string, string> = {}): Device =>
  ({
    id: 'device-1',
    createdAt: NOW.minus({ days: 60 }).toISO()!,
    type,
    classId: null,
    serialNumber: 42,
    ownerId: 'user-1',
    spaceId: 'space-1',
    name: 'Fridge',
    firmware: { channel: 'stable', targetId: null },
    configuration: { day: { temperature: 25, humidity: 60 }, daynight: { day: 6 * 3600, night: 0 }, lights: { limit: 80 } },
    settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
    control: { running: true, drying: false, mode: 'standard', energySaving: false },
    isDemo: false,
    state: {
      lastSeenAt: DateTime.now().toISO()!,
      claimedAt: null,
      firmwareId: null,
      updateStartedAt: null,
      updateEndedAt: null,
      updateFailedAt: null,
      maintenanceUntil: null,
      hardware,
      socketStateChangedAt: {},
      socketsReportedAt: null,
    },
  }) as Device;

const wrap = (children: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );

const t = (key: string, options?: Record<string, unknown>) => i18next.t(key, options);

const noPlan = new ApiError({ status: 404, code: 'plan_not_found', title: 'Not found', detail: 'none', errors: [] });

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  state.plan = plan();
  state.planError = null;
  state.saved = [];
  state.sent = [];
  state.templates = { items: [], nextCursor: null };
});

describe('light hours in a step', () => {
  const draft = (over: Partial<PlanDraft['steps'][number]> = {}): PlanDraft => ({
    ...emptyDraft('A plan', { mode: 'off', email: null, writeEntries: true }),
    steps: [{ ...newStep('Flower'), ...over }],
  });

  it('says them in the step´s line, and a step of light hours alone is no step that writes nothing', () => {
    expect(stepMeta(t, { ...step({ lightHours: 12 }), settings: {} })).toBe('Veg · 2 wk · 12 h light');
    expect(stepMeta(t, { ...step({ lightHours: null }), settings: {} })).toContain('writes nothing');
  });

  it('are typed into the step and saved with it, and an empty field leaves the photoperiod alone', () => {
    wrap(<PlanEditor device={device()} plan={null} draft={draft()} onClose={() => {}} />);

    const field = screen.getByRole('spinbutton', { name: 'Light on for' });
    expect(field).toHaveValue(null);
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the plan' }));

    expect(state.saved[0].steps[0]).toMatchObject({ name: 'Flower', lightHours: 12 });

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the plan' }));
    expect(state.saved[1].steps[0].lightHours).toBeNull();
  });

  it('may be none at all, which is the night round the clock', () => {
    wrap(<PlanEditor device={device()} plan={null} draft={draft({ lightHours: 0 })} onClose={() => {}} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save the plan' })).toBeEnabled();
  });

  it('are not saved outside a day, and the step says why', () => {
    wrap(<PlanEditor device={device()} plan={null} draft={draft({ lightHours: 30 })} onClose={() => {}} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Light on for: 0 to 24 hours, or leave it empty.');
    expect(screen.getByRole('button', { name: 'Save the plan' })).toBeDisabled();
  });

  describe('said as the window they make', () => {
    // The window is said on the account's clock; with no account read, the browser's, held at UTC here.
    beforeAll(() => {
      Settings.defaultZone = 'utc';
    });
    afterAll(() => {
      Settings.defaultZone = 'system';
    });

    it('from the hour the device´s light comes on', () => {
      wrap(<PlanEditor device={device()} plan={null} draft={draft()} onClose={() => {}} />);

      fireEvent.change(screen.getByRole('spinbutton', { name: 'Light on for' }), { target: { value: '12' } });
      expect(screen.getByText('Light on 06:00–18:00 · 12 h – from the time under Targets.')).toBeInTheDocument();
    });

    /**
     * A recipe migrated from the old app carries two fixed times of day and no
     * light hours. The editor said "Light on for —", as though the step left
     * the light alone, and named the section by its firmware key - while the
     * engine set the light to those times every hour.
     */
    it('from a step´s own time where it brings one, which can be moved or handed back to the targets page', () => {
      const migrated = draft({ lightHours: null, settings: { daynight: { day: 7 * 3600, night: 19 * 3600 } } });
      wrap(<PlanEditor device={device()} plan={null} draft={migrated} onClose={() => {}} />);

      expect(screen.getByRole('spinbutton', { name: 'Light on for' })).toHaveValue(12);
      expect(screen.getByLabelText('Light on at')).toHaveValue('07:00');
      expect(screen.getByText(/^Light on 07:00–19:00 · 12 h – this step brings the time with it/)).toBeInTheDocument();
      expect(screen.queryByText(/daynight/)).not.toBeInTheDocument();
      expect(stepMeta(t, { ...step({ lightHours: null }), settings: migrated.steps[0].settings }, 0)).toBe('Veg · 2 wk · 12 h light from 07:00');

      fireEvent.change(screen.getByLabelText('Light on at'), { target: { value: '08:00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save the plan' }));
      expect(state.saved[0].steps[0]).toMatchObject({ lightHours: null, settings: { daynight: { day: 8 * 3600, night: 20 * 3600 } } });

      fireEvent.click(screen.getByRole('button', { name: 'Use the time under Targets' }));
      expect(screen.queryByLabelText('Light on at')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Save the plan' }));
      expect(state.saved[1].steps[0].lightHours).toBe(12);
      expect(state.saved[1].steps[0].settings).not.toHaveProperty('daynight');
    });
  });

  /**
   * A step into drying switches the device into its drying mode, which knows
   * no day: the editor offered the day's figures, CO₂, the light limit and
   * eighteen hours of light under it all the same.
   */
  it('are not offered for a drying step, which holds the drying room´s two figures and nothing else', () => {
    const veg = draft({
      lightHours: 18,
      settings: { day: { temperature: 26, humidity: 62 }, night: { temperature: 22, humidity: 58 }, co2: { target: 900 }, lights: { limit: 80 } },
    });
    wrap(<PlanEditor device={device()} plan={null} draft={veg} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Drying' }));
    expect(screen.queryByRole('spinbutton', { name: 'Light on for' })).not.toBeInTheDocument();
    expect(screen.queryByText('Day · temperature')).not.toBeInTheDocument();
    expect(screen.queryByText('Light limit')).not.toBeInTheDocument();
    expect(screen.getByText('Drying · temperature')).toBeInTheDocument();
    expect(screen.getByText(/^A step into drying switches the device into its drying mode/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save the plan' }));
    expect(state.saved[0].steps[0]).toMatchObject({ stage: 'drying', lightHours: null, settings: { night: { temperature: 22, humidity: 58 } } });
    expect(state.saved[0].steps[0].settings).not.toHaveProperty('day');
    expect(state.saved[0].steps[0].settings).not.toHaveProperty('co2');
  });

  /** Germination is dark and holds one temperature, the one seeds sprout at unless the step names another. */
  it('are one temperature for a germination step, in the dark, the one seeds sprout at', () => {
    const veg = draft({ lightHours: 18, settings: { day: { temperature: 26, humidity: 62 }, co2: { target: 900 }, lights: { limit: 80 } } });
    wrap(<PlanEditor device={device()} plan={null} draft={veg} onClose={() => {}} />);

    const stages = screen.getAllByRole('button', { name: / · (dark|with light)$/ }).map(chip => chip.textContent);
    expect(stages).toEqual(['Germination · dark', 'Seedling · with light']);
    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    expect(screen.queryByRole('spinbutton', { name: 'Light on for' })).not.toBeInTheDocument();
    expect(screen.queryByText('Day · temperature')).not.toBeInTheDocument();
    expect(screen.queryByText('Night · humidity')).not.toBeInTheDocument();
    expect(screen.getByText('Germination · temperature')).toBeInTheDocument();
    expect(screen.getByText(/^A step into germination switches the device dark: no light, no CO₂, the humidity left alone/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save the plan' }));
    expect(state.saved[0].steps[0]).toMatchObject({ stage: 'germination', lightHours: null, settings: { night: { temperature: 24 } } });
    expect(Object.keys(state.saved[0].steps[0].settings)).toEqual(['night']);
  });

  it('offer a germination step the temperature the device holds only while it germinates', () => {
    const lit = device();
    lit.configuration = { ...lit.configuration, night: { temperature: 21, humidity: 55 } };
    const { unmount } = wrap(<PlanEditor device={lit} plan={null} draft={draft()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    // A night with the light on is no temperature to sprout seeds at, so 24 °C stays.
    expect(screen.queryByRole('button', { name: 'Take what the device holds now' })).not.toBeInTheDocument();
    unmount();

    const dark = { ...lit, configuration: { ...lit.configuration, workmode: 'breed', night: { temperature: 23, humidity: 55 } } };
    dark.control = { running: true, drying: false, mode: 'germination', energySaving: false };
    wrap(<PlanEditor device={dark} plan={null} draft={draft()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take what the device holds now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the plan' }));
    expect(state.saved.at(-1)?.steps[0]).toMatchObject({ stage: 'germination', settings: { night: { temperature: 23 } } });
  });

  it('take the hours the controller holds now along with its figures', () => {
    wrap(<PlanEditor device={device()} plan={null} draft={draft()} onClose={() => {}} />);

    // The device's light comes on at 06:00 UTC and goes off at midnight: eighteen hours.
    fireEvent.click(screen.getByRole('button', { name: 'Take what the device holds now' }));
    expect(screen.getByRole('spinbutton', { name: 'Light on for' })).toHaveValue(18);
  });
});

describe('the two ready-made plans', () => {
  it('run a photoperiod grow from seedling to drying, with 12/12 for flower and a question at each big step', () => {
    const photoperiod = readyDraft(t, READY_PLANS[0], { mode: 'off', email: null, writeEntries: true });

    expect(photoperiod.name).toBe('Photoperiod');
    expect(photoperiod.steps.map(one => [one.name, one.stage, one.preset, one.duration.value, one.lightHours, one.waitForConfirmation])).toEqual([
      ['Seedling', 'seedling', null, 14, 18, false],
      ['Vegetative', 'vegetative', null, 28, 18, true],
      ['Early flowering', 'flowering', null, 42, 12, false],
      ['Late flowering', 'flowering', 'late_flowering', 21, 12, true],
      ['Drying', 'drying', null, 10, null, true],
    ]);
    expect(photoperiod.steps[1].confirmationMessage).toMatch(/^Ready for flowering\? From now on the light runs 12\/12/);
    // The figures are the shared table's, and every step is new to the plan.
    expect(photoperiod.steps[2].settings).toMatchObject({
      day: { temperature: 25, humidity: 50 },
      night: { temperature: 20 },
      lights: { limit: 100 },
    });
    expect(photoperiod.steps.every(one => one.id === undefined)).toBe(true);
  });

  it('keep an autoflower at 18 hours of light throughout', () => {
    const autoflower = readyDraft(t, READY_PLANS[1], { mode: 'off', email: null, writeEntries: true });

    expect(autoflower.steps.map(one => one.lightHours)).toEqual([18, 18, 18, 18, null]);
    expect(autoflower.steps.reduce((days, one) => days + one.duration.value, 0)).toBe(80);
  });

  it('are where a fridge without a plan starts, and open in the editor rather than being saved', () => {
    state.plan = null;
    state.planError = noPlan;
    const fridge = device();
    wrap(<PlanPanel device={fridge} mayManage landing={climateLanding(fridge)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose a ready-made plan' }));
    const sheet = screen.getByRole('dialog', { name: 'Start from a template' });
    expect(within(sheet).getByText('Ready-made plans')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /^Autoflower/ }));

    const editor = screen.getByRole('dialog', { name: 'Write a plan' });
    expect(within(editor).getByDisplayValue('Autoflower')).toBeInTheDocument();
    expect(state.saved).toHaveLength(0);
  });

  it('say before a plan is started which stage it puts the grow into', () => {
    state.plan = plan({}, { status: 'stopped', stepStartedAt: null, lastAppliedAt: null });
    const fridge = device();
    const view = wrap(<PlanPanel device={fridge} mayManage landing={climateLanding(fridge)} />);

    expect(screen.getByRole('button', { name: 'Start the plan' })).toBeInTheDocument();
    expect(screen.getByText(/^Starting puts a grow standing here into Veg,/)).toBeInTheDocument();

    // A paused plan goes on where it stood, so resuming it says nothing of the kind.
    view.unmount();
    state.plan = plan({}, { status: 'paused' });
    wrap(<PlanPanel device={fridge} mayManage landing={climateLanding(fridge)} />);
    expect(screen.queryByText(/^Starting puts a grow/)).not.toBeInTheDocument();
  });

  it('are not offered for a tent controller', () => {
    state.plan = null;
    state.planError = noPlan;
    const tent = device('controller');
    wrap(<PlanPanel device={tent} mayManage landing={climateLanding(tent)} />);

    expect(screen.queryByRole('button', { name: 'Choose a ready-made plan' })).not.toBeInTheDocument();
  });
});

describe('going on with a plan at a step', () => {
  const ContinuePlan = continueItems[0].Item;

  it('is offered to whoever may change a fridge or a controller', () => {
    expect(continueItems[0].shows({ device: device(), mayManage: true, offline: false })).toBe(true);
    expect(continueItems[0].shows({ device: device(), mayManage: false, offline: false })).toBe(false);
    expect(continueItems[0].shows({ device: device('light'), mayManage: true, offline: false })).toBe(false);
  });

  it('asks before it sends, says the step starts over, and sends the step by its id', () => {
    wrap(<ContinuePlan device={device()} mayManage offline={false} />);

    const which = screen.getByRole('combobox', { name: 'Step' });
    // The step after the one the plan stands on is the one offered first.
    expect(which).toHaveValue('step-2');
    fireEvent.change(which, { target: { value: 'step-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue here' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('“Photoperiod” carries on at 1 · Veg. The step starts from the beginning');
    expect(state.sent).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Continue at step 1' }));

    expect(state.sent).toEqual([{ kind: 'goto', stepId: 'step-1' }]);
  });

  it('draws nothing for a device that runs no plan', () => {
    state.plan = null;
    state.planError = noPlan;
    const { container } = wrap(<ContinuePlan device={device()} mayManage offline={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the cockpit´s line for a running plan', () => {
  it('says the step, how long it has left and what follows', () => {
    expect(planLineOf(t, plan(), NOW)).toBe('Veg, 10 days to go, then Flower');
    expect(planLineOf(t, plan({}, { activeStepIndex: 1, stepStartedAt: NOW.minus({ days: 42 }).plus({ hours: 5 }).toISO()! }), NOW)).toBe(
      'Flower, 5 hours to go, then the plan is done',
    );
  });

  it('says a step that waits is waiting, and one with no length runs until it is moved on', () => {
    const waits = plan({
      steps: [step({ waitForConfirmation: true, duration: { value: 1, unit: 'days' } }), step({ id: 'step-2', name: 'Flower' })],
    });
    expect(planLineOf(t, waits, NOW)).toBe('Veg is waiting for you to confirm');

    const open = plan({ steps: [step({ duration: { value: 0, unit: 'days' } })] });
    expect(planLineOf(t, open, NOW)).toBe('Veg, until you move it on');
  });

  it('says a paused plan stands still, and nothing about one put away', () => {
    expect(planLineOf(t, plan({}, { status: 'paused' }), NOW)).toMatch(/, paused – resume under Control$/);
    expect(planLineOf(t, plan({}, { status: 'stopped' }), NOW)).toBeNull();
  });
});
