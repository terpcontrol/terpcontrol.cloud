import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import winston from 'winston';
import winstonDaily from 'winston-daily-rotate-file';
import { config } from 'dotenv';

// The logger is built as this file is imported, which is before Nest has read
// the environment, so it loads the same file ConfigModule does and reads the
// one setting it needs from it. Anything already in the process environment
// wins, exactly as it does there.
config({ path: `.env.${process.env.NODE_ENV || 'development'}.local` });

const logDir: string = process.env.LOG_DIR;

if (!existsSync(logDir)) {
  mkdirSync(logDir);
}

// Anything passed after the message. `logger.info('failed:', error)` used to
// write "failed:" and drop the reason on the floor, which is worth rendering
// rather than losing - even though a message that interpolates its own detail
// reads better.
const SPLAT = Symbol.for('splat') as unknown as string;

const describe = (value: unknown): string => {
  if (value instanceof Error) return value.stack ?? value.message;
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

/*
 * Log Level
 * error: 0, warn: 1, info: 2, http: 3, verbose: 4, debug: 5, silly: 6
 */
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    logFormat,
  ),
  transports: [
    // debug log setting
    new winstonDaily({
      level: 'debug',
      datePattern: 'YYYY-MM-DD',
      dirname: logDir + '/debug', // log file /logs/debug/*.log in save
      filename: `%DATE%.log`,
      maxFiles: 30, // 30 Days saved
      json: false,
      zippedArchive: true,
    }),
    // error log setting
    new winstonDaily({
      level: 'error',
      datePattern: 'YYYY-MM-DD',
      dirname: logDir + '/error', // log file /logs/error/*.log in save
      filename: `%DATE%.log`,
      maxFiles: 30, // 30 Days saved
      handleExceptions: true,
      json: false,
      zippedArchive: true,
    }),
  ],
});

logger.add(
  new winston.transports.Console({
    format: winston.format.combine(winston.format.splat(), winston.format.colorize()),
  }),
);

export { logger };
