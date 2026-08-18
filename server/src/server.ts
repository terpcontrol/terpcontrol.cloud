const process = require('node:process');
const fs = require('node:fs');

process.on('uncaughtException', (err, origin) => {
  fs.writeSync(process.stderr.fd, `Caught exception: ${err}\n` + `Exception origin: ${origin}\n${err.stack}\n`);
});

import App from '@/app';
import AuthRoute from '@routes/auth.route';
import IndexRoute from '@routes/index.route';
import UsersRoute from '@routes/users.route';
import DeviceRoute from '@routes/device.route';
import ImageRoute from '@routes/image.route';
import validateEnv from '@utils/validateEnv';
import MqttAuthRoute from './routes/mqttauth.route';
import DataRoute from './routes/data.route';
import ShareRoute from './routes/share.route';
import ChartPresetRoute from './routes/chartpreset.route';

validateEnv();

const app = new App([
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
app.run();
