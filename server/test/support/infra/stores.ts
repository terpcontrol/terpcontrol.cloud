export interface InfluxPoint {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number>;
  /** Milliseconds since the epoch. */
  time: number;
}

/** A point as a spec seeds it through the control plane. */
export interface SeedPoint {
  time: number | string;
  device_id: string;
  user_id?: string;
  measurement?: string;
  fields: Record<string, number>;
}

export interface CapturedMail {
  from: string;
  to: string[];
  subject: string;
  body: string;
  raw: string;
  receivedAt: number;
}

/** Everything the app wrote to, or reads back from, the fake InfluxDB. */
export class InfluxStore {
  public points: InfluxPoint[] = [];

  public add(points: InfluxPoint[]): void {
    this.points.push(...points);
    this.points.sort((a, b) => a.time - b.time);
  }
}

export class MailStore {
  public messages: CapturedMail[] = [];

  public add(message: CapturedMail): void {
    this.messages.push(message);
  }

  public reset(): void {
    this.messages = [];
  }
}
