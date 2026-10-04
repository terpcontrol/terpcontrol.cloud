import { jest } from '@jest/globals';
import { climatePreset, STAGES_WITH_CLIMATE } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { CONFIGURATION_FIELDS } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { ProblemException } from '@common/v1/problem';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DeviceIngestService } from '@modules/device-protocol/device-ingest.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { DOCUMENT_FIGURES, TEMPLATE_FIGURES, figureRefusals, withFiguresHeld, type DocumentFigure } from '@modules/device-protocol/document-figures';
import { HardwareReportService } from '@modules/device-protocol/hardware-report.service';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { PlanProgressService } from '@modules/v1/plan/plan-progress.service';
import { PlanService } from '@modules/v1/plan/plan.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * What a device's firmware reads out of its document, held on every way a
 * document reaches it. The firmware takes each figure with ArduinoJson's
 * `as<float>()`, which reads anything that is not a number as 0: a night
 * temperature written as `{"$numberInt": "24"}` - Extended JSON, as a database
 * tool writes it - reached the device as 0 °C.
 */

const EJSON = { $numberInt: '24' };

const fridge = (over: Record<string, unknown> = {}) => ({
  workmode: 'small',
  day: { temperature: 25, humidity: 60 },
  night: { temperature: 20, humidity: 55 },
  daynight: { day: 21600, night: 64800, maxDehumidifySeconds: 2700, targetHumidityDiff: 5, useLongHumidityAvg: 0, linearChange: 1 },
  co2: { target: 900, sunsetOff: 1 },
  lights: { limit: 80, sunrise: 15, sunset: 15, maintenanceOn: 0 },
  fans: { external: 100, internal: 100 },
  ...over,
});

const fieldsOf = (errors: { field: string }[]) => errors.map(error => error.field);

describe('a document a client sends', () => {
  it('is refused where a figure the firmware reads as a number is none, every place named', () => {
    const errors = figureRefusals('fridge', fridge({ night: { temperature: EJSON, humidity: '55' }, lights: { limit: [80] } }));

    expect(errors).toEqual([
      { field: 'configuration.night.temperature', code: 'invalid_type', detail: 'The fridge reads this as a number.' },
      { field: 'configuration.night.humidity', code: 'invalid_type', detail: 'The fridge reads this as a number.' },
      { field: 'configuration.lights.limit', code: 'invalid_type', detail: 'The fridge reads this as a number.' },
    ]);
  });

  it('is refused outside the firmware´s range, and a section that is none is named once', () => {
    expect(figureRefusals('controller', fridge({ day: { temperature: 45, humidity: -1 } }))).toEqual([
      expect.objectContaining({ field: 'configuration.day.temperature', code: 'too_big' }),
      expect.objectContaining({ field: 'configuration.day.humidity', code: 'too_small' }),
    ]);
    expect(fieldsOf(figureRefusals('fridge', fridge({ night: 24, daynight: { day: -60, night: 64800 } })))).toEqual([
      'configuration.night',
      'configuration.daynight.day',
    ]);
    // The work mode is a word to the firmware, a switch is on or off.
    expect(fieldsOf(figureRefusals('fridge', fridge({ workmode: 2, co2: { target: 900, sunsetOff: 'yes' } })))).toEqual([
      'configuration.workmode',
      'configuration.co2.sunsetOff',
    ]);
  });

  /**
   * The firmware compares its work mode with words of its own, and a word none
   * of its branches takes regulates nothing: a plan step written with
   * `workmode: "banana"` reached a fridge, and nothing was held.
   */
  it('is refused a work mode or a dosing mode the firmware does not know, and not one the device already runs', () => {
    expect(figureRefusals('fridge', fridge({ workmode: 'banana' }))).toEqual([
      {
        field: 'configuration.workmode',
        code: 'invalid_value',
        detail: 'The fridge knows this as one of: off, small, full, temp, breed, dry.',
      },
    ]);
    expect(fieldsOf(figureRefusals('controller', fridge({ workmode: 'exp' })))).toEqual(['configuration.workmode']);
    expect(fieldsOf(figureRefusals('plug', { workmode: 'humidifier', co2: { mode: 'sometimes' } }))).toEqual([
      'configuration.workmode',
      'configuration.co2.mode',
    ]);
    for (const workmode of ['off', 'small', 'full', 'temp', 'breed', 'dry']) {
      expect(figureRefusals('fridge', fridge({ workmode }))).toEqual([]);
      expect(figureRefusals('controller', fridge({ workmode }))).toEqual([]);
    }
    expect(figureRefusals('plug', { workmode: 'watering', co2: { mode: 'periodic' } })).toEqual([]);
    // A fridge's own `exp`, set before any of this, is the device's; so is a word a newer build sends.
    const experimental = fridge({ workmode: 'exp' });
    expect(figureRefusals('fridge', experimental, { stored: experimental })).toEqual([]);
    expect(withFiguresHeld('fridge', fridge({ workmode: 'future' }), null).dropped).toEqual([]);
  });

  it('keeps every key the firmware does not read as it came, and takes a switch as true or false or a figure', () => {
    expect(figureRefusals('fridge', fridge({ futureKey: { anything: [1, 'two'] }, 'day.temperature': EJSON }))).toEqual([]);
    expect(figureRefusals('fridge', fridge({ daynight: { day: 21600, night: 64800, useLongHumidityAvg: true, linearChange: 1 } }))).toEqual([]);
    expect(figureRefusals('cam', { anything: EJSON })).toEqual([]);
  });

  it('does not hold the client to what the device already runs, which is put right on the way instead', () => {
    // A figure set on the device's own menu, or by the old app, outside what is offered now.
    const stored = fridge({ day: { temperature: 41, humidity: 60 } });
    expect(figureRefusals('fridge', stored, { stored })).toEqual([]);
    expect(fieldsOf(figureRefusals('fridge', fridge({ day: { temperature: 42, humidity: 60 } }), { stored }))).toEqual([
      'configuration.day.temperature',
    ]);
    // A figure stored before any of this was checked is no fault of a page that sends the document whole.
    const junk = fridge({ night: { temperature: { celsius: 24 }, humidity: 55 } });
    expect(figureRefusals('fridge', junk, { stored: junk })).toEqual([]);
    expect(fieldsOf(figureRefusals('fridge', fridge({ night: { temperature: EJSON, humidity: 55 } }), { stored: junk }))).toEqual([
      'configuration.night.temperature',
    ]);
  });

  it('reads each type´s own document: a lamp´s times are figures where a fridge´s day is a section', () => {
    expect(figureRefusals('light', { day: 21600, night: 79200, limit: 80, max_temperature: 35 })).toEqual([]);
    expect(fieldsOf(figureRefusals('light', { day: { temperature: 24 } }))).toEqual(['configuration.day']);
    expect(fieldsOf(figureRefusals('fan', { mode: 4, day: { fixed_speed: EJSON } }))).toEqual([
      'configuration.mode',
      'configuration.day.fixed_speed',
    ]);
    expect(
      fieldsOf(
        figureRefusals('plug', {
          workmode: 'timer',
          timer: { timeframes: [{ ontime: 36000, duration: EJSON }] },
          co2: { period: 0 },
          limits: { overtemperature: { enabled: 1, limit: 45 } },
        }),
      ),
    ).toEqual(['configuration.timer.timeframes', 'configuration.co2.period']);
  });

  it('takes in everything a setting by name may be set to, every climate a stage writes, and a resting humidifier', () => {
    for (const [type, fields] of Object.entries(CONFIGURATION_FIELDS)) {
      for (const field of Object.values(fields)) {
        // A choice the device keeps as a word is one of the words its firmware knows.
        const word = field.kind === 'choice' && field.path ? (DOCUMENT_FIGURES[type][field.path] as DocumentFigure | undefined) : undefined;
        if (word?.kind === 'word' && field.kind === 'choice') {
          expect({ type, path: field.path, options: field.options.filter(option => !(word.words ?? [option]).includes(option)) }).toEqual({
            type,
            path: field.path,
            options: [],
          });
        }
        if (field.kind !== 'number') continue;
        const figure = DOCUMENT_FIGURES[type][field.path] as DocumentFigure | undefined;
        expect({ type, path: field.path, kind: figure?.kind }).toEqual({ type, path: field.path, kind: 'number' });
        if (figure?.kind !== 'number') continue;
        expect({ type, path: field.path, within: figure.min <= field.min && figure.max >= field.max }).toEqual({
          type,
          path: field.path,
          within: true,
        });
      }
    }
    for (const stage of STAGES_WITH_CLIMATE) {
      const climate = climatePreset(stage, null)!;
      const document = fridge({
        day: { temperature: climate.dayTemperature ?? 25, humidity: climate.dayHumidity ?? 60 },
        night: { temperature: climate.nightTemperature, humidity: climate.nightHumidity ?? 55 },
        co2: { target: climate.co2 ?? 400 },
        lights: { limit: climate.lightLimit ?? 80 },
      });
      expect(figureRefusals('fridge', document)).toEqual([]);
      expect(figureRefusals('controller', document)).toEqual([]);
    }
    expect(figureRefusals('fridge', fridge({ daynight: { day: 172801, night: 172800, targetHumidityDiff: 100 } }))).toEqual([]);
  });

  it('holds a plan template to what any device that holds a climate reads at a place', () => {
    expect(
      fieldsOf(
        figureRefusals(
          'device',
          { night: { temperature: EJSON }, day: { fixed_speed: 'fast' } },
          { field: 'steps.0.settings', figures: TEMPLATE_FIGURES },
        ),
      ),
    ).toEqual(['steps.0.settings.day.fixed_speed', 'steps.0.settings.night.temperature']);
    expect(fieldsOf(figureRefusals('device', { workmode: 'banana' }, { field: 'steps.0.settings', figures: TEMPLATE_FIGURES }))).toEqual([
      'steps.0.settings.workmode',
    ]);
  });
});

describe('a document on its way to a device', () => {
  it('has a figure the firmware would misread replaced by the one it ran, or taken out where it ran none', () => {
    const held = withFiguresHeld('fridge', fridge({ night: { temperature: EJSON, humidity: EJSON }, fans: 7 }), fridge({ night: { humidity: 50 } }));

    expect(held.configuration).toMatchObject({ night: { humidity: 50 } });
    expect((held.configuration.night as Record<string, unknown>).temperature).toBeUndefined();
    expect(held.dropped).toEqual(['night.temperature', 'night.humidity']);
    // A section that is none is read as nothing, as a missing one is: there is nothing to put right.
    expect(held.configuration.fans).toBe(7);
  });

  it('reads a figure written as digits as that figure, and leaves a document that fits as it is', () => {
    const fits = fridge();
    expect(withFiguresHeld('fridge', fits, null)).toEqual({ configuration: fits, dropped: [] });
    expect(withFiguresHeld('fridge', fridge({ night: { temperature: '21.5', humidity: 55 } }), null)).toEqual({
      configuration: fridge({ night: { temperature: 21.5, humidity: 55 } }),
      dropped: [],
    });
    expect(withFiguresHeld('cam', { anything: EJSON }, null).dropped).toEqual([]);
  });
});

describe('every way a document reaches a device', () => {
  const DEVICE = 'sim-fridge-figures';
  let db: V1TestDatabase;
  let published: Record<string, unknown>[];
  let configuration: DeviceConfigurationService;
  let ingest: DeviceIngestService;

  const stored = async () => (await db.devices.findOne({ id: DEVICE }).lean<StoredDevice>())!;

  beforeAll(async () => {
    db = await startV1TestDatabase();
  });

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    await db.reset();
    published = [];
    const mqtt = {
      canPublish: true,
      publish: jest.fn((_topic: string, message: string) => {
        published.push(JSON.parse(message));
        return true;
      }),
    } as unknown as MqttClientService;
    const publisher = new DevicePublisherService(db.devices, mqtt);
    const entries = new EntryWriterService(db.entries);
    configuration = new DeviceConfigurationService(db.devices, db.users, db.targetChanges, publisher, entries);
    ingest = new DeviceIngestService(
      db.devices,
      db.cameras,
      db.targetChanges,
      mqtt,
      publisher,
      new HardwareReportService(db.devices, db.cameras),
      entries,
    );
    await db.devices.create({ id: DEVICE, type: 'fridge', ownerId: 'user-1', configuration: fridge() });
  });

  it('refuses the targets saved with a figure the firmware would misread, and stores and sends nothing', async () => {
    const refused = await configuration
      .replace(DEVICE, fridge({ night: { temperature: EJSON, humidity: 55 } }), 'user-1')
      .catch((error: unknown) => error as ProblemException);

    expect(refused).toBeInstanceOf(ProblemException);
    expect((refused as ProblemException).problem).toMatchObject({
      status: 400,
      code: 'validation_failed',
      errors: [{ field: 'configuration.night.temperature', code: 'invalid_type' }],
    });
    expect((await stored()).configuration).toEqual(fridge());
    expect(published).toEqual([]);
  });

  it('sends a plan step stored before steps were checked without what the firmware would misread', async () => {
    await configuration.applyConfiguration(DEVICE, { night: { temperature: EJSON } }, 'vegetative');

    expect(published.at(-1)).toMatchObject({ night: { temperature: 20, humidity: 55 } });
    expect((await stored()).configuration).toMatchObject({ night: { temperature: 20, humidity: 55 } });
  });

  it('keeps a document a device sent without a figure it would misread, and sends it back put right', async () => {
    await ingest.handle(`/devices/${DEVICE}/configuration`, JSON.stringify(fridge({ day: { temperature: { value: 30 }, humidity: 60 } })));

    expect((await stored()).configuration).toMatchObject({ day: { temperature: 25, humidity: 60 } });
    expect(published.at(-1)).toMatchObject({ day: { temperature: 25, humidity: 60 } });
  });

  it('takes the targets saved whole over a figure stored before any of this was checked, and sends them without it', async () => {
    await db.devices.updateOne({ id: DEVICE }, { $set: { 'configuration.fans.internal': { percent: 60 } } });
    const page = { ...(await stored()).configuration, day: { temperature: 26, humidity: 60 } };

    await configuration.replace(DEVICE, page, 'user-1');

    expect(published.at(-1)).toMatchObject({ day: { temperature: 26 }, fans: { external: 100 } });
    expect((published.at(-1)!.fans as Record<string, unknown>).internal).toBeUndefined();
    expect((await stored()).configuration?.fans).toEqual({ external: 100 });
  });

  it('answers a device asking for its document without a figure stored before any of this was checked', async () => {
    await db.devices.updateOne({ id: DEVICE }, { $set: { 'configuration.night.temperature': { celsius: 24 } } });

    await ingest.handle(`/devices/${DEVICE}/fetch`, JSON.stringify({}));

    const sent = published.at(-1)!;
    expect(sent.night).toEqual({ humidity: 55 });
  });

  it('refuses a plan whose step carries a figure the firmware would misread, naming the step', async () => {
    const plans = new PlanService(db.plans, db.devices, {} as PlanProgressService);
    const step = {
      name: 'Veg',
      stage: 'vegetative' as const,
      duration: { value: 1, unit: 'weeks' as const },
      settings: { night: { temperature: 21 } },
      waitForConfirmation: false,
      confirmationMessage: null,
    };
    const body = { templateId: null, name: 'Plan', loop: false, notify: { mode: 'off' as const, email: null, writeEntries: false } };

    const refused = await plans
      .replace(DEVICE, {
        ...body,
        steps: [step, { ...step, settings: { workmode: 'banana', night: { temperature: EJSON }, lights: { limit: 140 } } }],
      })
      .catch((error: unknown) => error as ProblemException);
    expect((refused as ProblemException).problem).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(fieldsOf((refused as ProblemException).problem.errors)).toEqual([
      'steps.1.settings.workmode',
      'steps.1.settings.night.temperature',
      'steps.1.settings.lights.limit',
    ]);
    expect(await db.plans.countDocuments({ deviceId: DEVICE })).toBe(0);

    await plans.replace(DEVICE, { ...body, steps: [step] });
    expect(await db.plans.countDocuments({ deviceId: DEVICE })).toBe(1);
  });
});
