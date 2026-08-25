import { Routes } from '@interfaces/routes.interface';
import AuthRoute from '@routes/auth.route';
import ChartPresetRoute from '@routes/chartpreset.route';
import DataRoute from '@routes/data.route';
import DeviceRoute from '@routes/device.route';
import ImageRoute from '@routes/image.route';
import IndexRoute from '@routes/index.route';
import MqttAuthRoute from '@routes/mqttauth.route';
import ShareRoute from '@routes/share.route';
import UsersRoute from '@routes/users.route';
import ZeltRoute from '@routes/zelt.route';

/**
 * Everything the application serves, in one place. The authorization test
 * builds its app from this list too, so a route added anywhere in the repo has
 * to declare its guard there instead of slipping in unnoticed.
 */
export const allRoutes = (): Routes[] => [
  new ZeltRoute(),
  new DataRoute(),
  new ShareRoute(),
  new ChartPresetRoute(),
  new MqttAuthRoute(),
  new DeviceRoute(),
  new ImageRoute(),
  new IndexRoute(),
  new UsersRoute(),
  new AuthRoute(),
];
