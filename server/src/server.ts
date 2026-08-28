const process = require('node:process');
const fs = require('node:fs');

process.on('uncaughtException', (err, origin) => {
  fs.writeSync(process.stderr.fd, `Caught exception: ${err}\n` + `Exception origin: ${origin}\n${err.stack}\n`);
});

import App from '@/app';
import validateEnv from '@utils/validateEnv';
import { allRoutes } from '@routes/index';

validateEnv();

const app = new App(allRoutes());
app.run();
