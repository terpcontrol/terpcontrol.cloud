import { SMTPServer } from 'smtp-server';
import { MailStore } from './stores';

const headerValue = (raw: string, name: string): string => {
  const match = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(raw);
  return match ? match[1].trim() : '';
};

/** Everything after the header block, which is enough to assert on a link. */
const bodyOf = (raw: string): string => {
  const separator = raw.indexOf('\r\n\r\n');
  return separator === -1 ? raw : raw.slice(separator + 4);
};

/** Captures outgoing mail instead of delivering it. */
export const startFakeSmtp = async (store: MailStore): Promise<{ port: number; server: SMTPServer }> => {
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
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
