import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import DataController from '@/controllers/data.controller';

class DataRoute implements Routes {
  public path = '/data';
  public router = Router();
  public controller = new DataController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /data/series/{device_id}/{measure}:
     *   get:
     *     summary: Get aggregated time-series data for a measurement
     *     description: Returns aggregated series points for the given device and measurement. Works for owned devices and through a valid share link (`share` query parameter or `X-Share-Token` header).
     *     tags: [Data]
     *     security:
     *       - bearerAuth: []
     *       - {}
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: measure
     *         required: true
     *         schema: { type: string }
     *         description: The InfluxDB field name to query (e.g. `temperature`).
     *       - in: query
     *         name: from
     *         schema: { type: string }
     *         description: Flux time expression for the start of the range (e.g. `-1d`).
     *       - in: query
     *         name: to
     *         schema: { type: string }
     *         description: Flux time expression for the end of the range (e.g. `now()`).
     *       - in: query
     *         name: interval
     *         schema: { type: string }
     *         description: Aggregation bucket size (e.g. `10s`, `5m`).
     *       - in: query
     *         name: method
     *         schema: { type: string }
     *         description: Aggregation function (e.g. `mean`, `last`).
     *     responses:
     *       '201':
     *         description: Series points
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/SeriesPoint'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/series/:device_id/:measure`, this.controller.getSeries);

    /**
     * @openapi
     * /data/latest/{device_id}/{measure}:
     *   get:
     *     summary: Get the latest value of a measurement
     *     description: Returns the most recent value for the given device and measurement. Works for owned devices and through a valid share link (`share` query parameter or `X-Share-Token` header).
     *     tags: [Data]
     *     security:
     *       - bearerAuth: []
     *       - {}
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: measure
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '201':
     *         description: Latest value
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/LatestValue'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/latest/:device_id/:measure`, this.controller.getLatest);
  }
}

export default DataRoute;
