import { SMTP_PASSWORD, SMTP_PORT, SMTP_SECURE, SMTP_SERVER, SMTP_USER } from '@config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodemailer = require('nodemailer');

/**
 * The SMTP transport, for the services that are not providers yet. New code
 * takes `MailService` instead; this file goes when the last of them has moved.
 */
export const mailTransport = nodemailer.createTransport({
  host: SMTP_SERVER,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  debug: false,
  logger: false,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASSWORD,
  },
});
