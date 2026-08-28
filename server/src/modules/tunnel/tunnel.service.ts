import { Injectable } from '@nestjs/common';
import { logger } from '@utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { Mutex, MutexInterface, Semaphore, SemaphoreInterface, withTimeout } from 'async-mutex';

const TUNNEL_CHUNK_SIZE = 128;
const MAX_PACKET_LENGTH = 1000;
const PARALLEL_TUNNEL_CONNECTIONS = 1;
const TUNNEL_SERVER_TIMEOUT_MS = 300_000;
const TUNNEL_INACTIVITY_TIMEOUT_MS = 30_000;

type TunnelStreamTxData = {
  connection_id: string;
} & ({ disconnected: true; payload?: string; host?: string; port?: number } | { disconnected?: false; payload: string; host: string; port: number });

type TunnelStreamRxData = Pick<TunnelStreamTxData, 'connection_id' | 'payload' | 'disconnected'> & {
  sequence: number;
};

// UDP relay (O-KAM camera P2P) — datagrams carry their own peer host/port.
type UdpTunnelRxData = {
  connection_id: string;
  udp?: boolean;
  host?: string;
  port?: number;
  payload?: string;
  disconnected?: boolean;
  sequence?: number;
};

type UdpTunnelTxData = {
  connection_id: string;
  udp: true;
} & ({ disconnected: true } | { host: string; port: number; payload: string });

/**
 * A datagram socket whose packets are relayed through the controller's MQTT
 * tunnel. Mirrors the small surface of node's dgram.Socket the P2P client needs:
 *   .send(buf, port, host)   emits nothing; fire-and-forget
 *   .on('message', (buf, rinfo) => ...)
 *   .close()
 */
export class TunnelUdpSocket extends EventEmitter {
  constructor(
    private device_id: string,
    public readonly connectionId: string,
    private onClose: () => void,
    private readonly mqtt: MqttClientService,
  ) {
    super();
  }

  public send(buf: Buffer, port: number, host: string): void {
    const message: UdpTunnelTxData = {
      connection_id: this.connectionId,
      udp: true,
      host,
      port,
      payload: buf.toString('base64'),
    };
    this.mqtt.publish('/devices/' + this.device_id + '/tunnel_write', JSON.stringify(message));
  }

  public close(): void {
    const message: UdpTunnelTxData = { connection_id: this.connectionId, udp: true, disconnected: true };
    this.mqtt.publish('/devices/' + this.device_id + '/tunnel_write', JSON.stringify(message));
    this.onClose();
    this.removeAllListeners();
  }
}

type TunnelConnectionData = {
  nextSequence: number;
  lastActivityTime: number;
  handler: (payload: TunnelStreamRxData['payload']) => void;
  queue: TunnelStreamRxData[];
  handleDisconnect: (error?: Error) => void;
  acquire: Promise<void>;
  release?: SemaphoreInterface.Releaser;
};

@Injectable()
export class TunnelService {
  constructor(private readonly mqtt: MqttClientService) {}

  private deviceIdToTunnelConnection = new Map<string, Map<string, TunnelConnectionData>>();
  private deviceIdToSemaphore = new Map<string, SemaphoreInterface>();
  private deviceIdToUdpTunnel = new Map<string, Map<string, TunnelUdpSocket>>();

  /**
   * Open a UDP relay to the given device's LAN. The returned socket sends and
   * receives datagrams through the controller (see the firmware UDP tunnel).
   * Used by the O-KAM camera P2P client to reach the camera behind the controller.
   */
  public openUdpTunnel(device_id: string): TunnelUdpSocket {
    const connectionId = uuidv4();
    if (!this.deviceIdToUdpTunnel.has(device_id)) {
      this.deviceIdToUdpTunnel.set(device_id, new Map());
    }
    const socket = new TunnelUdpSocket(device_id, connectionId, () => this.deviceIdToUdpTunnel.get(device_id)?.delete(connectionId), this.mqtt);
    this.deviceIdToUdpTunnel.get(device_id).set(connectionId, socket);
    return socket;
  }

  public onTunnelReadDataReceived(device_id: string, data: string): Promise<void> {
    try {
      const parsed: TunnelStreamRxData = JSON.parse(data);

      // UDP datagrams (O-KAM camera P2P) bypass the ordered TCP-stream machinery:
      // they carry their own peer host/port and have no sequence guarantees.
      const udpRegistry = this.deviceIdToUdpTunnel.get(device_id)?.get(parsed.connection_id);
      if (udpRegistry && ((parsed as UdpTunnelRxData).udp || (parsed as UdpTunnelRxData).host)) {
        const u = parsed as UdpTunnelRxData;
        if (u.disconnected) {
          udpRegistry.emit('close');
        } else if (u.payload && u.host) {
          // rinfo shaped like node's dgram (address/port) so the P2P client can
          // run over either a real dgram socket or this tunnelled one.
          udpRegistry.emit('message', Buffer.from(u.payload, 'base64'), { address: u.host, port: u.port });
        }
        return Promise.resolve();
      }

      const connection = this.deviceIdToTunnelConnection.get(device_id)?.get(parsed.connection_id);
      if (!connection) {
        if (!parsed.disconnected) {
          const message: TunnelStreamTxData = {
            connection_id: parsed.connection_id,
            disconnected: true,
          };
          this.mqtt.publish('/devices/' + device_id + '/tunnel_write', JSON.stringify(message));
        }
        return;
      }

      connection.queue.push(parsed);

      let nextData: TunnelStreamRxData;
      while ((nextData = connection.queue.find(d => d.sequence === connection.nextSequence))) {
        if (nextData.disconnected) {
          connection.handleDisconnect();
          break;
        } else {
          this.reportTunnelActivity(device_id, parsed.connection_id);
          connection.queue = connection.queue.filter(d => d.sequence > nextData.sequence);
          connection.handler(nextData.payload);
        }
        connection.nextSequence++;
      }
    } catch (e) {
      logger.error(`Error parsing tunnel data received: ${e}`);
    }

    return Promise.resolve();
  }

  public async createTunnelProxyServer(streamUrl: URL, device_id: string): Promise<string> {
    const port = streamUrl.port
      ? parseInt(streamUrl.port)
      : streamUrl.protocol === 'rtsp:'
      ? 554
      : streamUrl.protocol === 'rtsps:'
      ? 322
      : streamUrl.protocol === 'rtmp:'
      ? 1935
      : ['rtmps:', 'https:'].includes(streamUrl.protocol)
      ? 443
      : 80;

    return new Promise<string>((resolve, reject) => {
      const server = createServer(client => {
        const connectionId = uuidv4();

        if (!this.deviceIdToSemaphore.has(device_id)) {
          this.deviceIdToSemaphore.set(
            device_id,
            withTimeout(new Semaphore(PARALLEL_TUNNEL_CONNECTIONS), TUNNEL_SERVER_TIMEOUT_MS, new Error('Tunnel device mutex timeout')),
          );
        }
        if (!this.deviceIdToTunnelConnection.has(device_id)) {
          this.deviceIdToTunnelConnection.set(device_id, new Map());
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
          acquire: this.deviceIdToSemaphore
            .get(device_id)
            .acquire()
            .then(([number, release]) => {
              if (this.deviceIdToTunnelConnection.get(device_id)?.has(connectionId)) {
                connection.release = release;
              } else {
                release();
              }
            }),
        };

        this.deviceIdToTunnelConnection.get(device_id).set(connectionId, connection);

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
          if (!this.moduleHasDisconnected(device_id, connectionId)) {
            const message: TunnelStreamTxData = {
              connection_id: connectionId,
              disconnected: true,
              host: streamUrl.hostname,
              port,
            };
            this.mqtt.publish('/devices/' + device_id + '/tunnel_write', JSON.stringify(message));
          }

          connection.release?.();
          this.deviceIdToTunnelConnection.get(device_id)?.delete(connectionId);
        });
        client.setEncoding('binary');
        client.on('data', data => {
          this.onClientDataReceived(device_id, { connection_id: connectionId, host: streamUrl.hostname, port }, data).then(() =>
            timeoutAfterActivity(),
          );
        });

        client.on('error', err => {
          // Ignore errors, as they are handled in 'close' event
        });
      });

      server.listen(
        {
          port: 0,
          host: '127.0.0.1',
        },
        () => {
          const url = new URL(streamUrl.toString());
          url.hostname = '127.0.0.1';
          url.port = String((server.address() as any).port);
          logger.info(
            `Tunnel proxy server listening on ${(server.address() as any).port}, proxying to ${streamUrl.hostname}:${port} for device ${device_id}`,
          );
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
        this.mqtt.publish('/devices/' + device_id + '/tunnel_write', encodedMessage);
      }
    });

    return connection.acquire ?? Promise.resolve();
  }
}
