import { jest } from '@jest/globals';
import { Model } from 'mongoose';
import type { DeviceConfiguration, PlanReplace, PlanStep, PlanStepInput } from '@fg2/shared-types/v1';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MODEL_V1 } from '@database/models';
import { StoredPlan, plansSchema } from '@database/schemas/v1/plans.schema';
import { MailService } from '@modules/mail/mail.service';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { StageAlarms } from '@modules/v1/phase/stage-alarms.port';
import { DeviceConfigurationWriter } from '@modules/v1/plan/device-configuration.port';
import { PlanAnnouncer } from '@modules/v1/plan/plan-announcer.port';
import { PlanEngineService } from '@modules/v1/plan/plan-engine.service';
import { PlanProgressService } from '@modules/v1/plan/plan-progress.service';
import { PlanService } from '@modules/v1/plan/plan.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The plan engine has no route of its own and runs on a timer, so a pass is
 * taken here directly with the `now` each case needs - a step of days is over in
 * one line rather than in a day.
 *
 * What is asserted is what the engine has always done: it moves on when a step's
 * time is up, it asks once for a confirmation and then stands still, it re-sends
 * the running step hourly and only to a device that is answering, and it writes
 * the step down before it sends anything. On top of that sits what the model
 * adds: the transitions, and the phase a step's stage puts the grow into.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = new Date(Date.UTC(2026, 2, 1, 12, 0, 0));
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const DEVICE = 'device-1';
const SPACE = 'space-1';
const GROW = 'grow-1';
const OWNER = 'user-1';

let db: V1TestDatabase;
let plans: Model<StoredPlan>;
let engine: PlanEngineService;
let transitions: PlanService;
/** The same engine with the routing grid's side of a confirmation wired in, which the plain one leaves out. */
let engineWith: (announcer: PlanAnnouncer) => PlanEngineService;

let applied: { deviceId: string; settings: DeviceConfiguration }[];
let mailed: { to: string; subject: string; text: string }[];
let stages: { deviceId: string; stage: string; preset: string | null }[];

const step = (partial: Partial<PlanStep> & Pick<PlanStep, 'id' | 'name'>): PlanStep => ({
  stage: null,
  preset: null,
  duration: { value: 1, unit: 'days' },
  settings: {},
  waitForConfirmation: false,
  confirmationMessage: null,
  ...partial,
});

const aPlan = async (steps: PlanStep[], rest: Partial<StoredPlan> = {}): Promise<StoredPlan> => {
  const created = await plans.create({
    id: 'plan-1',
    deviceId: DEVICE,
    templateId: null,
    name: 'The plan',
    steps,
    loop: false,
    notify: { mode: 'on_step', email: null, writeEntries: true },
    state: { status: 'running', activeStepIndex: 0, stepStartedAt: NOW, pausedElapsedMs: 0 },
    ...rest,
  });

  return created.toObject();
};

/** A device in a space, last heard from a moment ago, running the targets a phase would snapshot. */
const aDevice = (lastSeenAt: Date | null = NOW, spaceId: string | null = SPACE) =>
  db.devices.create({
    id: DEVICE,
    type: 'controller',
    ownerId: OWNER,
    spaceId,
    configuration: { day: { temperature: 26, humidity: 60 }, night: { temperature: 21, humidity: 55 }, co2: { target: 900 } },
    state: { lastSeenAt },
  });

const aGrowIn = (spaceId: string | null) =>
  db.grows.create({
    id: GROW,
    ownerId: OWNER,
    name: 'A grow',
    type: 'photoperiod',
    slug: GROW,
    startedAt: at(-30 * 24 * HOUR),
    placements: [{ id: 'placement-1', spaceId, startedAt: at(-30 * 24 * HOUR), endedAt: null, plantIds: null }],
  });

/** A plan that holds its steps and is not running: what "stop" leaves behind. */
const stoppedState = {
  status: 'stopped',
  activeStepIndex: 0,
  stepStartedAt: null,
  pausedElapsedMs: 0,
  pauseReason: null,
  lastAppliedAt: null,
  confirmationNotifiedAt: null,
  confirmationAskedAt: null,
  confirmationAskTriedAt: null,
} as const;

const stored = async (): Promise<StoredPlan> => (await plans.findOne({ id: 'plan-1' }).lean<StoredPlan>().exec())!;

const grow = async () => (await db.grows.findOne({ id: GROW }).lean().exec())!;

const entries = () => db.entries.find({}).sort({ createdAt: 1 }).lean().exec();

beforeAll(async () => {
  db = await startV1TestDatabase();
  // The plans are the one collection this spec needs that the harness, which was
  // built for the shared services, does not hold.
  plans = db.connection.model<StoredPlan>(MODEL_V1.plan, plansSchema);
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  applied = [];
  mailed = [];
  stages = [];

  const configuration: DeviceConfigurationWriter = {
    applyConfiguration: async (deviceId, settings) => {
      applied.push({ deviceId, settings });
      return true;
    },
  };
  const alarms: StageAlarms = {
    applyStage: async (deviceId, stage, preset) => {
      stages.push({ deviceId, stage, preset });
    },
  };
  const mail = { send: async (message: (typeof mailed)[number]) => void mailed.push(message) } as unknown as MailService;

  const phases = new PhaseWriterService(db.grows, new EntryWriterService(db.entries), db.entries, db.devices, alarms);
  const progressWith = (announcer: PlanAnnouncer | null) =>
    new PlanProgressService(plans, db.devices, db.users, new EntryWriterService(db.entries), phases, mail, announcer);
  const progress = progressWith(null);

  engine = new PlanEngineService(plans, db.devices, configuration, progress);
  engineWith = announcer => new PlanEngineService(plans, db.devices, configuration, progressWith(announcer));
  transitions = new PlanService(plans, db.devices, progress);

  await db.users.create({ id: OWNER, email: 'grower@example.com', passwordHash: 'x', handle: 'grower' });
});

describe('the pass over the running plans', () => {
  it('moves on to the next step when the step is over, and says so once', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg', duration: { value: 2, unit: 'days' } }), step({ id: 'b', name: 'Flower' })]);

    await engine.run(at(HOUR));
    expect((await stored()).state.activeStepIndex).toBe(0);

    await engine.run(at(2 * 24 * HOUR));

    const state = (await stored()).state;
    expect(state.activeStepIndex).toBe(1);
    expect(state.stepStartedAt).toEqual(at(2 * 24 * HOUR));
    expect(state.pausedElapsedMs).toBe(0);

    const written = await entries();
    expect(written).toHaveLength(1);
    expect(written[0].message).toEqual({ key: 'message-recipe-advanced', params: ['2 (Flower)'] });
    expect(written[0].values).toEqual({ kind: 'plan', planId: 'plan-1', stepIndex: 1, transition: null });
    expect(mailed.map(message => message.to)).toEqual(['grower@example.com']);
  });

  it('completes a plan that has run out of steps, and loops one that says so', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Only' })]);

    await engine.run(at(24 * HOUR));
    expect((await stored()).state).toMatchObject({ status: 'completed', activeStepIndex: 0, stepStartedAt: null });

    await plans.updateOne({ id: 'plan-1' }, { $set: { loop: true, state: { status: 'running', activeStepIndex: 0, stepStartedAt: NOW } } });
    await engine.run(at(24 * HOUR));

    expect((await stored()).state).toMatchObject({ status: 'running', activeStepIndex: 0 });
    expect((await entries()).map(entry => entry.message?.key)).toEqual(['message-recipe-completed', 'message-recipe-looped']);
  });

  it('keeps a step with no length to measure until it is moved on by hand', async () => {
    // The plan screen has always allowed one, and the migration writes a
    // duration it could not read as a zero.
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Open', duration: { value: 0, unit: 'days' } }), step({ id: 'b', name: 'Next' })]);

    await engine.run(at(400 * 24 * HOUR));

    expect((await stored()).state.activeStepIndex).toBe(0);
    expect(await entries()).toHaveLength(0);
  });

  it('writes the step change down before it sends anything', async () => {
    await aDevice(at(24 * HOUR));
    await aPlan([step({ id: 'a', name: 'Veg' }), step({ id: 'b', name: 'Flower', settings: { workmode: 'small' } })]);

    const written: number[] = [];
    const original = plans.updateOne.bind(plans);
    jest.spyOn(plans, 'updateOne').mockImplementation(((...args: Parameters<typeof plans.updateOne>) => {
      written.push(applied.length);
      return original(...args);
    }) as typeof plans.updateOne);

    await engine.run(at(24 * HOUR));

    // Nothing had been sent when the advance was stored.
    expect(written[0]).toBe(0);
    expect(applied).toEqual([{ deviceId: DEVICE, settings: { workmode: 'small' } }]);
    jest.restoreAllMocks();
  });
});

describe('what the step is applied to', () => {
  it('re-sends the running step at most once an hour', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg', settings: { workmode: 'small' } })]);

    await engine.run(NOW);
    await engine.run(at(30 * MINUTE));
    expect(applied).toHaveLength(1);

    await db.devices.updateOne({ id: DEVICE }, { $set: { 'state.lastSeenAt': at(HOUR + MINUTE) } });
    await engine.run(at(HOUR + MINUTE));
    expect(applied).toHaveLength(2);
  });

  it('leaves a device that is not answering alone', async () => {
    await aDevice(at(-10 * MINUTE));
    await aPlan([step({ id: 'a', name: 'Veg' })]);

    await engine.run(NOW);

    expect(applied).toHaveLength(0);
    expect((await stored()).state.lastAppliedAt).toBeNull();
  });

  /**
   * A device that has never sent its own document has nothing for the step to be
   * merged into, so what would be published is the step's sections as the whole
   * configuration - and the firmware reads every key that is missing from one as
   * a compile-time default. The route refuses such a plan now, so this is the
   * one already stored when it did not; the step waits rather than resetting the
   * tuning, and nothing is recorded as sent, so it goes out on the pass after
   * the document arrives.
   */
  it('holds a step back from a device that has never sent its settings, and sends it once one arrives', async () => {
    await db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, spaceId: SPACE, configuration: null, state: { lastSeenAt: NOW } });
    await aPlan([step({ id: 'a', name: 'Veg', settings: { day: { temperature: 24 } } })]);

    await engine.run(NOW);

    expect(applied).toHaveLength(0);
    expect((await stored()).state.lastAppliedAt).toBeNull();

    await db.devices.updateOne({ id: DEVICE }, { $set: { configuration: { day: { temperature: 26 }, workmode: 'small' } } });
    await engine.run(at(MINUTE));

    expect(applied).toEqual([{ deviceId: DEVICE, settings: { day: { temperature: 24 } } }]);
  });

  /**
   * An empty document is not an empty change: the firmware rebuilds its whole
   * settings from what it is handed, so a step that writes nothing is sent
   * nothing - and is still counted as applied, so the plan moves on.
   */
  it('sends nothing for a step that writes nothing, to such a device or any other', async () => {
    await db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, spaceId: SPACE, configuration: null, state: { lastSeenAt: NOW } });
    await aPlan([step({ id: 'a', name: 'Veg' })]);

    await engine.run(NOW);

    expect(applied).toHaveLength(0);
    expect((await stored()).state.lastAppliedAt).toEqual(NOW);
  });

  it('sends nothing more once the plan is completed', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Only' })]);

    await engine.run(at(24 * HOUR));

    expect(applied).toHaveLength(0);
  });
});

describe('a step that waits for a person', () => {
  const waiting = () =>
    aPlan([step({ id: 'a', name: 'Dry', waitForConfirmation: true, confirmationMessage: 'Cut the plants' }), step({ id: 'b', name: 'Cure' })]);

  it('asks once and then stands still', async () => {
    await aDevice();
    await waiting();

    await engine.run(at(24 * HOUR));
    await engine.run(at(25 * HOUR));

    expect((await stored()).state).toMatchObject({ activeStepIndex: 0, confirmationNotifiedAt: at(24 * HOUR) });
    expect(mailed).toHaveLength(1);
    expect(mailed[0].text).toContain('Cut the plants');
    expect((await entries()).map(entry => entry.message?.key)).toEqual(['message-recipe-step-awaiting-confirmation']);
  });

  it('puts the ask to the tent´s people again until it lands, and not on every pass', async () => {
    await aDevice();
    await waiting();

    const asked: Date[] = [];
    let lands = false;
    const running = engineWith({
      askedToConfirm: async () => {
        asked.push(new Date());
        return lands;
      },
    });

    await running.run(at(24 * HOUR));
    await running.run(at(24 * HOUR + 20 * 1000));
    expect(asked).toHaveLength(1);
    expect((await stored()).state.confirmationAskedAt).toBeNull();

    // Quiet hours ending is a later pass, and a later pass is enough.
    lands = true;
    await running.run(at(24 * HOUR + 6 * MINUTE));
    expect(asked).toHaveLength(2);
    expect((await stored()).state.confirmationAskedAt).toEqual(at(24 * HOUR + 6 * MINUTE));

    await running.run(at(25 * HOUR));
    expect(asked).toHaveLength(2);

    // What the plan itself sends stays a once-only thing throughout.
    expect(mailed).toHaveLength(1);
    expect(await entries()).toHaveLength(1);
  });

  it('asks as sparingly for a plan that sends no mail of its own, and still writes its diary line', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Dry', waitForConfirmation: true, confirmationMessage: 'Cut the plants' })], {
      notify: { mode: 'off', email: null, writeEntries: true },
    });

    let asked = 0;
    const running = engineWith({
      askedToConfirm: async () => {
        asked += 1;
        return true;
      },
    });

    await running.run(at(24 * HOUR));
    await running.run(at(24 * HOUR + 20 * 1000));
    await running.run(at(25 * HOUR));

    expect(asked).toBe(1);
    expect(mailed).toHaveLength(0);
    expect((await entries()).map(entry => entry.message?.key)).toEqual(['message-recipe-step-awaiting-confirmation']);
  });

  it('moves on when it is confirmed, and refuses a confirmation nothing waits for', async () => {
    await aDevice();
    await waiting();
    await engine.run(at(24 * HOUR));

    await transitions.transition(DEVICE, { kind: 'confirm' }, OWNER);

    expect((await stored()).state.activeStepIndex).toBe(1);
    const written = await entries();
    expect(written[written.length - 1].values).toMatchObject({ transition: 'confirm', stepIndex: 1 });
    expect(written[written.length - 1].authorId).toBe(OWNER);

    await expect(transitions.transition(DEVICE, { kind: 'confirm' }, OWNER)).rejects.toThrow();
  });
});

describe('the transitions', () => {
  it('pauses with the time the step has served and resumes where it stopped', async () => {
    await aDevice();
    // The transitions are a person's and read the clock themselves, so the step
    // is dated against the real one.
    const startedAt = new Date(Date.now() - 24 * HOUR);
    await aPlan([step({ id: 'a', name: 'Veg', duration: { value: 2, unit: 'days' } }), step({ id: 'b', name: 'Flower' })], {
      state: { ...stoppedState, status: 'running', stepStartedAt: startedAt },
    });

    await transitions.transition(DEVICE, { kind: 'pause', reason: 'a preset was applied' });

    const paused = (await stored()).state;
    expect(paused).toMatchObject({ status: 'paused', stepStartedAt: null, pauseReason: 'a preset was applied' });
    expect(paused.pausedElapsedMs).toBeGreaterThanOrEqual(24 * HOUR);
    expect(paused.pausedElapsedMs).toBeLessThan(25 * HOUR);

    await transitions.transition(DEVICE, { kind: 'resume' });

    const resumed = (await stored()).state;
    expect(resumed).toMatchObject({ status: 'running', pausedElapsedMs: paused.pausedElapsedMs, pauseReason: null });

    // The day the step had served before the pause still counts, so half a day
    // more is not two days.
    await engine.run(new Date(resumed.stepStartedAt!.getTime() + 12 * HOUR));
    expect((await stored()).state.activeStepIndex).toBe(0);

    await engine.run(new Date(resumed.stepStartedAt!.getTime() + 25 * HOUR));
    expect((await stored()).state.activeStepIndex).toBe(1);
  });

  it('extends the step the device is on without touching the plan', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg' }), step({ id: 'b', name: 'Flower' })]);

    await transitions.transition(DEVICE, { kind: 'extend', by: { value: 12, unit: 'hours' } });

    const plan = await stored();
    expect(plan.steps[0].duration).toEqual({ value: 1, unit: 'days' });
    expect(plan.state.stepStartedAt).toEqual(at(12 * HOUR));

    await engine.run(at(24 * HOUR + MINUTE));
    expect((await stored()).state.activeStepIndex).toBe(0);
  });

  it('skips to the next step before the time is up', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg' }), step({ id: 'b', name: 'Flower' })]);

    await transitions.transition(DEVICE, { kind: 'skip' }, OWNER);

    expect((await stored()).state.activeStepIndex).toBe(1);
    expect((await entries())[0].values).toMatchObject({ transition: 'skip' });
  });

  it('starts a stopped plan on the step it stands at', async () => {
    await aDevice();
    await aGrowIn(SPACE);
    await aPlan([step({ id: 'a', name: 'Veg', stage: 'vegetative' })], { state: stoppedState });

    await transitions.transition(DEVICE, { kind: 'resume' }, OWNER);

    expect((await stored()).state).toMatchObject({ status: 'running', activeStepIndex: 0 });
    expect((await entries()).map(entry => entry.message?.key)).toContain('message-recipe-step-manually-activated');
    expect((await grow()).phases).toHaveLength(1);
  });
});

/**
 * Writing the plan itself, which is the one thing a person does to a plan that
 * is not a move of `state`. Where the plan stands has to survive it: a step
 * inserted above the running one must not restart the tent, and a plan saved for
 * the first time must not put a controller onto a step nobody has started.
 */
describe('replacing the steps', () => {
  /** A step the client has never been answered, which is the one thing that arrives without an id. */
  const newStep = (name: string): PlanStepInput => {
    const { id: _id, ...rest } = step({ id: 'unused', name });
    return rest;
  };

  const replacement = (steps: PlanStepInput[], rest: Partial<PlanReplace> = {}): PlanReplace => ({
    templateId: null,
    name: 'The plan',
    loop: false,
    notify: { mode: 'on_step', email: null, writeEntries: true },
    steps,
    ...rest,
  });

  it('creates the first plan of a device at rest, because saving one is not starting it', async () => {
    await aDevice();

    const written = await transitions.replace(DEVICE, replacement([step({ id: 'a', name: 'Veg' })]));

    expect(written.state).toMatchObject({ status: 'stopped', activeStepIndex: 0, stepStartedAt: null });
    expect(written.name).toBe('The plan');
    // Nothing reaches the device until the plan is started and the engine comes past.
    await engine.run(at(HOUR));
    expect(applied).toHaveLength(0);
  });

  it('gives a step that is new an id and keeps the one a step came back with', async () => {
    await aDevice();

    const written = await transitions.replace(DEVICE, replacement([step({ id: 'a', name: 'Veg' }), newStep('Flower')]));

    expect(written.steps[0].id).toBe('a');
    expect(written.steps[1].id).toEqual(expect.any(String));
    expect(written.steps[1].id).not.toBe('a');
  });

  /**
   * The plan of a tent that has been running since before the rewrite: steps
   * that name a climate and nothing else. The stored step has to come out of a
   * save exactly as it went in, because the one thing a person re-saving their
   * recipe must not do is give their tent stages it never had.
   */
  it('stores a step that named no stage as one that says nothing, and leaves it there on the next save', async () => {
    await aDevice();
    const { stage: _stage, preset: _preset, ...climateOnly } = newStep('Woche 1');

    const written = await transitions.replace(DEVICE, replacement([climateOnly]));
    expect(written.steps[0]).toMatchObject({ name: 'Woche 1', stage: null, preset: null });

    // The stored document, not the answer: what the engine and the next reader see.
    const storedFor = async () => (await plans.findOne({ deviceId: DEVICE }).lean<StoredPlan>().exec())!;
    const first = await storedFor();
    await transitions.replace(DEVICE, replacement(first.steps));

    expect((await storedFor()).steps).toEqual(first.steps);
  });

  it('refuses two steps under one id, which would make the running step ambiguous', async () => {
    await aDevice();

    await expect(transitions.replace(DEVICE, replacement([step({ id: 'a', name: 'Veg' }), step({ id: 'a', name: 'Flower' })]))).rejects.toMatchObject(
      {
        problem: { status: 422, code: 'duplicate_step_id' },
      },
    );
  });

  it('keeps the running step running when another is inserted above it', async () => {
    await aDevice();
    const startedAt = new Date(Date.now() - 12 * HOUR);
    await aPlan([step({ id: 'a', name: 'Veg' }), step({ id: 'b', name: 'Flower', duration: { value: 2, unit: 'days' } })], {
      state: { ...stoppedState, status: 'running', activeStepIndex: 1, stepStartedAt: startedAt, lastAppliedAt: startedAt },
    });

    const written = await transitions.replace(
      DEVICE,
      replacement([step({ id: 'seed', name: 'Seedling' }), step({ id: 'a', name: 'Veg' }), step({ id: 'b', name: 'Flower, longer' })]),
    );

    // The step moved down the list and the plan moved with it, with the half day
    // it had already served.
    expect(written.state).toMatchObject({ status: 'running', activeStepIndex: 2, stepStartedAt: startedAt });
    expect(written.steps[2].name).toBe('Flower, longer');
  });

  it('sends the step again at once, rather than leaving the device on the settings the edit replaced', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg', settings: { workmode: 'small' } })]);
    await engine.run(NOW);
    expect(applied).toEqual([{ deviceId: DEVICE, settings: { workmode: 'small' } }]);

    await transitions.replace(DEVICE, replacement([step({ id: 'a', name: 'Veg', settings: { workmode: 'large' } })]));

    // Without the cleared `lastAppliedAt` the tent would keep the old settings
    // for the rest of the hour the engine's re-apply covers.
    expect((await stored()).state.lastAppliedAt).toBeNull();
    await engine.run(at(MINUTE));
    expect(applied[1]).toEqual({ deviceId: DEVICE, settings: { workmode: 'large' } });
  });

  it('starts the step standing at its place when the running one is deleted', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg' }), step({ id: 'b', name: 'Flower' })], {
      state: { ...stoppedState, status: 'running', activeStepIndex: 1, stepStartedAt: new Date(Date.now() - 12 * HOUR) },
    });

    const written = await transitions.replace(DEVICE, replacement([step({ id: 'a', name: 'Veg' }), step({ id: 'c', name: 'Dry' })]));

    expect(written.state.activeStepIndex).toBe(1);
    // Nothing of the deleted step's clock carries over to the one that replaced it.
    expect(written.state.stepStartedAt!.getTime()).toBeGreaterThan(Date.now() - MINUTE);
    expect(written.state.pausedElapsedMs).toBe(0);
  });

  it('stops a plan that is left with no steps at all', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg' })]);

    const written = await transitions.replace(DEVICE, replacement([]));

    expect(written.state).toMatchObject({ status: 'stopped', activeStepIndex: 0, stepStartedAt: null });
    await expect(transitions.transition(DEVICE, { kind: 'resume' })).rejects.toMatchObject({ problem: { code: 'plan_has_no_steps' } });
  });
});

describe('stopping a plan', () => {
  it('keeps its steps, stands it at the first one, and lets it be started again', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg' }), step({ id: 'b', name: 'Flower' })], {
      state: { ...stoppedState, status: 'running', activeStepIndex: 1, stepStartedAt: NOW },
    });

    await transitions.stop(DEVICE);

    const put = await stored();
    expect(put.state).toMatchObject({ status: 'stopped', activeStepIndex: 0, stepStartedAt: null, pausedElapsedMs: 0 });
    expect(put.steps.map(one => one.id)).toEqual(['a', 'b']);

    await transitions.transition(DEVICE, { kind: 'resume' }, OWNER);
    expect((await stored()).state).toMatchObject({ status: 'running', activeStepIndex: 0 });
  });

  it('leaves the device on the settings the last step gave it', async () => {
    await aDevice();
    await aPlan([step({ id: 'a', name: 'Veg', settings: { workmode: 'small' } })]);
    await engine.run(NOW);

    await transitions.stop(DEVICE);
    await engine.run(at(2 * HOUR));

    // One send, from before the stop: stopping a plan says nothing about what a
    // tent should be doing instead.
    expect(applied).toHaveLength(1);
  });

  it('refuses to stop what is not there', async () => {
    await aDevice();

    await expect(transitions.stop(DEVICE)).rejects.toMatchObject({ problem: { status: 404, code: 'plan_not_found' } });
  });
});

describe('the phase a step puts the grow into', () => {
  it('writes the phase, the entry and the thresholds once, with the targets the controller runs', async () => {
    await aDevice();
    await aGrowIn(SPACE);
    await aPlan([
      step({ id: 'a', name: 'Veg' }),
      step({ id: 'b', name: 'Flower', stage: 'flowering', preset: 'late_flowering' }),
      step({ id: 'c', name: 'Flower on', stage: 'flowering', preset: 'late_flowering' }),
    ]);

    await engine.run(at(24 * HOUR));

    const phases = (await grow()).phases;
    expect(phases).toHaveLength(1);
    expect(phases[0]).toMatchObject({ stage: 'flowering', preset: 'late_flowering', source: 'plan', setBy: null, deviceId: DEVICE });
    expect(phases[0].targets).toEqual({ day: { temperature: 26, humidity: 60 }, night: { temperature: 21, humidity: 55 }, co2: 900 });
    expect(stages).toEqual([{ deviceId: DEVICE, stage: 'flowering', preset: 'late_flowering' }]);

    const phaseEntry = (await entries()).find(entry => entry.kind === 'phase');
    expect(phaseEntry).toMatchObject({ source: 'plan', growId: GROW, spaceId: SPACE, deviceId: DEVICE });
    expect(phaseEntry?.values).toEqual({ kind: 'phase', phaseId: phases[0].id, stage: 'flowering', preset: 'late_flowering' });

    // The step after it carries the same stage, which is not a phase change.
    await engine.run(at(48 * HOUR));
    expect((await grow()).phases).toHaveLength(1);
  });

  it('invents no grow for a controller that is simply on', async () => {
    await aDevice();
    await aGrowIn('another-space');
    await aPlan([step({ id: 'a', name: 'Veg' }), step({ id: 'b', name: 'Flower', stage: 'flowering' })]);

    await engine.run(at(24 * HOUR));

    expect((await grow()).phases).toHaveLength(0);
    expect(stages).toHaveLength(0);
    // The step change is still a line in the diary, filed under the device.
    expect((await entries()).map(entry => entry.kind)).toEqual(['plan']);
  });
});
