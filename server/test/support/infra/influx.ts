import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFlux, runQuery } from './flux';
import { InfluxPoint, InfluxStore, MailStore } from './stores';

const PRECISION_TO_MS: Record<string, number> = { ns: 1e-6, us: 1e-3, ms: 1, s: 1000 };

/** Split on `separator`, honouring line-protocol backslash escapes. */
const splitUnescaped = (input: string, separator: string): string[] => {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i++;
    } else if (input[i] === separator) {
      parts.push(current);
      current = '';
    } else {
      current += input[i];
    }
  }
  parts.push(current);
  return parts;
};

export const parseLineProtocol = (body: string, precision: string, now: number): InfluxPoint[] =>
  body
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .map(line => {
      const [head, fieldPart, timestampPart] = splitUnescaped(line, ' ');
      const [measurement, ...tagPairs] = splitUnescaped(head, ',');

      const tags: Record<string, string> = {};
      for (const pair of tagPairs) {
        const [key, value] = splitUnescaped(pair, '=');
        tags[key] = value;
      }

      const fields: Record<string, number> = {};
      for (const pair of splitUnescaped(fieldPart ?? '', ',')) {
        const [key, value] = splitUnescaped(pair, '=');
        if (key) fields[key] = parseFloat(value);
      }

      const scale = PRECISION_TO_MS[precision] ?? PRECISION_TO_MS.ns;
      const time = timestampPart ? Number(timestampPart) * scale : now;

      return { measurement, tags, fields, time };
    });

const rfc3339 = (millis: number): string => new Date(millis).toISOString();

const csvValue = (value: number | null): string => {
  if (value === null) return '';
  // Influx renders a non-finite aggregate as an empty cell, which the client
  // reads back as null.
  return Number.isFinite(value) ? String(value) : '';
};

const toAnnotatedCsv = (query: string, store: InfluxStore, now: number): string => {
  const parsed = parseFlux(query);
  const { rows, start, stop } = runQuery(store.points, parsed, now);

  const lines = [
    '#datatype,string,long,dateTime:RFC3339,dateTime:RFC3339,dateTime:RFC3339,double,string,string,string,string',
    '#group,false,false,true,true,false,false,true,true,true,true',
    '#default,_result,,,,,,,,,',
    ',result,table,_start,_stop,_time,_value,_field,_measurement,device_id,user_id',
  ];

  for (const row of rows) {
    lines.push(
      [
        '',
        '',
        '0',
        rfc3339(start),
        rfc3339(stop),
        rfc3339(row.time),
        csvValue(row.value),
        row.field,
        row.measurement,
        row.deviceId,
        row.userId,
      ].join(','),
    );
  }

  return lines.join('\r\n') + '\r\n\r\n';
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise(resolve => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => resolve(body));
  });

const json = (res: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

/**
 * A short clip with regular keyframes, built once. The server grabs the next
 * keyframe with a tiny probe size, so a fixture needs real keyframes rather
 * than a single still.
 */
let videoFixtureBytes: Buffer | undefined;

const videoFixture = async (): Promise<Buffer> => {
  if (videoFixtureBytes) return videoFixtureBytes;

  const file = join(tmpdir(), 'terpcontrol-test-stream.mp4');
  await new Promise<void>((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', '-g', '10', file],
      error => (error ? reject(error) : resolve()),
    );
  });

  videoFixtureBytes = await readFile(file);
  return videoFixtureBytes;
};

export interface FakeInfluxOptions {
  influx: InfluxStore;
  mail: MailStore;
  /** Lets a spec take the MQTT broker away and bring it back. */
  bounceBroker: (downMs?: number) => Promise<void>;
  /** Overridable so time-dependent assertions can pin "now". */
  now?: () => number;
}

/**
 * Stands in for InfluxDB 2.x and doubles as the control plane the test workers
 * use to seed data and read captured mail, since the fakes live in the jest
 * main process and the specs do not.
 */
export const startFakeInflux = async (options: FakeInfluxOptions): Promise<{ url: string; server: Server }> => {
  const now = options.now ?? (() => Date.now());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    try {
      if (path === '/health' || path === '/ping') return json(res, 200, { status: 'pass' });

      // Something ffmpeg can read a frame out of, so the webcam test button has
      // a success path without a camera on the network.
      if (path === '/__control/stream.mp4' && req.method === 'GET') {
        const video = await videoFixture();
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': video.length });
        res.end(video);
        return;
      }

      if (path === '/api/v2/write' && req.method === 'POST') {
        const body = await readBody(req);
        options.influx.add(parseLineProtocol(body, url.searchParams.get('precision') ?? 'ns', now()));
        res.writeHead(204).end();
        return;
      }

      if (path === '/api/v2/query' && req.method === 'POST') {
        const body = await readBody(req);
        let query = body;
        try {
          query = JSON.parse(body).query ?? body;
        } catch {
          /* raw flux */
        }
        const csv = toAnnotatedCsv(query, options.influx, now());
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
        res.end(csv);
        return;
      }

      if (path === '/__control/influx/points') {
        if (req.method === 'GET') return json(res, 200, options.influx.points);
        if (req.method === 'POST') {
          const seeded = JSON.parse(await readBody(req)) as Array<{
            time: number | string;
            device_id: string;
            user_id?: string;
            measurement?: string;
            fields: Record<string, number>;
          }>;
          options.influx.add(
            seeded.map(point => ({
              measurement: point.measurement ?? 'status',
              tags: { device_id: point.device_id, user_id: point.user_id ?? 'seed-user' },
              fields: point.fields,
              time: typeof point.time === 'string' ? Date.parse(point.time) : point.time,
            })),
          );
          return json(res, 200, { added: seeded.length });
        }
      }

      if (path === '/__control/influx/reset' && req.method === 'POST') {
        options.influx.reset();
        return json(res, 200, { ok: true });
      }

      if (path === '/__control/mail/messages' && req.method === 'GET') return json(res, 200, options.mail.messages);

      if (path === '/__control/mail/reset' && req.method === 'POST') {
        options.mail.reset();
        return json(res, 200, { ok: true });
      }

      if (path === '/__control/mqtt/bounce' && req.method === 'POST') {
        const downMs = Number(url.searchParams.get('downMs'));
        await options.bounceBroker(Number.isFinite(downMs) && downMs > 0 ? downMs : undefined);
        return json(res, 200, { ok: true });
      }

      json(res, 404, { error: `unhandled ${req.method} ${path}` });
    } catch (error) {
      json(res, 500, { error: String(error) });
    }
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, server };
};
