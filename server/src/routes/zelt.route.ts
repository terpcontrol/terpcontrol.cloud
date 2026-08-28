import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import { authMiddleware } from '@middlewares/auth.middleware';
import ZeltController from '@controllers/zelt.controller';

class ZeltRoute implements Routes {
  public path = '/api/zelte';
  public router = Router();
  public controller = new ZeltController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /api/zelte:
     *   get:
     *     summary: List the tents of the current user
     *     description: Returns every tent the logged-in user owns. An empty list is a valid answer - no tent is ever created implicitly.
     *     tags: [Zelte]
     *     responses:
     *       '200':
     *         description: The user's tents
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Zelt'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}`, authMiddleware, this.controller.getZelte);

    /**
     * @openapi
     * /api/zelte/{zelt_id}:
     *   get:
     *     summary: Get one tent
     *     tags: [Zelte]
     *     parameters:
     *       - in: path
     *         name: zelt_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: The tent
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Zelt'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         description: The tent belongs to somebody else
     */
    this.router.get(`${this.path}/:zelt_id`, this.controller.getZelt);
  }
}

export default ZeltRoute;
