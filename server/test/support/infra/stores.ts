export interface InfluxPoint {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number>;
  /** Milliseconds since the epoch. */
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

/** Everything the app wrote to, or reads back from, the fake InfluxDB. */
export class InfluxStore {
  public points: InfluxPoint[] = [];

  public add(points: InfluxPoint[]): void {
    this.points.push(...points);
    this.points.sort((a, b) => a.time - b.time);
  }

  public reset(): void {
    this.points = [];
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
