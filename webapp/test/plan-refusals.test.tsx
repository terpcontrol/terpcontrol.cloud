import { fireEvent, screen, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GERMINATION_CHOICES } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import type { Device, Plan, PlanReplace, PlanTransition } from '@fg2/shared-types/v1';
import { ApiError } from '@/api/problem';
import type { Told } from '@/log/log-context';
import { ContinuePlan } from '@/screens/control/ContinuePlan';
import { PlanEditor } from '@/screens/control/PlanEditor';
import { PlanPanel } from '@/screens/control/PlanPanel';
import { emptyDraft, newStep, type PlanDraft } from '@/screens/control/plan-edit';
import { climateLanding } from '@/ui/climate-hardware';
import { deviceWith } from './fixtures';
import { drawAt } from './harness';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * What the plan refuses rather than bends, and what it says before it does
 * something a grower did not ask for: a figure outside its range is refused in
 * words that name the range and is never pulled into it, a length below what
 * the route takes is refused under its field, and going on with a plan while
 * the device's regulation is off - which the step it sends switches back on -
 * asks first and says so after.
 */

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

const state = vi.hoisted(() => ({
  plan: null as Plan | null,
  saved: [] as PlanReplace[],
  saveError: null as unknown,
  sent: [] as PlanTransition[],
}));

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevices: () => ({ data: { items: [], nextCursor: null }, isPending: false, refetch: () => {} }),
  useHeardAt: () => null,
}));

vi.mock('@/api/plans', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevicePlan: () => ({ data: state.plan, isPending: false, isError: false, error: null, dataUpdatedAt: NOW.toMillis(), refetch: () => {} }),
  usePlanTransition: () => ({
    mutate: (body: PlanTransition, options?: { onSuccess?: () => void }) => {
      state.sent.push(body);
      options?.onSuccess?.();
    },
    error: null,
    isPending: false,
  }),
  useStopPlan: () => ({ mutate: () => {}, error: null, isPending: false }),
  useRemovePlan: () => ({ mutate: () => {}, error: null, isPending: false }),
  useSavePlan: () => ({ mutate: (body: PlanReplace) => state.saved.push(body), error: state.saveError, isPending: false }),
  usePlanTemplates: () => ({ data: { items: [], nextCursor: null }, isPending: false, error: null }),
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const device = (running = true): Device =>
  deviceWith({
    createdAt: NOW.minus({ days: 60 }).toISO()!,
    type: 'fridge',
    name: 'Fridge',
    configuration: { day: { temperature: 25, humidity: 60 }, daynight: { day: 6 * 3600, night: 0 }, lights: { limit: 80 } },
    control: { running, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
    state: { lastSeenAt: DateTime.now().toISO()!, claimedAt: null, hardware: {} },
  });

const plan = (status: Plan['state']['status'], pauseReason: string | null = null): Plan => ({
  id: 'plan-1',
  createdAt: NOW.minus({ days: 30 }).toISO()!,
  deviceId: 'device-1',
  templateId: null,
  name: 'Photoperiod',
  steps: [
    {
      id: 'step-1',
      name: 'Veg',
      stage: 'vegetative',
      preset: null,
      duration: { value: 2, unit: 'weeks' },
      settings: { day: { temperature: 26 } },
      lightHours: 18,
      waitForConfirmation: false,
      confirmationMessage: null,
      germinationChoices: null,
    },
  ],
  loop: false,
  notify: { mode: 'off', email: null, writeEntries: true },
  state: {
    status,
    activeStepIndex: 0,
    stepStartedAt: status === 'stopped' ? null : NOW.minus({ days: 4 }).toISO()!,
    pausedElapsedMs: 0,
    pauseReason,
    lastAppliedAt: null,
    confirmationNotifiedAt: null,
    confirmationAskedAt: null,
    confirmationAskTriedAt: null,
  },
});

const draft = (over: Partial<PlanDraft['steps'][number]> = {}): PlanDraft => ({
  ...emptyDraft('A plan', { mode: 'off', email: null, writeEntries: true }),
  steps: [{ ...newStep('Flower'), ...over }],
});

let told: Told[] = [];
const drawn = (node: ReactNode) => drawAt(<Toast told={told}>{node}</Toast>);

beforeAll(() => translate());

beforeEach(() => {
  told = [];
  state.plan = null;
  state.saved = [];
  state.saveError = null;
  state.sent = [];
});

describe('a step’s figure', () => {
  it('outside its range is refused in words that name the range, and never pulled into it', () => {
    drawAt(<PlanEditor device={device()} plan={null} draft={draft()} onClose={() => {}} />);
    const save = screen.getByRole('button', { name: 'Save the plan' });
    const field = screen.getByRole('spinbutton', { name: /^Day · temperature/ });

    fireEvent.change(field, { target: { value: '99' } });

    const said = 'Day · temperature: between 15 and 35 °C, or leave it empty.';
    expect(screen.getByRole('alert')).toHaveTextContent(said);
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(said);
    expect(field).toHaveValue(99);
    expect(save).toBeDisabled();
    // Said again under the button, where the step that says it may be folded away.
    expect(save).toHaveAccessibleDescription(`Flower – ${said}`);
    fireEvent.click(save);
    expect(state.saved).toHaveLength(0);

    fireEvent.change(field, { target: { value: '3' } });
    expect(screen.getByRole('alert')).toHaveTextContent(said);

    fireEvent.change(field, { target: { value: '26' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(save);
    expect(state.saved[0].steps[0].settings).toMatchObject({ day: { temperature: 26 } });
  });

  /** As the server does: a recipe migrated from the old app keeps what it was written with until somebody changes it. */
  it('the step already carried is not held to the range again, until it is changed', () => {
    const stored = plan('stopped');
    stored.steps[0].settings = { day: { temperature: 38 } };
    drawAt(
      <PlanEditor
        device={device()}
        plan={stored}
        draft={{ ...draft(), steps: [{ ...newStep('Veg'), id: 'step-1', settings: { day: { temperature: 38 } } }] }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('spinbutton', { name: /^Day · temperature/ })).toHaveValue(38);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save the plan' })).toBeEnabled();

    fireEvent.change(screen.getByRole('spinbutton', { name: /^Day · temperature/ }), { target: { value: '39' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Day · temperature: between 15 and 35 °C, or leave it empty.');
  });

  it('refused by the server all the same is said in the same words', () => {
    state.saveError = new ApiError({
      status: 400,
      code: 'validation_failed',
      title: 'Invalid',
      detail: 'The request does not match the contract.',
      errors: [{ field: 'steps.0.settings.co2.target', code: 'too_big', detail: 'This target is set from 400 to 1500.' }],
    });
    drawAt(<PlanEditor device={device()} plan={null} draft={draft({ settings: { co2: { target: 1200 } } })} onClose={() => {}} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Flower – CO₂ target: between 400 and 1500 ppm, or leave it empty.');
  });
});

describe('a step’s climate chips', () => {
  it('begin with “Leave as they are”, as beside a phase and a split, which keeps no preset', () => {
    drawAt(<PlanEditor device={device()} plan={null} draft={draft({ stage: 'flowering', preset: 'late_flowering' })} onClose={() => {}} />);
    const chips = within(screen.getByRole('group', { name: 'Climate preset' }));

    expect(chips.getAllByRole('button').map(chip => chip.textContent)[0]).not.toBe('Flower');
    fireEvent.click(chips.getByRole('button', { name: 'Leave as they are' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the plan' }));
    expect(state.saved[0].steps[0]).toMatchObject({ stage: 'flowering', preset: null });
  });
});

describe('a step’s length', () => {
  it('below nought, or none, is refused under the field and kept as typed', () => {
    drawAt(<PlanEditor device={device()} plan={null} draft={draft()} onClose={() => {}} />);
    const save = screen.getByRole('button', { name: 'Save the plan' });
    const length = screen.getByRole('spinbutton', { name: 'How long, as a number' });

    fireEvent.change(length, { target: { value: '-2' } });
    expect(length).toHaveValue(-2);
    expect(length).toBeInvalid();
    expect(screen.getByRole('alert')).toHaveTextContent('How long: 0 or more.');
    expect(save).toBeDisabled();

    fireEvent.change(length, { target: { value: '' } });
    expect(save).toBeDisabled();

    fireEvent.change(length, { target: { value: '0' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(save);
    expect(state.saved[0].steps[0].duration).toEqual({ value: 0, unit: 'weeks' });
  });

  it('of an extension is at least one, and the yes waits for it', () => {
    state.plan = plan('running');
    const fridge = device();
    drawn(<PlanPanel device={fridge} mayManage landing={climateLanding(fridge)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Extend' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'How long, as a number' }), { target: { value: '0' } });

    expect(screen.getByRole('alert')).toHaveTextContent('How long: 1 or more.');
    expect(screen.getByRole('button', { name: /^Add/ })).toBeDisabled();
    expect(state.sent).toHaveLength(0);
  });
});

describe('going on while regulation is off', () => {
  const PAUSED_FOR_OFF = 'Control was switched off.';

  it('asks before the step switches it back on, and says so after', () => {
    state.plan = plan('paused', PAUSED_FOR_OFF);
    const fridge = device(false);
    drawn(<PlanPanel device={fridge} mayManage landing={climateLanding(fridge)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(state.sent).toHaveLength(0);
    expect(screen.getByText('Control is off: continuing sends the step to the device and so switches it back on.')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Continue and switch control on' }));
    expect(state.sent).toEqual([{ kind: 'resume' }]);
    expect(told.at(-1)?.label).toBe('“Photoperiod” is running again · Veg · control on');
  });

  it('asks the same of a start', () => {
    state.plan = plan('stopped');
    const fridge = device(false);
    drawn(<PlanPanel device={fridge} mayManage landing={climateLanding(fridge)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start the plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start and switch control on' }));
    expect(state.sent).toEqual([{ kind: 'resume' }]);
    expect(told.at(-1)?.label).toBe('“Photoperiod” started · Veg · control on');
  });

  it('asks nothing where regulation is on', () => {
    state.plan = plan('paused', 'Targets set by hand');
    const fridge = device();
    drawn(<PlanPanel device={fridge} mayManage landing={climateLanding(fridge)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(state.sent).toEqual([{ kind: 'resume' }]);
    expect(told.at(-1)?.label).toBe('“Photoperiod” is running again · Veg');
  });

  it('is said in the question of going on at a step of one’s choosing', () => {
    state.plan = plan('paused', PAUSED_FOR_OFF);
    drawn(<ContinuePlan device={device(false)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue here' }));
    expect(screen.getByText(/Control is off and comes back on with it\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue at step 1' }));
    expect(told.at(-1)?.label).toBe('The plan is now running at step 1, Veg · control on');
  });
});

describe('the plan’s moves that cannot be taken back', () => {
  it('answer yes in the one danger style', () => {
    state.plan = plan('running');
    const fridge = device();
    drawn(<PlanPanel device={fridge} mayManage landing={climateLanding(fridge)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    const yes = within(screen.getByText(/^The plan keeps its steps/).parentElement!).getAllByRole('button')[0];
    expect(yes.className).toMatch(/dangerFilled/);
  });
});
