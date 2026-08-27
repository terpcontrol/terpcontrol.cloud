import { SMTPServer } from 'smtp-server';
import { MailStore } from './stores';

const headerValue = (raw: string, name: string): string => {
  const match = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(raw);
  return match ? match[1].trim() : '';
};

const decodeQuotedPrintable = (body: string): string =>
  body
    // Soft line breaks: nodemailer wraps at 76 columns, which would otherwise
    // split a URL or a token in half.
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

/** Everything after the header block, decoded so links survive intact. */
const bodyOf = (raw: string): string => {
  const separator = raw.indexOf('\r\n\r\n');
  const body = separator === -1 ? raw : raw.slice(separator + 4);

  const encoding = headerValue(raw, 'Content-Transfer-Encoding').toLowerCase();
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  if (encoding === 'base64') return Buffer.from(body.replace(/\r?\n/g, ''), 'base64').toString('utf8');
  return body;
};

/** Captures outgoing mail instead of delivering it. */
export const startFakeSmtp = async (store: MailStore): Promise<{ port: number; server: SMTPServer }> => {
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    // The app authenticates like it does against a real relay; anything is accepted.
    onAuth(auth, session, callback) {
      callback(null, { user: auth.username });
    },
    onData(stream, session, callback) {
      let raw = '';
      stream.on('data', chunk => (raw += chunk));
      stream.on('end', () => {
        store.add({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map(recipient => recipient.address),
          subject: headerValue(raw, 'Subject'),
          body: bodyOf(raw),
          raw,
          receivedAt: Date.now(),
        });
        callback();
      });
    },
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.server.address() as { port: number }).port));
  });

  return { port, server };
};
