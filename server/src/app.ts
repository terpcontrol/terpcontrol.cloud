import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import hpp from 'hpp';
import morgan from 'morgan';
import { connect, set, connection } from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { NODE_ENV, PORT, LOG_FORMAT, ORIGIN, CREDENTIALS, API_URL_EXTERNAL } from '@config';
import { dbConnection } from '@databases';
import { Routes } from '@interfaces/routes.interface';
import errorMiddleware from '@middlewares/error.middleware';
import { demoReadOnlyMiddleware } from '@middlewares/auth.middleware';
import { logger, stream } from '@utils/logger';
import { zeltService } from '@services/zelt.service';
import { buildSwaggerSpec } from '@utils/swagger';
const fileUpload = require('express-fileupload');

/**
 * Credentials that travel in the query string, because the URL is their whole
 * delivery mechanism: §13.5 mints a club key as `/z/<zelt_id>?k=<token>`, a
 * share link is a link, and an `<img>` tag can carry no header.
 *
 * `morgan` writes the request line into `logs/debug/*.log`, kept for 30 days,
 * so without this every use of one of them is a working credential sitting in
 * a log file - and in the reverse proxy's access log, the browser history and
 * any `Referer` the page leaks. The shape is fixed by the spec; what gets
 * written down is not.
 */
const GEHEIME_PARAMETER = ['k', 'share', 'token'];

export const redigiereUrl = (url: string): string => {
  const trenner = url.indexOf('?');
  if (trenner < 0) return url;

  const query = new URLSearchParams(url.slice(trenner + 1));
  const geheim = GEHEIME_PARAMETER.filter(name => query.has(name));
  if (geheim.length === 0) return url;

  // The parameter stays, only its value goes: a log that no longer shows which
  // credential answered a request cannot be used to investigate one.
  geheim.forEach(name => query.set(name, 'redacted'));

  return `${url.slice(0, trenner)}?${query.toString()}`;
};

class App {
  public app: express.Application;
  public env: string;
  public port: string | number;
  public base_url: string;
  private routes: Routes[];

  constructor(routes: Routes[]) {
    this.app = express();
    this.env = NODE_ENV || 'development';
    this.port = PORT || 3000;
    this.routes = routes;

    // Behind the nginx reverse proxy, the TLS connection terminates at the proxy,
    // so trust its X-Forwarded-* headers to recover the original protocol and client IP.
    this.app.set('trust proxy', true);
  }

  public async run() {
    try {
      await this.connectToDatabase();
      this.initializeMiddlewares();
      this.initializeRoutes(this.routes);
      this.initializeSwagger();
      this.initializeErrorHandling();

      this.app.listen(this.port, () => {
        logger.info(`=================================`);
        logger.info(`======= ENV: ${this.env} =======`);
        logger.info(`🚀 App listening on the port ${this.port}`);
        logger.info(`=================================`);
        void this.runMigrations();
      });
    } catch (err) {
      console.log('error:', err);
    }
  }

  public getServer() {
    return this.app;
  }

  private async connectToDatabase() {
    if (this.env !== 'production') {
      set('debug', true);
    }

    await connect(dbConnection.url, dbConnection.options);
    console.log(connection.readyState);
  }

  // Schema-filling migrations belong to the boot, once per deployment: doing
  // them per request would repeat the same query on every call forever. They
  // run behind the open port and swallow their own failures, because they only
  // write rows nothing serves yet — a fleet-sized backfill must never delay the
  // first request or take the process down with it.
  private async runMigrations() {
    try {
      await zeltService.backfillZelte();
      // After the backfill, because it repairs what the backfill could only
      // date from today: a tent whose binding starts later than its own owner
      // demonstrably had the device.
      await zeltService.repariereBindungen();
    } catch (error) {
      logger.error(`Migrations failed: ${error}`);
    }
  }

  private initializeMiddlewares() {
    // Behind a single nginx reverse proxy: trust one hop so the real client IP
    // (X-Forwarded-For) is used for rate limiting instead of the proxy's address.
    this.app.set('trust proxy', 1);

    if (LOG_FORMAT !== 'disabled') {
      // Every format morgan ships prints `:url`, so redacting the token itself
      // covers them all - including whatever LOG_FORMAT is set to in production.
      morgan.token('url', (req: express.Request) => redigiereUrl(req.originalUrl || req.url));
      this.app.use(morgan(LOG_FORMAT, { stream }));
    }
    // this.app.use(cors({ origin: ORIGIN, credentials: CREDENTIALS }));
    this.app.use(cors());
    this.app.use(hpp());
    this.app.use(helmet());
    this.app.use(compression());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.use(fileUpload());
    this.app.use(demoReadOnlyMiddleware);
  }

  private initializeRoutes(routes: Routes[]) {
    routes.forEach(route => {
      this.app.use('/', route.router);
    });
  }

  private initializeSwagger() {
    const swaggerSpec = buildSwaggerSpec(API_URL_EXTERNAL);

    this.app.get('/swagger.json', (req, res) => {
      res.json(swaggerSpec);
    });

    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
  }

  private initializeErrorHandling() {
    this.app.use(errorMiddleware);
  }
}

export default App;
