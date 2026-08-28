import { context } from './api';

export interface SeedPoint {
  time: number | string;
  device_id: string;
  user_id?: string;
  measurement?: string;
  fields: Record<string, number>;
}

export interface StoredPoint {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number>;
  time: number;
}

export interface CapturedMail {
  from: string;
  to: string[];
  subject: string;
  body: string;
  raw: string;
  receivedAt: number;
}

const control = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${context.controlUrl}${path}`, init);
  if (!response.ok) throw new Error(`Control plane ${path} failed: ${response.status}`);
  return (await response.json()) as T;
};

export const seedMeasurements = (points: SeedPoint[]): Promise<{ added: number }> =>
  control('/__control/influx/points', { method: 'POST', body: JSON.stringify(points), headers: { 'content-type': 'application/json' } });

export const storedMeasurements = (): Promise<StoredPoint[]> => control('/__control/influx/points');

export const resetMeasurements = (): Promise<unknown> => control('/__control/influx/reset', { method: 'POST' });

export const capturedMail = (): Promise<CapturedMail[]> => control('/__control/mail/messages');

export const resetMail = (): Promise<unknown> => control('/__control/mail/reset', { method: 'POST' });

/**
 * Takes the MQTT broker away and brings it back on the same port, leaving it
 * down long enough that a client's reconnect attempt is refused first.
 */
export const bounceMqttBroker = (downMs = 3000): Promise<unknown> =>
  control(`/__control/mqtt/bounce?downMs=${downMs}`, { method: 'POST' });

/** Polls until a mail matching the predicate arrives, or fails the wait. */
export const waitForMail = async (predicate: (mail: CapturedMail) => boolean, timeoutMs = 10_000): Promise<CapturedMail> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = (await capturedMail()).find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for a matching mail');
};
