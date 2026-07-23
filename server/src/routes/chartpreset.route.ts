import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import { authMiddleware } from '@/middlewares/auth.middleware';
import ChartPresetController from '@/controllers/chartpreset.controller';

class ChartPresetRoute implements Routes {
  public path = '/chartpresets';
  public router = Router();
  public controller = new ChartPresetController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /chartpresets:
     *   get:
     *     summary: List the current user's saved chart presets
     *     tags: [Chart presets]
     *     responses:
     *       '200':
     *         description: Chart presets (newest first)
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/ChartPreset'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}`, authMiddleware, this.controller.list);

    /**
     * @openapi
     * /chartpresets:
     *   post:
     *     summary: Save a chart view as a named preset
     *     description: Stores the serialized chart view (selected measures, timespan, interval, VPD mode) so it can be re-applied with one tap on any device's charts page.
     *     tags: [Chart presets]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name, query]
     *             properties:
     *               name: { type: string, maxLength: 60 }
     *               query:
     *                 type: string
     *                 maxLength: 2000
     *                 description: Query string capturing the chart view, in the same format as the charts page URL parameters.
     *               device_type:
     *                 type: string
     *                 description: Device type the preset was saved from; informational only.
     *     responses:
     *       '201':
     *         description: Created chart preset
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ChartPreset'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}`, authMiddleware, this.controller.create);

    /**
     * @openapi
     * /chartpresets/{preset_id}:
     *   delete:
     *     summary: Delete a saved chart preset
     *     tags: [Chart presets]
     *     parameters:
     *       - in: path
     *         name: preset_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Preset deleted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.delete(`${this.path}/:preset_id`, authMiddleware, this.controller.remove);
  }
}

export default ChartPresetRoute;
