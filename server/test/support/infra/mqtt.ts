import { createServer, Server, Socket } from 'node:net';
import { Aedes } from 'aedes';

export interface MqttBroker {
  readonly port: number;
  /** The live instance; a restart replaces it, so read it rather than holding it. */
  readonly aedes: Aedes;
  /**
   * Drops the broker and brings it back on the same port, as a restart would.
   * It stays down long enough for a client's reconnect attempt to be refused,
   * which is what a real restart looks like from the other side.
   */
  bounce(downMs?: number): Promise<void>;
  close(): Promise<void>;
}

interface RunningBroker {
  port: number;
  aedes: Aedes;
  server: Server;
  sockets: Set<Socket>;
}

const listen = async (port: number): Promise<RunningBroker> => {
  const aedes = await Aedes.createBroker();
  const sockets = new Set<Socket>();

  // The sockets are tracked because closing a TCP server only stops it
  // accepting new ones: a broker that went away takes the open ones with it,
  // and without that the clients never notice.
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    aedes.handle(socket);
  });

  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));

  return { port: (server.address() as { port: number }).port, aedes, server, sockets };
};

const shutDown = async (running: RunningBroker): Promise<void> => {
  await new Promise<void>(resolve => running.aedes.close(() => resolve()));

  for (const socket of running.sockets) {
    socket.destroy();
  }
  running.sockets.clear();

  await new Promise<void>(resolve => running.server.close(() => resolve()));
};

/**
 * A real MQTT broker, so the server under test connects over TCP exactly as it
 * does in production and the specs can watch what it publishes - and see it
 * survive the broker going away.
 */
export const startMqttBroker = async (): Promise<MqttBroker> => {
  let running = await listen(0);
  const port = running.port;

  return {
    port,
    get aedes() {
      return running.aedes;
    },
    async bounce(downMs = 3000) {
      await shutDown(running);
      await new Promise(resolve => setTimeout(resolve, downMs));
      running = await listen(port);
    },
    close() {
      return shutDown(running);
    },
  };
};
