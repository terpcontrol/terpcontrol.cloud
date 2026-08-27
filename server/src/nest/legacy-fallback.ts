import { IncomingMessage, ServerResponse } from 'node:http';
import { FastifyInstance } from 'fastify';
import App from '@/app';
import AuthRoute from '@routes/auth.route';
import ChartPresetRoute from '@routes/chartpreset.route';
import DataRoute from '@routes/data.route';
import DeviceRoute from '@routes/device.route';
import ImageRoute from '@routes/image.route';
import IndexRoute from '@routes/index.route';
import MqttAuthRoute from '@routes/mqttauth.route';
import ShareRoute from '@routes/share.route';
import UsersRoute from '@routes/users.route';

export type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;

/**
 * The Express application, ready to serve but not listening. It handles every
 * route the NestJS app has not taken over yet; once it has them all, this file
 * and the Express tree go away together.
 */
export const createLegacyApp = async (): Promise<NodeHandler> => {
  const legacy = new App([
    new DataRoute(),
    new ShareRoute(),
    new ChartPresetRoute(),
    new MqttAuthRoute(),
    new DeviceRoute(),
    new ImageRoute(),
    new IndexRoute(),
    new UsersRoute(),
    new AuthRoute(),
  ]);

  await legacy.init();
  return legacy.getServer() as unknown as NodeHandler;
};

/**
 * Routes a request to NestJS when it has a matching route, and to Express
 * otherwise. Asking the router rather than keeping a list means a route moves
 * over the moment a Nest controller declares it.
 */
export const createDispatcher = (
  fastify: () => FastifyInstance | undefined,
  nest: NodeHandler,
  legacy: NodeHandler,
): NodeHandler => {
  return (request, response) => {
    const instance = fastify();
    const path = (request.url ?? '/').split('?')[0];

    const handledByNest = !!instance && !!request.method && instance.hasRoute({ method: request.method as never, url: path });

    (handledByNest ? nest : legacy)(request, response);
  };
};
