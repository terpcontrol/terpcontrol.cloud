import { existsSync, mkdirSync } from 'fs';
import winston from 'winston';
import winstonDaily from 'winston-daily-rotate-file';
import { config } from 'dotenv';
import { ENV_FILE } from '@config/configuration';
import { errorText } from './error-text';

// The logger is built as this file is imported, which is before Nest has read
// the environment, so it loads ENV_FILE itself for the one setting it needs.
// Anything already in the process environment wins, exactly as it does there.
config({ path: ENV_FILE });

// A fallback only so that a missing LOG_DIR is reported by the environment
// check rather than by this file dying on a path of `undefined` before the
// check has run. A deployment is expected to set it, and is told to.
const logDir: string = process.env.LOG_DIR || 'logs';

if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

// Anything passed after the message. `logger.info('failed:', error)` used to
// write "failed:" and drop the reason on the floor, which is worth rendering
// rather than losing - even though a message that interpolates its own detail
// reads better.
const SPLAT = Symbol.for('splat') as unknown as string;

const describe = (value: unknown): string => {
  if (value instanceof Error) return errorText(value);
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const logFormat = winston.format.printf(info => {
  const extra = (info[SPLAT] as unknown[] | undefined) ?? [];
  const details = extra.map(describe).join(' ');

  return `${info.timestamp} ${info.level}: ${describe(info.message)}${details ? ` ${details}` : ''}`;
});

const dailyFile = (level: 'debug' | 'error', extra: object = {}) =>
  new winstonDaily({
    level,
    datePattern: 'YYYY-MM-DD',
    dirname: `${logDir}/${level}`,
    filename: '%DATE%.log',
    maxFiles: 30,
    json: false,
    zippedArchive: true,
    ...extra,
  });

export const logger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
  transports: [
    dailyFile('debug'),
    dailyFile('error', { handleExceptions: true }),
    new winston.transports.Console({ format: winston.format.combine(winston.format.splat(), winston.format.colorize()) }),
  ],
});
