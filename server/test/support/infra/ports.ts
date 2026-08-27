import { createServer } from 'node:net';

/**
 * An OS-assigned free port. Racy by nature - the port is released before the
 * caller binds it - but good enough for a suite that starts everything once.
 */
export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
