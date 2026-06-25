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
import { logger, stream } from '@utils/logger';
import { buildSwaggerSpec } from '@utils/swagger';
const fileUpload = require('express-fileupload');

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

  private initializeMiddlewares() {
    // Behind a single nginx reverse proxy: trust one hop so the real client IP
    // (X-Forwarded-For) is used for rate limiting instead of the proxy's address.
    this.app.set('trust proxy', 1);

    if (LOG_FORMAT !== 'disabled') {
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
