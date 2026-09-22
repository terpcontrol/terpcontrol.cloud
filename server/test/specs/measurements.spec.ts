import { createAccount, demoSession, Session, unique } from '../support/api';
import { claimCodeOf, registerDevice } from '../support/device';
import { joinSpace } from '../support/fixtures';

/**
 * What a grow measures beyond climate: height, EC, pH, whatever somebody
 * decided to write down.
 *
 * The list is editable, and the point of this spec is where it stops being so. A
 * reading carries a key and a number and nothing else - its name, its unit and
 * whether it belongs to a plant or to the grow all live in the definition - so a
 * definition that entries already use is not a row that can be taken out or
 * rescoped without making readings already written unreadable or untrue. Both
 * are refused, and everything else about a definition stays free to change.
 */

let owner: Session;
let helper: Session;
let stranger: Session;
let tent: string;

const HEIGHT = { key: 'height', name: 'Height', unit: 'cm', perPlant: true, targetMin: null, targetMax: null, chart: true };
const EC = { key: 'ec_input', name: 'EC · input', unit: 'mS/cm', perPlant: false, targetMin: 1.6, targetMax: 1.6, chart: true };

const startAGrow = async (measurements: Record<string, unknown>[] = [HEIGHT, EC]) =>
  (
    await owner.client
      .post('/v1/grows')
      .send({
        name: unique('Spring run'),
        type: 'photoperiod',
        plants: [{ strain: 'Amnesia', count: 2 }],
        spaceId: tent,
        measurements,
      })
      .expect(201)
  ).body;

const measure = (growId: string, key: string, value: number, plantId: string | null = null) =>
  owner.client
    .post('/v1/entries')
    .send({ kind: 'measurement', growId, values: { kind: 'measurement', readings: [{ key, value, plantId }] } })
    .expect(201);

beforeAll(async () => {
  owner = await createAccount('measurements-owner');
  helper = await createAccount('measurements-helper');
  stranger = await createAccount('measurements-stranger');

  const device = await registerDevice('controller');
  const claimed = await owner.client
    .post('/v1/devices/claims')
    .send({ code: await claimCodeOf(device.deviceId) })
    .expect(201);
  tent = claimed.body.device.spaceId;

  await joinSpace(tent, helper.userId, 'can_log');
});

describe('defining what a grow measures', () => {
  it('takes the definitions the new-grow sheet wrote', async () => {
    const grow = await startAGrow();

    expect(grow.measurements).toEqual([HEIGHT, EC]);
  });

  it('adds one after the grow was made', async () => {
    const grow = await startAGrow();
    const ph = { key: 'ph_input', name: 'pH · input', unit: '', perPlant: false, targetMin: 6.3, targetMax: 6.3, chart: true };

    const changed = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [...grow.measurements, ph] })
      .expect(200);

    expect(changed.body.measurements).toEqual([HEIGHT, EC, ph]);
  });

  it('renames one, changes its unit and its target, and takes it off the chart, readings and all', async () => {
    const grow = await startAGrow();
    await measure(grow.id, 'ec_input', 1.8);

    const renamed = { ...EC, name: 'Runoff EC', unit: 'µS/cm', target: 2.2, chart: false };
    const changed = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT, renamed] })
      .expect(200);

    expect(changed.body.measurements).toEqual([HEIGHT, renamed]);
  });

  it('refuses two definitions sharing a key, whether the grow is being made or edited', async () => {
    const clash = await owner.client
      .post('/v1/grows')
      .send({
        name: unique('Clashing run'),
        type: 'photoperiod',
        plants: [{ strain: 'Amnesia', count: 1 }],
        measurements: [HEIGHT, { ...HEIGHT, name: 'Height again' }],
      })
      .expect(422);
    expect(clash.body.code).toBe('measurement_key_twice');

    const grow = await startAGrow();
    const later = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT, EC, { ...EC, name: 'EC again' }] })
      .expect(422);
    expect(later.body.code).toBe('measurement_key_twice');
  });
});

describe('a definition entries already carry readings for', () => {
  it('can be taken out again while nothing has been measured under it', async () => {
    const grow = await startAGrow();

    const changed = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT] })
      .expect(200);
    expect(changed.body.measurements).toEqual([HEIGHT]);
  });

  it('is not taken out once a reading exists, so no number is left in the diary without a name', async () => {
    const grow = await startAGrow();
    await measure(grow.id, 'ec_input', 1.6);

    const refused = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT] })
      .expect(422);
    expect(refused.body.code).toBe('measurement_has_readings');

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.measurements).toEqual([HEIGHT, EC]);
  });

  it('keeps the reading itself, which is the point of refusing', async () => {
    const grow = await startAGrow();
    const written = await measure(grow.id, 'ec_input', 1.6);

    await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT] })
      .expect(422);

    const entries = await owner.client.get(`/v1/entries?growId=${grow.id}`).expect(200);
    expect(entries.body.items.map((row: { id: string }) => row.id)).toContain(written.body.id);
  });

  it('is refused the same way for a reading written on a watering or a feed', async () => {
    const grow = await startAGrow();
    await owner.client
      .post('/v1/entries')
      .send({ kind: 'water', growId: grow.id, values: { kind: 'water', litres: 4, readings: [{ key: 'ec_input', value: 1.1, plantId: null }] } })
      .expect(201);

    const refused = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT] })
      .expect(422);
    expect(refused.body.code).toBe('measurement_has_readings');
  });

  it('does not stop a definition nothing has measured going out in the same edit', async () => {
    const pot = { key: 'pot_size', name: 'Pot size', unit: 'L', perPlant: true, targetMin: null, targetMax: null, chart: false };
    const grow = await startAGrow([HEIGHT, EC, pot]);
    await measure(grow.id, 'ec_input', 1.6);

    const changed = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT, EC] })
      .expect(200);

    expect(changed.body.measurements).toEqual([HEIGHT, EC]);
  });
});

describe('per plant or per grow', () => {
  it('is free to change while nothing has been measured under the key', async () => {
    const grow = await startAGrow();

    const changed = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT, { ...EC, perPlant: true }] })
      .expect(200);

    expect(changed.body.measurements[1].perPlant).toBe(true);
  });

  it('is chosen once a reading has been taken, so nothing already written changes what it meant', async () => {
    const grow = await startAGrow();
    await measure(grow.id, 'ec_input', 1.6);

    const refused = await owner.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT, { ...EC, perPlant: true }] })
      .expect(422);
    expect(refused.body.code).toBe('measurement_scope_fixed');

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.measurements[1].perPlant).toBe(false);
  });
});

describe('who may change the list', () => {
  it('is whoever manages the grow, and not somebody who may only log in it', async () => {
    const grow = await startAGrow();

    await helper.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT] })
      .expect(403);
    await stranger.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT] })
      .expect(404);
  });

  it('is not the demo tour, which writes nothing anywhere', async () => {
    const grow = await startAGrow();
    const demo = await demoSession();

    await demo.client
      .patch(`/v1/grows/${grow.id}`)
      .send({ measurements: [HEIGHT] })
      .expect(403);
  });
});
