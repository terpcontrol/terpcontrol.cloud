import { DataService } from '@modules/data/data.service';
import { FluxRow } from '@modules/data/flux';

/**
 * The sparklines on the home's cards, as they are asked of the store.
 *
 * They were one read for every device of the home, naming the set with
 * `contains()`. The store does not push that filter down, so the read went
 * through everything the whole install wrote in the day and held the home back
 * by close to two seconds on every load. What is checked is that each device is
 * asked for by a tag equality the store can answer from its index, and that the
 * answers still land on the device they are about.
 */

const WINDOW = { startsAt: new Date('2026-06-10T00:00:00.000Z'), endsAt: new Date('2026-06-10T01:00:00.000Z'), stepSeconds: 1800 };

/** The real service, with only its talk to the store stood in for; a trend reads nothing from Mongo. */
const storeThat = (answer: (query: string) => Promise<FluxRow[]>): DataService => {
  const store = new DataService({} as never, { url: 'http://127.0.0.1:1', token: 'token', org: 'org', bucket: 'bucket' });
  (store as unknown as { read: (query: string) => Promise<FluxRow[]> }).read = answer;

  return store;
};

const row = (deviceId: string, time: string, value: number | null): FluxRow =>
  ({ _time: time, _value: value, _field: 'temperature', device_id: deviceId }) as FluxRow;

describe('the home´s sparklines', () => {
  it('asks one read per device by tag equality, and never one over the set', async () => {
    const queries: string[] = [];
    const store = storeThat(async query => {
      queries.push(query);
      return [];
    });

    await store.trends(['device-a', 'device-b', 'device-c'], 'temperature', WINDOW);

    expect(queries).toHaveLength(3);
    for (const id of ['device-a', 'device-b', 'device-c']) {
      expect(queries.filter(query => query.includes(`r["device_id"] == "${id}"`))).toHaveLength(1);
    }
    expect(queries.filter(query => query.includes('contains('))).toEqual([]);
  });

  it('keys each answer by its device and leaves out a device that wrote nothing', async () => {
    const store = storeThat(async query => {
      if (query.includes('"device-a"')) return [row('device-a', '2026-06-10T00:30:00Z', 24.5), row('device-a', '2026-06-10T01:00:00Z', 25)];
      if (query.includes('"device-b"')) return [row('device-b', '2026-06-10T00:30:00Z', 20), row('device-b', '2026-06-10T01:00:00Z', null)];
      return [];
    });

    const trends = await store.trends(['device-a', 'device-b', 'device-silent'], 'temperature', WINDOW);

    expect([...trends.keys()]).toEqual(['device-a', 'device-b']);
    expect(trends.get('device-a')!.map(point => point.value)).toEqual([24.5, 25]);
    expect(trends.get('device-b')!.map(point => point.value)).toEqual([20, null]);
  });
});
