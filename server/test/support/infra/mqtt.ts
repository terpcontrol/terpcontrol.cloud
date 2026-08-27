import { createServer, Server } from 'node:net';
import { Aedes } from 'aedes';

/**
 * A real MQTT broker, so the server under test connects over TCP exactly as it
 * does in production and the specs can watch what it publishes.
 */
export const startMqttBroker = async (): Promise<{ port: number; server: Server; aedes: Aedes }> => {
  const aedes = await Aedes.createBroker();
  const server = createServer(aedes.handle);

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };

  return { port, server, aedes };
};
