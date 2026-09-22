import { createAccount, Session } from '../support/api';
import { provisionDevice } from '../support/device';
import { everythingIn, unzip } from '../support/zip';

/**
 * `GET /v1/me/export`, over HTTP and opened afterwards.
 *
 * `charts.spec.ts` has the job: that the route answers one, that it finishes,
 * and that nobody else can reach it. What is checked here is the promise the
 * privacy screen makes about the file itself - "export everything · yours to
 * keep" - which is a promise about two things at once. Everything this account
 * owns has to be in the archive, and nothing anybody else owns may be, however
 * much of it the same database holds and however much of it this account is
 * allowed to read.
 *
 * So the second account is not a bystander. It shares its tent with the first,
 * which is the case that would quietly widen an export written against reach
 * rather than against ownership: a member may read that tent, log in it and
 * manage it, and owns none of it.
 */

let owner: Session;
let neighbour: Session;
let tent: string;
let grow: { id: string; slug: string };
let theirGrow: { id: string; slug: string };

/** How long a spec waits for the builder, which wakes a couple of seconds after an export is asked for. */
const READY_TIMEOUT_MS = 60_000;

const startAGrow = (session: Session, name: string, spaceId: string) =>
  session.client
    .post('/v1/grows')
    .send({
      name,
      type: 'photoperiod',
      startedAt: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
      plants: [{ strain: 'Amnesia', count: 2 }],
      spaceId,
    })
    .expect(201);

/**
 * Polls the job the way a client does, then takes the file the way a browser
 * does. An export asked for twice in an hour is one export, so the second
 * request answers 200 and the file already there rather than 202 and a new job.
 */
const archiveOf = async (session: Session, path: string): Promise<Map<string, Buffer>> => {
  const accepted = await session.client.get(path);
  expect([200, 202]).toContain(accepted.status);
  const until = Date.now() + READY_TIMEOUT_MS;

  for (;;) {
    const row = (await session.client.get(`/v1/media/${accepted.body.media.id}`).expect(200)).body;
    if (row.exportJob.status === 'ready') break;
    if (row.exportJob.status === 'failed') throw new Error(`The export failed: ${row.exportJob.error}`);
    if (Date.now() > until) throw new Error(`The export was still ${row.exportJob.status} after ${READY_TIMEOUT_MS} ms`);

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const file = await session.client.get(`/v1/media/${accepted.body.media.id}/content`).responseType('blob').expect(200);

  return unzip(file.body as Buffer);
};

beforeAll(async () => {
  owner = await createAccount('export-owner');
  neighbour = await createAccount('export-neighbour');

  const device = await provisionDevice(owner, 'controller');
  tent = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId;
  await owner.client.patch(`/v1/spaces/${tent}`).send({ name: 'The owner´s tent' }).expect(200);

  grow = (await startAGrow(owner, 'Mine to keep', tent)).body;
  await owner.client
    .post('/v1/entries')
    .send({ kind: 'note', spaceId: tent, text: 'A line about the tent and no grow', values: { kind: 'note' } })
    .expect(201);
  await owner.client
    .post('/v1/cameras')
    .send({ kind: 'rtsp', spaceId: tent, name: 'The owner´s cam', url: 'rtsp://viewer:hunter2@10.0.0.30:554/stream1' })
    .expect(201);
  await owner.client
    .post(`/v1/devices/${device.deviceId}/alarm-rules`)
    .send({
      name: 'Owner´s alarm',
      watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
      forSeconds: 0,
      severity: 'warning',
      enabled: true,
      cooldownSeconds: 0,
      repeatSeconds: 0,
      delivery: { mode: 'routing', custom: null },
    })
    .expect(201);
  await owner.client
    .post('/v1/reminders')
    .send({ subject: { type: 'space', id: tent }, kind: 'water', label: 'Owner´s watering', everyDays: 3, onceAt: null })
    .expect(201);

  // The neighbour is let into the owner's tent, and keeps a grow and a camera
  // of their own in a tent of their own.
  const invite = (await owner.client.post(`/v1/spaces/${tent}/invites`).send({ role: 'can_manage' }).expect(201)).body;
  await neighbour.client.post(`/v1/invites/${invite.code}/acceptances`).expect(201);

  const theirTent = (await neighbour.client.post('/v1/spaces').send({ kind: 'tent', name: 'The neighbour´s tent' }).expect(201)).body.id;
  theirGrow = (await startAGrow(neighbour, 'Never mine', theirTent)).body;
  await neighbour.client
    .post('/v1/cameras')
    .send({ kind: 'rtsp', spaceId: theirTent, name: 'The neighbour´s cam', url: 'rtsp://viewer:hunter2@10.0.0.31:554/stream1' })
    .expect(201);
});

describe('GET /v1/me/export', () => {
  it('holds everything the account owns: its settings, its places, its hardware, its alarms, its tasks and a folder per grow', async () => {
    const files = await archiveOf(owner, '/v1/me/export');

    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        'account.json',
        'account.csv',
        'spaces.csv',
        'devices.csv',
        'cameras.csv',
        'alarms.csv',
        'alerts.csv',
        'tasks.csv',
        'plans.csv',
        'diary.csv',
        `grows/${grow.slug}/grow.csv`,
        `grows/${grow.slug}/plants.csv`,
        `grows/${grow.slug}/diary.csv`,
        `grows/${grow.slug}/measurements.csv`,
        `grows/${grow.slug}/climate.csv`,
      ]),
    );

    const everything = everythingIn(files);
    expect(everything).toContain('The owner´s tent');
    expect(everything).toContain('The owner´s cam');
    expect(everything).toContain('Owner´s alarm');
    expect(everything).toContain('Owner´s watering');
    expect(files.get('diary.csv')!.toString('utf8')).toContain('A line about the tent and no grow');
    // The account's own settings, in the one file that is not a spreadsheet.
    expect(JSON.parse(files.get('account.json')!.toString('utf8'))).toMatchObject({
      handle: owner.handle,
      email: owner.username,
      privacy: { hideWeights: false, hideCounts: false },
    });
  });

  it('never carries the two things an account keeps to itself', async () => {
    const everything = everythingIn(await archiveOf(owner, '/v1/me/export'));

    expect(everything).not.toContain('passwordHash');
    expect(everything).not.toContain('activationCode');
    // The credentials a camera's stream is opened with are the server's to
    // keep; an export is read on a laptop and passed on.
    expect(everything).not.toContain('hunter2');
  });

  it('holds nothing of the neighbour´s, not even the tent they were let into', async () => {
    const files = await archiveOf(neighbour, '/v1/me/export');
    const everything = everythingIn(files);

    // The neighbour may manage the owner's tent and everything standing in it.
    // None of that is theirs, so none of it is in their export.
    expect(everything).not.toContain('The owner´s tent');
    expect(everything).not.toContain('The owner´s cam');
    expect(everything).not.toContain('Owner´s alarm');
    expect(everything).not.toContain('Owner´s watering');
    expect(everything).not.toContain('A line about the tent and no grow');
    expect([...files.keys()]).toEqual(expect.not.arrayContaining([expect.stringContaining(`grows/${grow.slug}/`)]));

    // What is theirs is there, which is what makes the absences above mean
    // something.
    expect([...files.keys()]).toEqual(expect.arrayContaining([`grows/${theirGrow.slug}/grow.csv`]));
    expect(everything).toContain('The neighbour´s cam');
  });

  it('is the owner´s alone, and says nothing of the neighbour´s grow either', async () => {
    const files = await archiveOf(owner, '/v1/me/export');
    const everything = everythingIn(files);

    expect(everything).not.toContain('The neighbour´s tent');
    expect(everything).not.toContain('The neighbour´s cam');
    expect(everything).not.toContain('Never mine');
    expect([...files.keys()]).toEqual(expect.not.arrayContaining([expect.stringContaining(`grows/${theirGrow.slug}/`)]));
  });
});
