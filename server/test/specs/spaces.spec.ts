import { anonymous, createAccount, Session } from '../support/api';
import { seedMeasurements } from '../support/control';
import { provisionDevice } from '../support/device';
import { joinSpace, seedRow, setRow } from '../support/fixtures';
import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';

/**
 * A space over HTTP: the places somebody grows in, the room that groups them,
 * and what the server refuses to do to one from outside.
 *
 * What the unit suite cannot see is here: the status codes, the body a bad
 * request is refused with, and that a caller who has nothing to do with a space
 * is told it does not exist rather than that they may not have it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

let owner: Session;
let stranger: Session;

const makeSpace = async (session: Session, body: Record<string, unknown>): Promise<string> => {
  const made = await session.client.post('/v1/spaces').send(body).expect(201);
  return made.body.id;
};

const listed = async (session: Session, query = ''): Promise<string[]> => {
  const page = await session.client.get(`/v1/spaces${query}`).expect(200);
  return page.body.items.map((space: { id: string }) => space.id);
};

beforeAll(async () => {
  owner = await createAccount('spaces-owner');
  stranger = await createAccount('spaces-stranger');
});

describe('making a space', () => {
  it('needs a kind and a name, and fills the rest in', async () => {
    const made = await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'The tent' }).expect(201);

    expect(made.body).toMatchObject({
      ownerId: owner.userId,
      kind: 'tent',
      name: 'The tent',
      roomId: null,
      presetPrompt: 'ask',
      retention: { climateDays: null },
      archivedAt: null,
    });
  });

  it('makes the room a place names, groups the next place under it, and ends the room with its last place', async () => {
    const first = (await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'Tent in it', roomName: 'The flower room' }).expect(201)).body;
    const second = (await owner.client.post('/v1/spaces').send({ kind: 'fridge', name: 'Fridge in it', roomName: 'the flower room' }).expect(201))
      .body;

    expect(first.roomId).toEqual(expect.any(String));
    expect(second.roomId).toBe(first.roomId);
    expect((await owner.client.get(`/v1/spaces/${first.roomId}`).expect(200)).body).toMatchObject({ kind: 'room', name: 'The flower room' });
    expect(await listed(owner, `?roomId=${first.roomId}`)).toEqual([first.id, second.id]);

    await owner.client.patch(`/v1/spaces/${first.id}`).send({ roomId: null }).expect(200);
    expect((await owner.client.get(`/v1/spaces/${first.roomId}`).expect(200)).body.archivedAt).toBeNull();
    await owner.client.delete(`/v1/spaces/${second.id}`).expect(204);
    expect((await owner.client.get(`/v1/spaces/${first.roomId}`).expect(200)).body.archivedAt).toEqual(expect.any(String));
  });

  it('refuses a room made, ended or put away by itself', async () => {
    const made = (await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'Tent in a kept room', roomName: 'A kept room' }).expect(201))
      .body;

    expect((await owner.client.post('/v1/spaces').send({ kind: 'room', name: 'By itself' }).expect(409)).body.code).toBe('room_by_itself');
    expect((await owner.client.delete(`/v1/spaces/${made.roomId}`).expect(409)).body.code).toBe('room_by_itself');
    expect((await owner.client.put(`/v1/spaces/${made.roomId}/archive`).expect(409)).body.code).toBe('room_by_itself');
    expect((await owner.client.patch(`/v1/spaces/${made.id}`).send({ kind: 'room' }).expect(409)).body.code).toBe('room_by_itself');
  });

  it('refuses a second place of one name with a sentence that names it', async () => {
    await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'Named once' }).expect(201);
    const refused = await owner.client.post('/v1/spaces').send({ kind: 'fridge', name: ' named ONCE ' }).expect(409);

    expect(refused.body).toMatchObject({ code: 'name_taken', detail: 'Another place is already called "Named once".' });
    // Somebody else may call theirs the same.
    await stranger.client.post('/v1/spaces').send({ kind: 'tent', name: 'Named once' }).expect(201);
  });

  it('refuses a kind the contract does not have, and says which field', async () => {
    const refused = await owner.client.post('/v1/spaces').send({ kind: 'shed', name: 'The shed' }).expect(400);

    expect(refused.body.code).toBe('validation_failed');
    expect(refused.body.errors.map((error: { field: string }) => error.field)).toContain('kind');
  });

  it('refuses a room inside somebody else´s room as if it were not there', async () => {
    const { roomId } = (await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'In a room of mine', roomName: 'Not yours' }).expect(201))
      .body;
    const refused = await stranger.client.post('/v1/spaces').send({ kind: 'tent', name: 'Mine', roomId }).expect(404);

    expect(refused.body.code).toBe('space_not_found');
  });
});

describe('one space', () => {
  it('is renamed by its owner and read back', async () => {
    const id = await makeSpace(owner, { kind: 'fridge', name: 'The fridge' });
    await owner.client.patch(`/v1/spaces/${id}`).send({ name: 'The drying fridge' }).expect(200);

    expect((await owner.client.get(`/v1/spaces/${id}`).expect(200)).body.name).toBe('The drying fridge');
  });

  it('is not there at all for somebody else', async () => {
    const id = await makeSpace(owner, { kind: 'balcony', name: 'The balcony' });

    await stranger.client.get(`/v1/spaces/${id}`).expect(404);
    await stranger.client.patch(`/v1/spaces/${id}`).send({ name: 'Mine now' }).expect(404);
    await stranger.client.delete(`/v1/spaces/${id}`).expect(404);
  });

  it('leaves the list when it is archived and comes back when it is not', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The spare tent' });

    await owner.client.put(`/v1/spaces/${id}/archive`).expect(200);
    expect(await listed(owner)).not.toContain(id);
    expect(await listed(owner, '?archived=true')).toContain(id);

    await owner.client.delete(`/v1/spaces/${id}/archive`).expect(200);
    expect(await listed(owner)).toContain(id);
  });
});

describe('what stands in a space', () => {
  it('takes a device in and lets it go again', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The new tent' });
    const device = await provisionDevice(owner);

    const placed = await owner.client.put(`/v1/spaces/${id}/devices/${device.deviceId}`).expect(200);
    expect(placed.body.spaceId).toBe(id);

    await owner.client.delete(`/v1/spaces/${id}/devices/${device.deviceId}`).expect(204);
    expect((await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId).toBeNull();
  });

  it('refuses to end a space while a device stands there, and says what does', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The occupied tent' });
    const device = await provisionDevice(owner);
    await owner.client.put(`/v1/spaces/${id}/devices/${device.deviceId}`).expect(200);

    const refused = await owner.client.delete(`/v1/spaces/${id}`).expect(409);
    expect(refused.body.code).toBe('space_in_use');
    expect(refused.body.errors.map((error: { code: string }) => error.code)).toEqual(['device_here']);

    await owner.client.delete(`/v1/spaces/${id}/devices/${device.deviceId}`).expect(204);
    await owner.client.delete(`/v1/spaces/${id}`).expect(204);
  });

  /**
   * Guests do not block the removal: the app names them before it asks, and
   * the write that ends the place ends every way into it, as a room's end does.
   */
  it('ends a place with its guests´ memberships, its invites and its share links, and its room with it where it was the last', async () => {
    const tent = (await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'The shared tent', roomName: 'The shared room' }).expect(201))
      .body;
    const inTheRoom = await createAccount('spaces-room-guest');
    await joinSpace(owner, tent.id, stranger);
    await joinSpace(owner, tent.roomId, inTheRoom, 'can_manage');
    const invite = (await owner.client.post(`/v1/spaces/${tent.id}/invites`).send({ role: 'can_log' }).expect(201)).body;
    const link = (
      await owner.client
        .post('/v1/share-links')
        .send({ kind: 'view', subject: { type: 'space', id: tent.id } })
        .expect(201)
    ).body;

    await owner.client.delete(`/v1/spaces/${tent.id}`).expect(204);

    await stranger.client.get(`/v1/spaces/${tent.id}`).expect(404);
    expect((await owner.client.get(`/v1/spaces/${tent.id}/members`).expect(200)).body.items).toEqual([]);
    expect((await owner.client.get(`/v1/spaces/${tent.id}/invites`).expect(200)).body.items).toEqual([]);
    expect((await anonymous().get(`/v1/invites/${invite.code}`).expect(200)).body.isValid).toBe(false);
    await anonymous().get(`/v1/shared/${link.token}`).expect(404);
    // It was the room's last place: the room has ended, and whoever was let into the room is let into nothing.
    expect((await owner.client.get(`/v1/spaces/${tent.roomId}`).expect(200)).body.archivedAt).toEqual(expect.any(String));
    await inTheRoom.client.get(`/v1/spaces/${tent.roomId}`).expect(404);
    await inTheRoom.client.get(`/v1/spaces/${tent.id}`).expect(404);
  });

  /**
   * A room exists only while a place stands in it. Once it has ended it is a
   * tombstone: its owner is refused a new name for it, a place in it and
   * anybody let into it, each with the rule in a sentence.
   */
  it('refuses an ended room a name, a place, an invite, a member and a share link', async () => {
    const tent = (await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'Tent of a short room', roomName: 'A short room' }).expect(201))
      .body;
    const room = tent.roomId;
    await owner.client.patch(`/v1/spaces/${tent.id}`).send({ roomId: null }).expect(200);
    const ended = {
      status: 409,
      code: 'room_ended',
      detail: 'A room exists only while a place stands in it, and this one ended with its last place.',
    };

    expect((await owner.client.patch(`/v1/spaces/${room}`).send({ name: 'A long room' }).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.patch(`/v1/spaces/${tent.id}`).send({ roomId: room }).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'Late tent', roomId: room }).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.post(`/v1/spaces/${room}/invites`).send({ role: 'can_log' }).expect(409)).body).toMatchObject(ended);
    const link = { kind: 'view', subject: { type: 'space', id: room } };
    expect((await owner.client.post('/v1/share-links').send(link).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.post(`/v1/spaces/${room}/members`).send({ handle: stranger.handle, role: 'can_log' }).expect(409)).body).toMatchObject(
      ended,
    );

    // A code cut for it before answers as every dead code does: the route is anybody's, and says no more than that.
    const code = `ZZ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await seedRow('invites', {
      id: `invite-${code}`,
      createdAt: new Date(),
      code,
      spaceId: room,
      role: 'can_log',
      createdBy: owner.userId,
      expiresAt: null,
      revokedAt: null,
      state: { useCount: 0, lastUsedAt: null },
    });
    expect((await stranger.client.post(`/v1/invites/${code}/acceptances`).expect(404)).body.code).toBe('invite_not_found');
    await stranger.client.get(`/v1/spaces/${room}`).expect(404);

    // The name is free again: naming it on a place makes a room anew.
    const again = (await owner.client.patch(`/v1/spaces/${tent.id}`).send({ roomName: 'A short room' }).expect(200)).body;
    expect(again.roomId).not.toBe(room);
  });

  /**
   * An ended place is on no screen, as an ended room is: whoever was let into
   * it now could not be seen or sent away again, so its owner is refused each
   * way in - whether the place was removed or put away.
   */
  it.each([
    ['removed', (id: string) => owner.client.delete(`/v1/spaces/${id}`).expect(204)],
    ['put away', (id: string) => owner.client.put(`/v1/spaces/${id}/archive`).expect(200)],
  ])('refuses a place that was %s an invite, a member, a share link, a reminder, a grow and a new name', async (how, end) => {
    const id = await makeSpace(owner, { kind: 'tent', name: `A tent that was ${how}` });
    const beside = await makeSpace(owner, { kind: 'tent', name: `The tent beside the one that was ${how}` });
    const grow = { name: `Grown where a tent was ${how}`, type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 1 }] };
    const reminder = { kind: 'water', label: 'Water it', everyDays: 3, onceAt: null };
    // While it stands the place takes each of them, so the refusals below are the ended place's.
    const kept = (
      await owner.client
        .post('/v1/reminders')
        .send({ ...reminder, subject: { type: 'space', id } })
        .expect(201)
    ).body.id;
    await owner.client.delete(`/v1/reminders/${kept}`).expect(204);
    const standing = (
      await owner.client
        .post('/v1/grows')
        .send({ ...grow, spaceId: beside })
        .expect(201)
    ).body.id;
    const plantIds = [(await owner.client.get(`/v1/grows/${standing}/plants`).expect(200)).body.items[0].id];
    await owner.client
      .patch(`/v1/spaces/${id}`)
      .send({ name: `A tent that will be ${how}` })
      .expect(200);
    await end(id);
    const ended = { status: 409, code: 'space_archived', detail: 'That place has ended, and nothing is put into an ended place.' };

    expect(
      (
        await owner.client
          .post('/v1/reminders')
          .send({ ...reminder, subject: { type: 'space', id } })
          .expect(409)
      ).body,
    ).toMatchObject(ended);
    expect(
      (
        await owner.client
          .post('/v1/grows')
          .send({ ...grow, spaceId: id })
          .expect(409)
      ).body,
    ).toMatchObject(ended);
    expect((await owner.client.post(`/v1/grows/${standing}/placements`).send({ spaceId: id }).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.post(`/v1/grows/${standing}/splits`).send({ plantIds, spaceId: id }).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.patch(`/v1/spaces/${id}`).send({ name: 'Named too late' }).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.patch(`/v1/spaces/${id}`).send({ kind: 'fridge' }).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.get(`/v1/grows/${standing}`).expect(200)).body.placements).toMatchObject([{ spaceId: beside, endedAt: null }]);

    expect((await owner.client.post(`/v1/spaces/${id}/invites`).send({ role: 'can_log' }).expect(409)).body).toMatchObject(ended);
    expect((await owner.client.post(`/v1/spaces/${id}/members`).send({ handle: stranger.handle, role: 'can_log' }).expect(409)).body).toMatchObject(
      ended,
    );
    const link = { kind: 'view', subject: { type: 'space', id } };
    expect((await owner.client.post('/v1/share-links').send(link).expect(409)).body).toMatchObject(ended);
    await stranger.client.get(`/v1/spaces/${id}`).expect(404);
  });

  /**
   * What is the owner's stays the owner's: a guest who may manage a place
   * steers what stands in it and renames it, but does not take a device out of
   * every place - it would be on no screen but its owner's - and does not say
   * which room the place stands in, which is who is let into it.
   */
  it('leaves taking a device out and the room of a place to the owner, whoever may manage the place', async () => {
    const tent = (await owner.client.post('/v1/spaces').send({ kind: 'tent', name: 'The managed tent', roomName: 'The managed room' }).expect(201))
      .body;
    const device = await provisionDevice(owner);
    await owner.client.put(`/v1/spaces/${tent.id}/devices/${device.deviceId}`).expect(200);
    const manager = await createAccount('spaces-manager');
    await joinSpace(owner, tent.id, manager, 'can_manage');

    const refusedOut = await manager.client.delete(`/v1/spaces/${tent.id}/devices/${device.deviceId}`).expect(403);
    expect(refusedOut.body.code).toBe('insufficient_access');
    expect((await manager.client.patch(`/v1/devices/${device.deviceId}`).send({ spaceId: null }).expect(403)).body.code).toBe('insufficient_access');
    for (const body of [{ roomId: null }, { roomName: 'Another room' }]) {
      expect((await manager.client.patch(`/v1/spaces/${tent.id}`).send(body).expect(403)).body.code).toBe('insufficient_access');
    }
    expect((await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId).toBe(tent.id);
    expect((await owner.client.get(`/v1/spaces/${tent.id}`).expect(200)).body.roomId).toBe(tent.roomId);
    // Putting the place away writes what a removal writes, and bringing it back undoes one: neither is a manager's.
    expect((await manager.client.put(`/v1/spaces/${tent.id}/archive`).expect(403)).body.code).toBe('insufficient_access');
    expect((await owner.client.get(`/v1/spaces/${tent.id}`).expect(200)).body.archivedAt).toBeNull();
    await setRow('spaces', { id: tent.id }, { archivedAt: new Date() });
    expect((await manager.client.delete(`/v1/spaces/${tent.id}/archive`).expect(403)).body.code).toBe('insufficient_access');
    expect((await owner.client.delete(`/v1/spaces/${tent.id}/archive`).expect(200)).body.archivedAt).toBeNull();
    // Its name and kind are still the manager's to change.
    await manager.client.patch(`/v1/spaces/${tent.id}`).send({ name: 'The well managed tent', kind: 'fridge' }).expect(200);

    // A stranger is told of neither, as before.
    await stranger.client.delete(`/v1/spaces/${tent.id}/devices/${device.deviceId}`).expect(404);
    await stranger.client.patch(`/v1/devices/${device.deviceId}`).send({ spaceId: null }).expect(404);
    await stranger.client.patch(`/v1/spaces/${tent.id}`).send({ roomId: null }).expect(404);

    await owner.client.patch(`/v1/spaces/${tent.id}`).send({ roomName: 'Another room' }).expect(200);
    await owner.client.patch(`/v1/spaces/${tent.id}`).send({ roomId: null }).expect(200);
    await owner.client.delete(`/v1/spaces/${tent.id}/devices/${device.deviceId}`).expect(204);
    expect((await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId).toBeNull();
  });

  it('keeps an ended space readable, because history still names it', async () => {
    const id = await makeSpace(owner, { kind: 'tent', name: 'The ended tent' });
    await owner.client.delete(`/v1/spaces/${id}`).expect(204);

    expect(await listed(owner)).not.toContain(id);
    expect((await owner.client.get(`/v1/spaces/${id}`).expect(200)).body.archivedAt).toEqual(expect.any(String));
  });
});

/**
 * The phase tiles over HTTP: the tent is put on the stage's climate, the grow
 * standing in it enters the stage, and where there is no grow the answer asks
 * what to do about that rather than inventing one.
 */
describe('applying a climate preset', () => {
  /** A tent with a controller in it that has said what it is running, which is what a preset is merged into. */
  /** The deficit of one sample, as every VPD goes out. */
  const deficit = (air: number, leaf: number, humidity: number): number => parseFloat(vapourPressureDeficit(air, leaf, humidity).toFixed(2));

  const tentWithAController = async (): Promise<string> => {
    const device = await provisionDevice(owner, 'controller');
    const spaceId = (await owner.client.get(`/v1/devices/${device.deviceId}`).expect(200)).body.spaceId as string;

    await owner.client
      .put(`/v1/devices/${device.deviceId}/configuration`)
      .send({
        configuration: {
          daynight: { day: 21600, night: 64800 },
          day: { temperature: 25, humidity: 60 },
          night: { temperature: 21, humidity: 55 },
          lights: { sunrise: 15, sunset: 15, limit: 100 },
        },
      })
      .expect(200);

    return spaceId;
  };

  it('writes the stage´s climate to the controller and asks what to do about the grow', async () => {
    const spaceId = await tentWithAController();

    const applied = await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'vegetative' }).expect(201);

    expect(applied.body).toMatchObject({ spaceId, stage: 'vegetative', preset: null, growId: null, growDecisionNeeded: true, planEffect: 'none' });
    expect(applied.body.decisions).toEqual(['start_grow', 'move_grow', 'climate_only']);
    expect(applied.body.deviceIds).toHaveLength(1);

    const read = await owner.client.get(`/v1/devices/${applied.body.deviceIds[0]}/configuration`).expect(200);
    // The targets of the stage, and the ramps the tent was tuned with left alone.
    expect(read.body.configuration).toMatchObject({
      day: { temperature: 26, humidity: 62 },
      night: { temperature: 22, humidity: 58 },
      lights: { sunrise: 15, sunset: 15, limit: 80 },
    });
  });

  it('puts the grow standing there into the stage and tags the phase as the preset´s', async () => {
    const spaceId = await tentWithAController();
    const grow = (
      await owner.client
        .post('/v1/grows')
        .send({ name: 'Preset run', type: 'photoperiod', plants: [{ strain: 'Amnesia', count: 1 }], spaceId })
        .expect(201)
    ).body;

    const applied = await owner.client
      .post(`/v1/spaces/${spaceId}/preset-applications`)
      .send({ stage: 'flowering', preset: 'late_flowering' })
      .expect(201);

    expect(applied.body).toMatchObject({ growId: grow.id, growDecisionNeeded: false, decisions: [] });
    expect(applied.body.phaseId).toEqual(expect.any(String));

    const read = await owner.client.get(`/v1/grows/${grow.id}`).expect(200);
    expect(read.body.summary).toMatchObject({ stage: 'flowering', preset: 'late_flowering', isAuto: true });
    expect(read.body.phases[0]).toMatchObject({ source: 'preset', setBy: null });
    expect(read.body.phases[0].targets).toMatchObject({ day: { temperature: 24 } });
  });

  it('bands the Timeline by the climate the tent was put on from the moment it was put on it', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    const startedAt = new Date(Date.now() - 2 * DAY_MS).toISOString();
    const grow = (
      await owner.client
        .post('/v1/grows')
        .send({ name: 'Veg run', type: 'photoperiod', plants: [{ strain: 'Gelato', count: 1 }], spaceId, startedAt })
        .expect(201)
    ).body;
    await owner.client.post(`/v1/grows/${grow.id}/phases`).send({ stage: 'vegetative', startedAt }).expect(201);
    await seedMeasurements(
      Array.from({ length: 48 }, (_, index) => ({ time: Date.now() - index * 30 * 60_000, device_id: deviceId, fields: { temperature: 25 } })),
    );

    // The grow is in veg already, so no phase is written: only the controller
    // moves, and the phase keeps the 25 °C it took down when it began.
    const applied = await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'vegetative' }).expect(201);
    expect((await owner.client.get(`/v1/grows/${grow.id}`).expect(200)).body.phases.map((one: { stage: string }) => one.stage)).toEqual([
      'vegetative',
    ]);

    const timeline = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h`).expect(200)).body;
    const bands = timeline.panels.find((panel: { metric: string }) => panel.metric === 'temperature').targets;

    expect(bands.map((band: { day: { setpoint: number } }) => band.day.setpoint)).toEqual([25, 26]);
    expect(Date.parse(bands[1].startsAt)).toBeGreaterThanOrEqual(Date.parse(applied.body.appliedAt));
    expect(bands[1].endsAt).toBe(timeline.endsAt);
  });

  // A door open for forty seconds: at three minutes to the point the mean hardly moves, so the answer says the
  // lowest and the highest sample of each window beside it - and zoomed in, every sample is a point of its own.
  it('reads the Timeline with each window´s lowest and highest, and a window named outright at every sample', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    const door = Math.floor((Date.now() - 6 * 3600_000) / 180_000) * 180_000 + 60_000;
    await seedMeasurements(
      Array.from({ length: 240 }, (_, index) => {
        // Two seconds past each fifth, as a device's clock is never on the grid.
        const time = door - 600_000 + index * 5000 + 2000;
        const open = time >= door && time < door + 40_000;
        return {
          time,
          device_id: deviceId,
          fields: { temperature: open ? 19.4 : 21, humidity: open ? 71.5 : 55, out_dehumidifier: time >= door + 30_000 ? 1 : 0 },
        };
      }),
    );

    const day = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h&metrics=temperature&metrics=humidity&metrics=vpd`).expect(200))
      .body;
    const spiked = (metric: string) =>
      day.panels.find((panel: { metric: string }) => panel.metric === metric).points.find((point: { max?: number }) => point.max !== undefined);
    expect(day.stepSeconds).toBe(180);
    expect(spiked('humidity')).toMatchObject({ min: 55, max: 71.5 });
    expect(spiked('temperature')).toMatchObject({ min: 19.4, max: 21 });
    expect(spiked('humidity').value).toBeLessThan(60);
    // The deficit the door let in is the deficit of the samples it was open in, cold and damp together.
    expect(spiked('vpd')).toMatchObject({ min: deficit(19.4, 19.4, 71.5), max: deficit(21, 21, 55) });

    const from = new Date(door - 600_000).toISOString();
    const to = new Date(door + 600_000).toISOString();
    const zoom = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h&from=${from}&to=${to}&metrics=humidity`).expect(200)).body;
    expect(zoom).toMatchObject({ startsAt: from, endsAt: to, stepSeconds: 5 });
    const points = zoom.panels[0].points.filter((point: { value: number | null }) => point.value !== null);
    expect(points.filter((point: { value: number }) => point.value === 71.5)).toHaveLength(8);
    // One sample to the window: it is its own lowest and highest, and says neither.
    expect(points.every((point: { min?: number }) => point.min === undefined)).toBe(true);
    // The dehumidifier came on thirty seconds into it, and the lane says so to the grain of the step.
    const lane = zoom.outputs.find((one: { output: string }) => one.output === 'dehumidifier');
    expect(Date.parse(lane.spans[0].startsAt)).toBe(door + 30_000);

    await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h&from=${to}&to=${from}`).expect(400);
  });

  // What is said about an output is counted from its samples. Taken from its runs - each rounded out to the grain
  // it was found at - a valve that opens for five seconds every two minutes was open three quarters of a day,
  // and a heater that ran one minute of three at 80 % was written as 80 % for the three.
  it('counts an output from its samples, point by drawn point: a pulse, a run shorter than a step, a silence', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    const MINUTE = 60_000;
    const base = Math.floor((Date.now() - 6 * 3600_000) / 180_000) * 180_000;
    const within = (time: number, from: number, to: number) => time >= base + from * MINUTE && time < base + to * MINUTE;
    await seedMeasurements(
      Array.from({ length: 120 * 12 }, (_, index) => ({ index, time: base + index * 5000 + 2000 }))
        // Its first reading a minute into a window; half an hour of silence, and back a minute into another.
        .filter(({ time }) => !within(time, 0, 1) && !within(time, 60, 91))
        .map(({ index, time }) => ({
          time,
          device_id: deviceId,
          fields: {
            temperature: 24,
            humidity: 55,
            out_light: 70,
            out_heater: within(time, 10, 11) ? 0.8 : 0,
            out_dehumidifier: within(time, 20, 21) ? 1 : 0,
            // Five seconds every two minutes.
            out_co2: index % 24 === 0 ? 3 : 0,
          },
        })),
    );

    const day = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h&metrics=temperature`).expect(200)).body;
    type Point = { measuredAt: string; heard: number; on: number; level: number | null };
    const lane = (output: string): { points: Point[] } => day.outputs.find((one: { output: string }) => one.output === output);
    const at = (output: string, minute: number) => lane(output).points.find(point => Date.parse(point.measuredAt) === base + minute * MINUTE);

    expect(day.stepSeconds).toBe(180);
    // One minute of three at 80 %: twelve samples of thirty-six, and 26.7 % of full output over the point.
    expect(at('heater', 12)).toEqual({ measuredAt: new Date(base + 12 * MINUTE).toISOString(), heard: 36, on: 12, level: 26.7 });
    expect(at('heater', 15)).toMatchObject({ heard: 36, on: 0, level: 0 });
    // A switch has no level: the samples it ran in say all there is.
    expect(at('dehumidifier', 21)).toMatchObject({ heard: 36, on: 12, level: null });
    expect(at('light', 12)).toMatchObject({ heard: 36, on: 36, level: 70 });
    // The valve ran in one sample of twenty-four, whatever a point is wide.
    const valve = lane('co2').points;
    expect(valve.every(point => point.on >= 1 && point.on <= 2 && point.level === null)).toBe(true);
    const sum = (of: (point: Point) => number) => valve.reduce((total, point) => total + of(point), 0);
    expect(sum(point => point.on) / sum(point => point.heard)).toBeCloseTo(1 / 24, 2);

    // The first reading stands a minute into its window, and nothing is said of the time before it.
    expect(lane('heater').points[0]).toMatchObject({ measuredAt: new Date(base + 3 * MINUTE).toISOString(), heard: 24, on: 0 });
    // Nothing was heard for half an hour: no point says "off" there. The first after it has the samples it has.
    const heard = lane('heater').points.map(point => (Date.parse(point.measuredAt) - base) / MINUTE);
    expect(heard.filter(minute => minute > 60 && minute <= 90)).toEqual([]);
    expect(at('heater', 60)).toMatchObject({ heard: 36 });
    expect(at('heater', 93)).toMatchObject({ heard: 24, on: 0, level: 0 });
    expect(at('light', 93)).toMatchObject({ heard: 24, on: 24, level: 70 });
    // What a run was rounded out to and what the device was heard for are no figures of the answer any more.
    expect(Object.keys(lane('heater')).sort()).toEqual(['deviceId', 'heardUntil', 'output', 'points', 'spans']);
  });

  // The warmest sample of a window need not be its driest, nor the one with the warmest leaf. Read at three minutes
  // to the point, a tent between 20.7 and 31.5 °C, 38 and 58.8 % and a leaf of 18.9 to 21.5 °C was answered a
  // deficit of -0.53 to 1.64 kPa, built from extremes that never met; no sample of it was below 0.4 or above 1.1.
  it('answers the lowest and the highest deficit that occurred, not one built from extremes that never met', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    const window = Math.floor((Date.now() - 6 * 3600_000) / 180_000) * 180_000;
    const warm = { temperature: 31.5, humidity: 38, leaf_temperature: 21.5 };
    const cold = { temperature: 20.7, humidity: 58.8, leaf_temperature: 18.9 };
    await seedMeasurements(
      Array.from({ length: 36 }, (_, index) => ({ time: window + index * 5000 + 2000, device_id: deviceId, fields: index % 2 ? warm : cold })),
    );

    const day = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h&metrics=vpd`).expect(200)).body;
    const point = day.panels[0].points.find((one: { value: number | null }) => one.value !== null);

    expect(day.stepSeconds).toBe(180);
    expect(point).toMatchObject({ min: deficit(20.7, 18.9, 58.8), max: deficit(31.5, 21.5, 38) });
    expect(point.min).toBeGreaterThan(0.7);
    expect(point.max).toBeLessThan(0.9);

    // A week is too many samples to read one by one: its deficit is worked out from means over five minutes -
    // here one grain of both kinds of sample, whose own deficit is all the window has - and never from extremes.
    const week = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=7d&metrics=vpd&metrics=temperature`).expect(200)).body;
    const points = (metric: string) =>
      week.panels.find((panel: { metric: string }) => panel.metric === metric).points.filter((one: { value: number | null }) => one.value !== null);
    const grain = deficit((31.5 + 20.7) / 2, (21.5 + 18.9) / 2, (38 + 58.8) / 2);
    expect(points('vpd')[0]).toEqual({ measuredAt: points('vpd')[0].measuredAt, value: grain });
    expect(points('temperature')[0]).toMatchObject({ min: 20.7, max: 31.5 });
  });

  // A grain is judged day or night as a whole, and the one the lamp switched in is neither: lit in six samples
  // of ten it took the day's leaf offset for the air of all ten - a week's lowest deficit read 0.80 kPa where no
  // sample of it was below 0.90.
  it('works a grain the lamp switched in out as its lit and its dark part, each from its own readings', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    // Two days back, on a grain's edge: the lamp comes on two minutes into the grain that follows it.
    const edge = Math.floor((Date.now() - 2 * 86_400_000) / 300_000) * 300_000;
    const dark = { temperature: 21, humidity: 55, out_light: 0 };
    const lit = { temperature: 26, humidity: 60, out_light: 100 };
    await seedMeasurements(
      Array.from({ length: 60 }, (_, index) => {
        const time = edge - 600_000 + index * 30_000 + 2000;
        return { time, device_id: deviceId, fields: time < edge + 120_000 ? dark : lit };
      }),
    );

    const week = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=7d&stepSeconds=300&metrics=vpd`).expect(200)).body;
    const points: { measuredAt: string; value: number | null }[] = week.panels[0].points;
    const at = (stamp: number) => points.find(point => Date.parse(point.measuredAt) === stamp)?.value;
    const [byDay, byNight] = [deficit(26, 24, 60), deficit(21, 21, 55)];

    expect(week.stepSeconds).toBe(300);
    expect(at(edge)).toBe(byNight);
    // Four dark samples and six lit ones, each worked out by itself: not the day's offset over the mean of all ten.
    expect(at(edge + 300_000)).toBe(parseFloat(((4 * byNight + 6 * byDay) / 10).toFixed(2)));
    expect(at(edge + 300_000)).not.toBe(deficit((4 * 21 + 6 * 26) / 10, (4 * 21 + 6 * 26) / 10 - 2, (4 * 55 + 6 * 60) / 10));
    expect(at(edge + 600_000)).toBe(byDay);
    // Nothing the week says lies outside what its samples held.
    for (const point of points.filter(one => one.value !== null)) {
      expect(point.value).toBeGreaterThanOrEqual(Math.min(byDay, byNight));
      expect(point.value).toBeLessThanOrEqual(Math.max(byDay, byNight));
    }
  });

  // Read at the step, a lamp that ran from 06:02 to 18:02 was lit "06:00 bis 18:03" over a day and "06:00 bis
  // 18:05" over a week; within three days its stretch is its samples', and the night begins where it ends.
  it('names the lamp´s stretch by its samples within three days, the same on every zoom, and begins the night where it ends', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    const base = Math.floor((Date.now() - 10 * 3600_000) / 300_000) * 300_000;
    // A sample every thirty seconds for four hours; lit from the one at 62 minutes and 12 seconds to the last before 182 minutes.
    const [on, off] = [base + 62 * 60_000 + 12_000, base + 182 * 60_000 + 12_000];
    await seedMeasurements(
      Array.from({ length: 480 }, (_, index) => {
        const time = base + index * 30_000 + 12_000;
        return { time, device_id: deviceId, fields: { temperature: 24, humidity: 55, out_light: time >= on && time < off ? 70 : 0 } };
      }),
    );

    const read = async (query: string) => {
      const body = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?${query}&metrics=temperature`).expect(200)).body;
      return {
        step: body.stepSeconds as number,
        lit: body.outputs.find((one: { output: string }) => one.output === 'light').spans as { startsAt: string; endsAt: string }[],
        nights: body.nights as { startsAt: string; endsAt: string }[],
      };
    };
    const day = await read('range=24h');
    const zoomed = await read(`range=24h&from=${new Date(base + 3_600_000).toISOString()}&to=${new Date(base + 4 * 3_600_000).toISOString()}`);
    // The five seconds the first lit sample was written in, and those of the first dark one after it.
    const stretch = [{ startsAt: new Date(on - 2000).toISOString(), endsAt: new Date(off - 2000).toISOString() }];

    expect(day.step).toBe(180);
    expect(day.lit).toEqual(stretch);
    expect(zoomed.lit).toEqual(stretch);
    expect(day.nights.map(night => night.startsAt)).toContain(stretch[0].endsAt);
    expect(day.nights.map(night => night.endsAt)).toContain(stretch[0].startsAt);
  });

  // A window says that something was heard in it, not when: a lamp lit across a silence ended "17:00" at an hour to
  // the point for a last sample at 16:18, and came back at the edge of whatever step it was read at.
  it('ends a stretch at the last sample before a silence and begins the next at the first after it, at every step', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    const base = Math.floor((Date.now() - 12 * 3600_000) / 300_000) * 300_000;
    // Lit throughout, a sample every thirty seconds for eight hours - but for the four between the 78th and the 318th minute.
    const times = Array.from({ length: 960 }, (_, index) => base + index * 30_000 + 12_000).filter(
      time => time < base + 78 * 60_000 || time >= base + 318 * 60_000,
    );
    // The heater is reported only from ten minutes after the device came back: a device is heard when any of its
    // fields reports, and the lamp's edges are its own samples', not the heater's.
    await seedMeasurements(
      times.map(time => ({
        time,
        device_id: deviceId,
        fields: { temperature: 24, humidity: 55, out_light: 70, ...(time >= base + 328 * 60_000 ? { out_heater: 0.4 } : {}) },
      })),
    );
    const [fell, back] = [times.filter(time => time < base + 78 * 60_000).at(-1)!, times.find(time => time >= base + 318 * 60_000)!];

    const lit = async (range: string) => {
      const body = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=${range}&metrics=temperature`).expect(200)).body;
      return (body.outputs.find((one: { output: string }) => one.output === 'light').spans as { startsAt: string; endsAt: string }[]).map(span => [
        Date.parse(span.startsAt),
        Date.parse(span.endsAt),
      ]);
    };
    const stretches = [
      [times[0], fell],
      [back, times.at(-1)!],
    ];

    expect(await lit('24h')).toEqual(stretches);
    expect(await lit('7d')).toEqual(stretches);
    // The heater's own lane begins where the heater was first heard, to the window of its first point.
    const heater = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h&metrics=temperature`).expect(200)).body.outputs.find(
      (one: { output: string }) => one.output === 'heater',
    );
    expect(Date.parse(heater.spans[0].startsAt)).toBeGreaterThan(base + 325 * 60_000);
    expect(Date.parse(heater.spans[0].startsAt)).toBeLessThan(base + 329 * 60_000);
  });

  // Read over a grow, a point is hours wide and no multiple of a day, so a window held a different share of
  // day and night every time. Worked out from the window's own means with one leaf offset, the same climate
  // read 0.92 to 1.2 kPa in one month and 1.0 to 1.1 in another - a bow-tie no tent ever drew.
  it('reads the same deficit in August and in November from a climate that is the same every day', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    const day = { temperature: 26, humidity: 60, out_light: 100 };
    const night = { temperature: 21, humidity: 55, out_light: 0 };
    const DAY = 86_400_000;
    // Four days of each month, a reading a minute, the lamp on from 06:00 to 18:00 UTC.
    const august = Math.floor((Date.now() - 100 * DAY) / DAY) * DAY;
    const november = Math.floor((Date.now() - 10 * DAY) / DAY) * DAY;
    const lit = (time: number) => time % DAY >= 6 * 3_600_000 && time % DAY < 18 * 3_600_000;
    await seedMeasurements(
      [august, november].flatMap(from =>
        Array.from({ length: 4 * 1440 }, (_, minute) => {
          const time = from + minute * 60_000 + 2000;
          return { time, device_id: deviceId, fields: lit(time) ? day : night };
        }),
      ),
    );

    // The same four days, asked from different minutes of the hour so their windows fall differently on the day.
    const read = async (from: number, shift: number) => {
      const asked = `from=${new Date(from + shift).toISOString()}&to=${new Date(from + 4 * DAY).toISOString()}`;
      const body = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h&${asked}&metrics=vpd`).expect(200)).body;
      const points = body.panels[0].points.filter((one: { value: number | null }) => one.value !== null);
      return {
        step: body.stepSeconds as number,
        low: Math.min(...points.map((one: { value: number; min?: number }) => one.min ?? one.value)),
        high: Math.max(...points.map((one: { value: number; max?: number }) => one.max ?? one.value)),
        values: points.map((one: { value: number }) => one.value) as number[],
      };
    };
    const [summer, autumn] = [await read(august, 0), await read(november, 17 * 60_000)];

    expect(summer.step).toBeGreaterThan(300);
    // By day the leaf is two degrees under the air, by night it is the air's: two deficits, and nothing outside them.
    const [byDay, byNight] = [deficit(26, 24, 60), deficit(21, 21, 55)];
    expect({ low: summer.low, high: summer.high }).toEqual({ low: Math.min(byDay, byNight), high: Math.max(byDay, byNight) });
    expect({ low: autumn.low, high: autumn.high }).toEqual({ low: summer.low, high: summer.high });
    // Every point is a mean of grains of the one or the other, so it lies between the two - in both months.
    for (const value of [...summer.values, ...autumn.values]) {
      expect(value).toBeGreaterThanOrEqual(summer.low);
      expect(value).toBeLessThanOrEqual(summer.high);
    }
  });

  // A window named from forty seconds into a step begins with a window cut short. Judged over the whole step it
  // was "mostly dark" - nothing is known of the lamp before the window - and by day its deficit took the night's
  // leaf offset: a first point a third too high, which the panel then gave as the window's highest.
  it('works out the deficit of a first window cut short like every other, with the leaf offset of the day', async () => {
    const spaceId = await tentWithAController();
    const deviceId = (await owner.client.get('/v1/devices').expect(200)).body.items.find((one: { spaceId: string }) => one.spaceId === spaceId).id;
    const from = Math.floor((Date.now() - 4 * 3600_000) / 15_000) * 15_000 + 10_000;
    await seedMeasurements(
      Array.from({ length: 1440 }, (_, index) => ({
        time: from + index * 5000 + 2000,
        device_id: deviceId,
        fields: { temperature: 26, humidity: 60, out_light: 100 },
      })),
    );

    const asked = `from=${new Date(from).toISOString()}&to=${new Date(from + 2 * 3600_000).toISOString()}`;
    const read = (await owner.client.get(`/v1/spaces/${spaceId}/timeline?range=24h&${asked}&metrics=vpd`).expect(200)).body;
    const values = read.panels[0].points.filter((one: { value: number | null }) => one.value !== null).map((one: { value: number }) => one.value);

    expect(read.stepSeconds).toBe(15);
    expect(values.length).toBeGreaterThan(470);
    // The lamp is on throughout, so the leaf is two degrees under the air throughout: 0.97 kPa, and never the air's own 1.34.
    expect(new Set(values)).toEqual(new Set([deficit(26, 24, 60)]));
  });

  it('refuses a stage the contract does not have', async () => {
    const spaceId = await tentWithAController();
    const refused = await owner.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'harvesting' }).expect(400);

    expect(refused.body.code).toBe('validation_failed');
  });

  it('is not a space a stranger can reach at all', async () => {
    const spaceId = await tentWithAController();
    const refused = await stranger.client.post(`/v1/spaces/${spaceId}/preset-applications`).send({ stage: 'vegetative' }).expect(404);

    expect(refused.body.code).toBe('space_not_found');
  });
});
