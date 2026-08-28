import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { DingArt, Zelt } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import deviceLogModel from '@models/devicelog.model';
import imageModel from '@models/images.model';
import zeltModel from '@models/zelt.model';
import zielStandModel from '@models/zielstand.model';
import { projiziereDinge, PROJIZIERTE_ARTEN } from '@services/ding-adapter';
import { DingFenster } from '@services/ding-adapter/fenster';

let mongo: MongoMemoryServer;

const TAG = 24 * 60 * 60 * 1000;
const TAG_NULL = Date.UTC(2026, 4, 1);
const GEBUNDEN_SEIT = TAG_NULL + 10 * TAG;
const JETZT = TAG_NULL + 30 * TAG;

// Three sockets, two of them sharing the heater role, and the third from a
// pairing old enough to have no hardware id.
const SOCKET_TABELLE = {
  sockets: 'heater,light',
  sockets_n: '3',
  socket_list0: 'heater|AA:BB:CC:DD:EE:01|192.168.0.5,light|AA:BB:CC:DD:EE:02|192.168.0.6,heater||192.168.0.7',
};

const zelt: Zelt = {
  zelt_id: 'zelt-mit-geraet',
  besitzer_id: 'user-1',
  name: 'Keller',
  geraete: [
    { geraet_id: 'controller-1', seit: GEBUNDEN_SEIT },
    // A device that was in the tent and left again: its rows stay, clipped.
    { geraet_id: 'alt-1', seit: TAG_NULL + 2 * TAG, bis: TAG_NULL + 6 * TAG },
  ],
  zeitzone: 'Europe/Berlin',
  tag_null: TAG_NULL,
  erstellt_at: TAG_NULL,
};

const fenster: DingFenster = { zelt: zelt, von: TAG_NULL, bis: JETZT };

const geraet = (device_id: string, hardwareInfo: Record<string, string>, name = '') =>
  deviceModel.create({ device_id: device_id, username: device_id, password: 'x', name: name, device_type: 'controller', hardwareInfo: hardwareInfo });

const bild = (
  image_id: string,
  t: number,
  format: 'jpeg' | 'user/jpeg' | 'mp4',
  keyed: { zelt_id?: string; device_id?: string },
  timestampEnd?: number,
) => imageModel.create({ image_id: image_id, timestamp: t, timestampEnd: timestampEnd, data: Buffer.from('x'), format: format, ...keyed });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    zeltModel.deleteMany({}),
    imageModel.deleteMany({}),
    zielStandModel.deleteMany({}),
    deviceModel.deleteMany({}),
    deviceLogModel.deleteMany({}),
  ]);
  await zeltModel.create(zelt);
});

afterEach(() => jest.restoreAllMocks());

describe('geraet', () => {
  it('projects one Ding per binding, the ended one included, and ends it where the binding ended', async () => {
    await geraet('controller-1', {}, 'Controller');

    const dinge = await projiziereDinge(fenster, ['geraet']);
    expect(dinge.map(ding => [ding.ding_id, ding.t, ding.t_ende])).toEqual([
      [`geraet:controller-1:${GEBUNDEN_SEIT}`, GEBUNDEN_SEIT, null],
      [`geraet:alt-1:${TAG_NULL + 2 * TAG}`, TAG_NULL + 2 * TAG, TAG_NULL + 6 * TAG],
    ]);
    expect(dinge[0].name).toBe('Controller');
    // The device row for the ended binding is gone; the binding still is not.
    expect(dinge[1].name).toBe('');
  });

  it('leaves out a binding that ended before the window opened', async () => {
    await geraet('controller-1', {});

    const dinge = await projiziereDinge({ zelt: zelt, von: TAG_NULL + 20 * TAG, bis: JETZT }, ['geraet']);
    expect(dinge.map(ding => ding.geraet_id)).toEqual(['controller-1']);
  });

  it('gives a binding the same ding_id whether or not the window also holds the other one', async () => {
    // §14.9: the RMA case. One page covers both stretches, the next covers only
    // the later one - and a client keying its list by ding_id must be looking at
    // the same Ding in both, not at one thing under two names.
    const zurueck: Zelt = {
      ...zelt,
      geraete: [
        { geraet_id: 'controller-1', seit: TAG_NULL + 2 * TAG, bis: TAG_NULL + 6 * TAG },
        { geraet_id: 'controller-1', seit: GEBUNDEN_SEIT },
      ],
    };
    await geraet('controller-1', {}, 'Controller');

    const beide = await projiziereDinge({ zelt: zurueck, von: TAG_NULL, bis: JETZT }, ['geraet']);
    const nurZweite = await projiziereDinge({ zelt: zurueck, von: TAG_NULL + 20 * TAG, bis: JETZT }, ['geraet']);

    expect(beide.map(ding => ding.ding_id)).toEqual([`geraet:controller-1:${GEBUNDEN_SEIT}`, `geraet:controller-1:${TAG_NULL + 2 * TAG}`]);
    expect(nurZweite.map(ding => ding.ding_id)).toEqual([`geraet:controller-1:${GEBUNDEN_SEIT}`]);
    expect(new Set(beide.map(ding => ding.ding_id)).size).toBe(2);
  });
});

describe('dose', () => {
  it('gives every socket its own Ding, two of them sharing a role', async () => {
    await geraet('controller-1', SOCKET_TABELLE);

    const dinge = await projiziereDinge(fenster, ['dose']);
    expect(dinge).toHaveLength(3);
    expect(dinge.map(ding => ding.name).sort()).toEqual(['heater', 'heater', 'light']);
    expect(dinge.every(ding => ding.geraet_id === 'controller-1')).toBe(true);
  });

  it('identifies a socket by its hardware id, so a new address moves the Ding instead of replacing it', async () => {
    await geraet('controller-1', SOCKET_TABELLE);
    const vorher = await projiziereDinge(fenster, ['dose']);

    await deviceModel.updateOne(
      { device_id: 'controller-1' },
      { $set: { 'hardwareInfo.socket_list0': 'heater|AA:BB:CC:DD:EE:01|192.168.0.99,light|AA:BB:CC:DD:EE:02|192.168.0.6,heater||192.168.0.7' } },
    );
    const nachher = await projiziereDinge(fenster, ['dose']);

    expect(nachher.map(ding => ding.ding_id).sort()).toEqual(vorher.map(ding => ding.ding_id).sort());
    expect(nachher.find(ding => ding.ding_id === 'dose:AA:BB:CC:DD:EE:01')?.d).toMatchObject({ ip: '192.168.0.99' });
  });

  it('falls back to the slot only for a socket that reports no id', async () => {
    await geraet('controller-1', SOCKET_TABELLE);

    const ids = (await projiziereDinge(fenster, ['dose'])).map(ding => ding.ding_id).sort();
    expect(ids).toEqual(['dose:AA:BB:CC:DD:EE:01', 'dose:AA:BB:CC:DD:EE:02', 'dose:controller-1:2']);
  });

  it('projects nothing for a controller that reports no sockets at all', async () => {
    await geraet('controller-1', { fw: '1.2.3' });

    expect(await projiziereDinge(fenster, ['dose'])).toEqual([]);
  });

  it('says nothing about the sockets of a device that has left the tent', async () => {
    await geraet('alt-1', SOCKET_TABELLE);

    expect(await projiziereDinge(fenster, ['dose'])).toEqual([]);
  });
});

describe('kamera', () => {
  it('projects the paired camera with the newest frame as its evidence', async () => {
    await geraet('controller-1', { webcam_did: 'DID12345' });
    await bild('frame-1', GEBUNDEN_SEIT + TAG, 'jpeg', { device_id: 'controller-1' });
    await bild('frame-2', GEBUNDEN_SEIT + 2 * TAG, 'jpeg', { device_id: 'controller-1' });

    const [kamera] = await projiziereDinge(fenster, ['kamera']);
    expect(kamera.ding_id).toBe('kamera:DID12345');
    expect(kamera.auto_bild).toBe('frame-2');
    expect(kamera.d).toEqual({ webcam_did: 'DID12345', letztes_bild_t: GEBUNDEN_SEIT + 2 * TAG });
  });

  it('projects a camera that has not taken a picture yet', async () => {
    await geraet('controller-1', { webcam_did: 'DID12345' });

    const [kamera] = await projiziereDinge(fenster, ['kamera']);
    expect(kamera.auto_bild).toBeUndefined();
  });

  it('projects nothing once the device reports the camera gone', async () => {
    await geraet('controller-1', { webcam_did: 'none' });

    expect(await projiziereDinge(fenster, ['kamera'])).toEqual([]);
  });

  it('refuses a frame the camera took before its device joined this tent', async () => {
    // §14.3 names Image frames an enforcement point: the shop test and the
    // previous owner's grow are both older than the binding, and the evidence
    // frame on the camera tile is a picture the tent shows full-size.
    await geraet('controller-1', { webcam_did: 'DID12345' });
    await bild('vorbesitzer-1', GEBUNDEN_SEIT - TAG, 'jpeg', { device_id: 'controller-1' });

    const [kamera] = await projiziereDinge(fenster, ['kamera']);
    expect(kamera.auto_bild).toBeUndefined();
    expect(kamera.d).toEqual({ webcam_did: 'DID12345', letztes_bild_t: undefined });
  });

  it('still shows the last frame of a camera that took none inside the window', async () => {
    await geraet('controller-1', { webcam_did: 'DID12345' });
    await bild('frame-1', GEBUNDEN_SEIT + TAG, 'jpeg', { device_id: 'controller-1' });

    const [kamera] = await projiziereDinge({ zelt: zelt, von: JETZT - TAG, bis: JETZT }, ['kamera']);
    expect(kamera.auto_bild).toBe('frame-1');
  });
});

describe('bild', () => {
  it('reads both keyings at once and marks where each picture came from', async () => {
    await bild('frame-1', GEBUNDEN_SEIT + TAG, 'jpeg', { device_id: 'controller-1' });
    await bild('foto-1', GEBUNDEN_SEIT + 2 * TAG, 'user/jpeg', { zelt_id: zelt.zelt_id });

    const dinge = await projiziereDinge(fenster, ['bild']);
    expect(dinge.map(ding => [ding.ding_id, ding.d?.quelle])).toEqual([
      ['bild:foto-1', 'hand'],
      ['bild:frame-1', 'geraet'],
    ]);
  });

  it('never carries the picture itself', async () => {
    await bild('foto-1', GEBUNDEN_SEIT + TAG, 'user/jpeg', { zelt_id: zelt.zelt_id });

    expect(JSON.stringify(await projiziereDinge(fenster, ['bild']))).not.toContain('data');
  });

  it('refuses a legacy picture the device took before it was ever in this tent', async () => {
    await bild('vorbesitzer-1', GEBUNDEN_SEIT - TAG, 'jpeg', { device_id: 'controller-1' });
    await bild('frame-1', GEBUNDEN_SEIT + TAG, 'jpeg', { device_id: 'controller-1' });

    expect((await projiziereDinge(fenster, ['bild'])).map(ding => ding.ding_id)).toEqual(['bild:frame-1']);
  });
});

describe('film', () => {
  it('projects a timelapse that runs across the window, not only one that starts inside it', async () => {
    await bild('film-1', TAG_NULL, 'mp4', { zelt_id: zelt.zelt_id }, TAG_NULL + 28 * TAG);

    const [film] = await projiziereDinge({ zelt: zelt, von: TAG_NULL + 20 * TAG, bis: JETZT }, ['film']);
    expect([film.ding_id, film.t, film.t_ende]).toEqual(['film:film-1', TAG_NULL, TAG_NULL + 28 * TAG]);
  });

  it('leaves the pictures to the bild art', async () => {
    await bild('foto-1', GEBUNDEN_SEIT, 'user/jpeg', { zelt_id: zelt.zelt_id });

    expect(await projiziereDinge(fenster, ['film'])).toEqual([]);
  });
});

describe('ereignis', () => {
  const log = (device_id: string, t: number, message: string) =>
    deviceLogModel.create({ device_id: device_id, message: message, severity: 0, time: new Date(t) });

  it('projects the device log, newest first', async () => {
    await log('controller-1', GEBUNDEN_SEIT + TAG, 'message-reboot');
    await log('controller-1', GEBUNDEN_SEIT + 2 * TAG, 'message-co2-low');

    const dinge = await projiziereDinge(fenster, ['ereignis']);
    expect(dinge.map(ding => ding.name)).toEqual(['message-co2-low', 'message-reboot']);
    expect(dinge[0].geraet_id).toBe('controller-1');
  });

  it('clips a second-hand controller to its binding, so no previous owner reaches this diary', async () => {
    await log('controller-1', GEBUNDEN_SEIT - TAG, 'message-vorbesitzer');
    await log('controller-1', GEBUNDEN_SEIT + TAG, 'message-reboot');

    expect((await projiziereDinge(fenster, ['ereignis'])).map(ding => ding.name)).toEqual(['message-reboot']);
  });

  it('leaves a deleted log out', async () => {
    await deviceLogModel.create({
      device_id: 'controller-1',
      message: 'message-reboot',
      severity: 0,
      time: new Date(GEBUNDEN_SEIT + TAG),
      deleted: true,
    });

    expect(await projiziereDinge(fenster, ['ereignis'])).toEqual([]);
  });

  it('does not present what a person wrote in the old diary as something the device said', async () => {
    await deviceLogModel.create({
      device_id: 'controller-1',
      title: 'message-diary-measurement',
      message: 'Blüte, Woche 3',
      severity: 0,
      time: new Date(GEBUNDEN_SEIT + TAG),
      categories: ['diary-measurement'],
      data: { phMeasurement: 6.2, ecMeasurement: 1.4, distanceMeasurement: 45 },
      images: ['foto-1'],
    });

    const [notiz] = await projiziereDinge(fenster, ['ereignis']);
    expect(notiz.art).toBe('notiz');
    // A person typed it, so no hardware is credited with it.
    expect(notiz.geraet_id).toBeUndefined();
    expect(notiz.d).toMatchObject({ text: 'Blüte, Woche 3', aus_log: true, kategorien: ['diary-measurement'] });
    // The numbers that used to vanish: the six legacy fields, mapped onto Messwerte.
    expect(notiz.d?.messwerte).toEqual({ ph: 6.2, ec: 1.4, abstand_cm: 45 });
    expect(notiz.bilder).toEqual(['foto-1']);
  });

  it('leaves a diary entry that carried no measurement without an empty messwerte object', async () => {
    await deviceLogModel.create({
      device_id: 'controller-1',
      title: 'message-diary-plant-log',
      message: 'umgetopft',
      severity: 0,
      time: new Date(GEBUNDEN_SEIT + TAG),
      categories: ['diary-plant-log'],
    });

    const [notiz] = await projiziereDinge(fenster, ['ereignis']);
    expect(notiz.d).not.toHaveProperty('messwerte');
    expect(notiz.d?.text).toBe('umgetopft');
  });

  it('still credits the device with what the device sent, alongside the diary rows', async () => {
    await log('controller-1', GEBUNDEN_SEIT + TAG, 'message-reboot');
    await deviceLogModel.create({
      device_id: 'controller-1',
      title: 'message-diary-measurement',
      message: '',
      severity: 0,
      time: new Date(GEBUNDEN_SEIT + 2 * TAG),
      categories: ['diary-measurement'],
      data: { phMeasurement: 6.2 },
    });

    const dinge = await projiziereDinge(fenster, ['ereignis']);
    expect(dinge.map(ding => [ding.art, ding.geraet_id])).toEqual([
      ['notiz', undefined],
      ['ereignis', 'controller-1'],
    ]);
  });
});

describe('ziel', () => {
  it('projects a device setpoint and a hand target as one series', async () => {
    await zielStandModel.create({
      zelt_id: zelt.zelt_id,
      schluessel: 'hand.ph',
      wert: 6.4,
      gilt_ab: TAG_NULL + TAG,
      gilt_bis: GEBUNDEN_SEIT,
      quelle: 'hand',
    });
    await zielStandModel.create({
      zelt_id: zelt.zelt_id,
      geraet_id: 'controller-1',
      schluessel: 'day.temperature',
      wert: 27,
      gilt_ab: GEBUNDEN_SEIT,
      quelle: 'geraet',
    });

    const dinge = await projiziereDinge(fenster, ['ziel']);
    expect(dinge.map(ding => [ding.name, ding.d?.quelle, ding.t_ende])).toEqual([
      ['day.temperature', 'geraet', null],
      ['hand.ph', 'hand', GEBUNDEN_SEIT],
    ]);
  });

  it('gives two controllers holding the same setpoint two Dinge, not one', async () => {
    // What a migration that binds both devices at once produces: one key, one
    // `gilt_ab`, two devices - and two different numbers.
    for (const [geraet_id, wert] of [
      ['controller-1', 24],
      ['alt-1', 30],
    ] as const) {
      await zielStandModel.create({
        zelt_id: zelt.zelt_id,
        geraet_id: geraet_id,
        schluessel: 'day.temperature',
        wert: wert,
        gilt_ab: GEBUNDEN_SEIT,
        quelle: 'geraet',
      });
    }

    const dinge = await projiziereDinge(fenster, ['ziel']);
    expect(new Set(dinge.map(ding => ding.ding_id)).size).toBe(2);
    expect(dinge.map(ding => ding.d?.wert).sort()).toEqual([24, 30]);
  });

  it('keeps the id of a hand target free of a device that never set it', async () => {
    await zielStandModel.create({ zelt_id: zelt.zelt_id, schluessel: 'hand.ph', wert: 6.4, gilt_ab: GEBUNDEN_SEIT, quelle: 'hand' });

    const [ziel] = await projiziereDinge(fenster, ['ziel']);
    expect(ziel.ding_id).toBe(`ziel:${zelt.zelt_id}:hand.ph:${GEBUNDEN_SEIT}`);
  });

  it('leaves out a target that had already ended before the window opened', async () => {
    await zielStandModel.create({
      zelt_id: zelt.zelt_id,
      schluessel: 'hand.ph',
      wert: 6.4,
      gilt_ab: TAG_NULL,
      gilt_bis: TAG_NULL + TAG,
      quelle: 'hand',
    });

    expect(await projiziereDinge({ zelt: zelt, von: TAG_NULL + 20 * TAG, bis: JETZT }, ['ziel'])).toEqual([]);
  });
});

describe('paging', () => {
  // Every page is asked for one row more than it holds; that row is what says
  // another page follows, and the caller drops it after merging in the stored
  // half. Here it is dropped by `seite` below.
  const seiten = async (arten: DingArt[], grenze: number) => {
    const gelesen: string[][] = [];
    let cursor: { t: number; ding_id: string } | null = null;

    for (let runde = 0; runde < 10; runde++) {
      const dinge = await projiziereDinge({ ...fenster, limit: grenze, cursor: cursor }, arten);
      const seite = dinge.slice(0, grenze);
      if (seite.length === 0) {
        break;
      }
      gelesen.push(seite.map(ding => ding.ding_id));
      if (dinge.length <= grenze) {
        break;
      }
      cursor = { t: seite[seite.length - 1].t, ding_id: seite[seite.length - 1].ding_id };
    }

    return gelesen;
  };

  it('reads no more than the page plus the row that proves there is another', async () => {
    for (let tag = 1; tag <= 6; tag++) {
      await bild(`foto-${tag}`, GEBUNDEN_SEIT + tag * 1000, 'user/jpeg', { zelt_id: zelt.zelt_id });
    }

    // What the query was cut off at, taken from the query itself: the whole
    // point of the limit is that the collection is never read past it, and a
    // list trimmed after the fact would look exactly the same from outside.
    const grenzen: number[] = [];
    const findet = imageModel.find.bind(imageModel);
    jest.spyOn(imageModel, 'find').mockImplementation(((...argumente: unknown[]) => {
      const abfrage = findet(...(argumente as Parameters<typeof findet>));
      const begrenzt = abfrage.limit.bind(abfrage);
      abfrage.limit = (anzahl: number) => {
        grenzen.push(anzahl);

        return begrenzt(anzahl);
      };

      return abfrage;
    }) as typeof imageModel.find);

    expect(await projiziereDinge({ ...fenster, limit: 2 }, ['bild'])).toHaveLength(3);
    // Six pictures are in the window; the query reads the page, the row that
    // says another page follows, and one more to settle the boundary.
    expect(grenzen).toEqual([4]);
  });

  it('pages through four log rows that share one moment without losing two of them', async () => {
    // A device that logs four lines in the same millisecond, and the migration
    // case: four rows, one `t`, and a cursor on `t` alone would stop after two.
    for (const nachricht of ['message-a', 'message-b', 'message-c', 'message-d']) {
      await deviceLogModel.create({ device_id: 'controller-1', message: nachricht, severity: 0, time: new Date(GEBUNDEN_SEIT + TAG) });
    }

    const gelesen = await seiten(['ereignis'], 2);
    expect(gelesen).toHaveLength(2);
    expect(gelesen.flat()).toHaveLength(4);
    expect(new Set(gelesen.flat()).size).toBe(4);
  });

  it('pages through four targets that share one moment, which is what a migration writes', async () => {
    for (const geraet_id of ['controller-1', 'alt-1']) {
      for (const schluessel of ['day.temperature', 'night.temperature']) {
        await zielStandModel.create({
          zelt_id: zelt.zelt_id,
          geraet_id: geraet_id,
          schluessel: schluessel,
          wert: 24,
          gilt_ab: GEBUNDEN_SEIT,
          quelle: 'geraet',
        });
      }
    }

    const gelesen = await seiten(['ziel'], 2);
    expect(new Set(gelesen.flat()).size).toBe(4);
  });

  it('pages the whole projection, every art at once, and hands out each Ding exactly once', async () => {
    await geraet('controller-1', { ...SOCKET_TABELLE, webcam_did: 'DID12345' }, 'Controller');
    for (let tag = 1; tag <= 4; tag++) {
      await bild(`foto-${tag}`, GEBUNDEN_SEIT + tag * TAG, 'user/jpeg', { zelt_id: zelt.zelt_id });
      await deviceLogModel.create({ device_id: 'controller-1', message: `message-${tag}`, severity: 0, time: new Date(GEBUNDEN_SEIT + tag * TAG) });
    }

    const alles = await projiziereDinge(fenster);
    const gelesen = (await seiten(PROJIZIERTE_ARTEN, 3)).flat();

    expect(gelesen).toEqual(alles.map(ding => ding.ding_id));
    expect(new Set(gelesen).size).toBe(gelesen.length);
  });
});

describe('the merged list', () => {
  it('comes back newest first and carries a device id only where one is involved', async () => {
    await geraet('controller-1', { ...SOCKET_TABELLE, webcam_did: 'DID12345' }, 'Controller');
    await bild('foto-1', GEBUNDEN_SEIT + 3 * TAG, 'user/jpeg', { zelt_id: zelt.zelt_id });
    await deviceLogModel.create({ device_id: 'controller-1', message: 'message-reboot', severity: 0, time: new Date(GEBUNDEN_SEIT + TAG) });

    const dinge = await projiziereDinge(fenster);
    expect(dinge.map(ding => ding.t)).toEqual([...dinge.map(ding => ding.t)].sort((a, b) => b - a));
    expect(new Set(dinge.map(ding => ding.art))).toEqual(new Set(['zelt', 'geraet', 'dose', 'kamera', 'bild', 'ereignis']));
    expect(dinge.filter(ding => ding.art === 'zelt')[0].geraet_id).toBeUndefined();
    expect(dinge.filter(ding => ding.art === 'dose').every(ding => ding.geraet_id === 'controller-1')).toBe(true);
  });
});
