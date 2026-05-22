import { Router } from 'express';
import IndexController from '@controllers/index.controller';
import { Routes } from '@interfaces/routes.interface';

class IndexRoute implements Routes {
  public path = '/';
  public router = Router();
  public indexController = new IndexController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /:
     *   get:
     *     summary: Health check
     *     description: Returns 200 if the API process is running.
     *     tags: [Index]
     *     security: []
     *     responses:
     *       '200':
     *         description: OK
     */
    this.router.get(`${this.path}`, this.indexController.index);

    /**
     * @openapi
     * /readycheck:
     *   get:
     *     summary: Readiness check
     *     description: Returns 200 once the database connection is ready and the admin user is provisioned. Returns 501 otherwise.
     *     tags: [Index]
     *     security: []
     *     responses:
     *       '200':
     *         description: Ready
     *       '501':
     *         description: Not ready
     */
    this.router.get('/readycheck', this.indexController.readycheck);
  }
}

export default IndexRoute;
