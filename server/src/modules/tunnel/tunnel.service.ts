import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { logger } from '@utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { DeviceTunnelSink } from '@modules/device-protocol/device-sinks';
import { deviceTopic } from '@modules/device-protocol/topics';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { AddressInfo, createServer, Server } from 'node:net';
import { Semaphore, SemaphoreInterface, withTimeout } from 'async-mutex';

const TUNNEL_CHUNK_SIZE = 128;
const MAX_PACKET_LENGTH = 1000;
const PARALLEL_TUNNEL_CONNECTIONS = 1;
const TUNNEL_SERVER_TIMEOUT_MS = 300_000;
const TUNNEL_INACTIVITY_TIMEOUT_MS = 30_000;

/** The port a stream URL that names none is reached on, by its scheme; anything else is 80. */
const DEFAULT_PORTS: Record<string, number> = { 'rtsp:': 554, 'rtsps:': 322, 'rtmp:': 1935, 'rtmps:': 443, 'https:': 443 };

type TunnelStreamTxData = {
  connection_id: string;
} & ({ disconnected: true; payload?: string; host?: string; port?: number } | { disconnected?: false; payload: string; host: string; port: number });

type TunnelStreamRxData = Pick<TunnelStreamTxData, 'connection_id' | 'payload' | 'disconnected'> & {
  sequence: number;
};

type TunnelConnectionData = {
  nextSequence: number;
  lastActivityTime: number;
  /** Only ever called for a message that carries data; a disconnect has its own. */
  handler: (payload: string) => void;
  queue: TunnelStreamRxData[];
  handleDisconnect: (error?: Error) => void;
  acquire: Promise<void>;
  release?: SemaphoreInterface.Releaser;
};

@Injectable()
export class TunnelService implements BeforeApplicationShutdown, DeviceTunnelSink {
  constructor(private readonly mqtt: MqttClientService) {}

  private deviceIdToTunnelConnection = new Map<string, Map<string, TunnelConnectionData>>();
  private deviceIdToSemaphore = new Map<string, SemaphoreInterface>();
  /** The listening ends of the proxies, so they can be given up on the way down. */
  private readonly proxyServers = new Set<Server>();
  /** Set on the way down: every connection has already been said goodbye to. */
  private stopping = false;

  /**
   * Tell every device that its tunnels are over, and drop them.
   *
   * The other half of a tunnel lives on the controller, which holds its socket
   * to the camera open until it is told the connection is gone - so a server
   * that stops without saying so leaves the device talking to nobody until its
   * own timeout. Its listening ports go too, or a restart finds them taken.
   *
   * `beforeApplicationShutdown` rather than `onApplicationShutdown`, because
   * this has one last thing to say through the broker connection, and that is
   * closed in the latter. Nest runs every hook of this kind before the first of
   * those.
   */
  public beforeApplicationShutdown(): void {
    this.stopping = true;

    let dropped = 0;

    for (const [device_id, connections] of this.deviceIdToTunnelConnection) {
      for (const [connection_id, connection] of [...connections]) {
        dropped++;
        // The shape the close handler sends, without the host and port: they
        // describe where the connection went, which no longer matters to one
        // that is ending.
        this.write(device_id, { connection_id, disconnected: true });
        connection.release?.();
        connection.handleDisconnect();
      }
    }
    this.deviceIdToTunnelConnection.clear();

    for (const server of this.proxyServers) {
      server.close();
    }
    this.proxyServers.clear();

    if (dropped > 0) {
      logger.info(`Dropping ${dropped} tunnel connection(s), and telling the devices`);
    }
  }

  public onTunnelReadDataReceived(device_id: string, data: string): void {
    try {
      const parsed: TunnelStreamRxData = JSON.parse(data);

      const connection = this.deviceIdToTunnelConnection.get(device_id)?.get(parsed.connection_id);
      if (!connection) {
        if (!parsed.disconnected) this.write(device_id, { connection_id: parsed.connection_id, disconnected: true });
        return;
      }

      connection.queue.push(parsed);

      let nextData: TunnelStreamRxData | undefined;
      while ((nextData = connection.queue.find(d => d.sequence === connection.nextSequence))) {
        if (nextData.disconnected) {
          connection.handleDisconnect();
          break;
        } else {
          this.reportTunnelActivity(device_id, parsed.connection_id);
          // `nextData` is what the loop condition just found, and a message that
          // is not a disconnect carries a payload.
          connection.queue = connection.queue.filter(d => d.sequence > nextData!.sequence);
          connection.handler(nextData.payload!);
        }
        connection.nextSequence++;
      }
    } catch (e) {
      logger.error(`Error parsing tunnel data received: ${e}`);
    }
  }

  public async createTunnelProxyServer(streamUrl: URL, device_id: string): Promise<string> {
    const port = streamUrl.port ? parseInt(streamUrl.port) : (DEFAULT_PORTS[streamUrl.protocol] ?? 80);

    return new Promise<string>((resolve, reject) => {
      const server = createServer(client => {
        const connectionId = uuidv4();

        let semaphore = this.deviceIdToSemaphore.get(device_id);
        if (!semaphore) {
          semaphore = withTimeout(new Semaphore(PARALLEL_TUNNEL_CONNECTIONS), TUNNEL_SERVER_TIMEOUT_MS, new Error('Tunnel device mutex timeout'));
          this.deviceIdToSemaphore.set(device_id, semaphore);
        }
        let connections = this.deviceIdToTunnelConnection.get(device_id);
        if (!connections) {
          connections = new Map();
          this.deviceIdToTunnelConnection.set(device_id, connections);
        }

        const connection: TunnelConnectionData = {
          handler: payload => {
            if (client.destroyed) {
              return;
            }

            this.reportTunnelActivity(device_id, connectionId);

            client.write(new Uint8Array(Buffer.from(payload, 'base64')), err => {
              if (err) {
                client.destroy(err);
              }
            });
          },
          lastActivityTime: Date.now(),
          nextSequence: 0,
          queue: [],
          handleDisconnect: error => client.destroy(error),
          acquire: semaphore.acquire().then(([, release]) => {
            if (this.deviceIdToTunnelConnection.get(device_id)?.has(connectionId)) {
              connection.release = release;
            } else {
              release();
            }
          }),
        };

        connections.set(connectionId, connection);

        let timeoutHandle: NodeJS.Timeout;
        const timeoutAfterActivity = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          timeoutHandle = setTimeout(() => {
            if (Date.now() - (connection.lastActivityTime || 0) >= TUNNEL_INACTIVITY_TIMEOUT_MS) {
              client.destroy();
            } else {
              timeoutAfterActivity();
            }
          }, 1000);
        };

        client.once('close', () => {
          // On the way down the server has already said goodbye for every
          // connection it had, so this would be the second one.
          if (!this.stopping && !this.moduleHasDisconnected(device_id, connectionId)) {
            this.write(device_id, { connection_id: connectionId, disconnected: true, host: streamUrl.hostname, port });
          }

          connection.release?.();
          this.deviceIdToTunnelConnection.get(device_id)?.delete(connectionId);
        });
        // No setEncoding(): the socket must stay in binary mode. With an encoding set,
        // 'data' arrives as a string and Buffer.from() would re-encode it as UTF-8,
        // mangling every byte above 0x7f (RTCP reports on an interleaved RTSP session,
        // TLS records, binary webhook bodies).
        client.on('data', data => {
          this.onClientDataReceived(device_id, { connection_id: connectionId, host: streamUrl.hostname, port }, data).then(() =>
            timeoutAfterActivity(),
          );
        });

        client.on('error', () => {
          // Ignore errors, as they are handled in 'close' event
        });
      });

      this.proxyServers.add(server);
      server.once('close', () => this.proxyServers.delete(server));

      server.listen(
        {
          port: 0,
          host: '127.0.0.1',
        },
        () => {
          const { port: local } = server.address() as AddressInfo;
          const url = new URL(streamUrl.toString());
          url.hostname = '127.0.0.1';
          url.port = String(local);
          logger.info(`Tunnel proxy server listening on ${local}, proxying to ${streamUrl.hostname}:${port} for device ${device_id}`);
          resolve(url.toString());
        },
      );
      server.on('error', (err: any) => {
        reject(err);
      });

      setTimeout(() => {
        server.close(err => {
          if (err) {
            logger.error(`Error closing tunnel proxy server on timeout: ${err}`);
          }
        });
        reject(new Error('Timeout creating tunnel proxy server'));
      }, TUNNEL_SERVER_TIMEOUT_MS);
    });
  }

  private write(deviceId: string, message: TunnelStreamTxData | string): void {
    this.mqtt.publish(deviceTopic(deviceId, 'tunnel_write'), typeof message === 'string' ? message : JSON.stringify(message));
  }

  private reportTunnelActivity(device_id: string, connection_id: string): void {
    const connection = this.deviceIdToTunnelConnection.get(device_id)?.get(connection_id);
    if (connection) {
      connection.lastActivityTime = Date.now();
    }
  }

  private moduleHasDisconnected(device_id: string, connection_id: string): boolean {
    const connection = this.deviceIdToTunnelConnection.get(device_id)?.get(connection_id);
    return connection?.queue?.find(d => d.disconnected)?.disconnected || false;
  }

  private onClientDataReceived(
    device_id: string,
    metadata: Pick<Required<TunnelStreamTxData>, 'connection_id' | 'host' | 'port'>,
    data: Buffer,
  ): Promise<void> {
    data = Buffer.from(data);

    const connection = this.deviceIdToTunnelConnection.get(device_id)?.get(metadata.connection_id);
    if (!connection) {
      return Promise.resolve();
    }

    connection.acquire = connection.acquire.then(() => {
      while (data.length > 0) {
        if (
          !this.deviceIdToTunnelConnection.get(device_id)?.has(metadata.connection_id) ||
          this.moduleHasDisconnected(device_id, metadata.connection_id)
        ) {
          return;
        }

        const chunk = Buffer.from(data.slice(0, TUNNEL_CHUNK_SIZE));
        data = Buffer.from(data.slice(TUNNEL_CHUNK_SIZE));
        const message: TunnelStreamTxData = {
          ...metadata,
          payload: chunk.toString('base64'),
        };
        const encodedMessage = JSON.stringify(message);
        if (encodedMessage.length > MAX_PACKET_LENGTH) {
          connection.handleDisconnect(new Error(`Packet length (${encodedMessage.length}) exceeds the maximum length of ${MAX_PACKET_LENGTH}`));
          return;
        }

        this.reportTunnelActivity(device_id, metadata.connection_id);
        this.write(device_id, encodedMessage);
      }
    });

    return connection.acquire;
  }
}
