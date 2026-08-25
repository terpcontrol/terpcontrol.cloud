import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import DingController from '@controllers/ding.controller';

/**
 * No Express middleware guards these routes, and that is deliberate: a request
 * may carry a session, a share link, a per-Zelt read key or a club write key,
 * and which of them is enough depends on the handler. Every handler therefore
 * calls `darfLesen`/`darfSchreiben` on its first line, and the route table test
 * is what proves none of them forgot.
 */
class DingRoute implements Routes {
  public path = '/api/dinge';
  public router = Router();
  public controller = new DingController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /api/dinge:
     *   get:
     *     summary: One page of a tent's Dinge
     *     description: >
     *       Every row the app shows, stored and projected merged into one list and paginated by a cursor.
     *       Point Dinge are in the window when they happened in it; a Ding with `t_ende` is in it when it overlaps it.
     *       Readable by the tent's owner, a share link on a device it binds, the tent's read key (`x-api-key`) or a club key (`k`).
     *     tags: [Dinge]
     *     parameters:
     *       - in: query
     *         name: zelt_id
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: art
     *         description: Comma-separated list of arts. Omitted means every art.
     *         schema: { type: string }
     *       - in: query
     *         name: von
     *         schema: { type: integer, description: 'Epoch ms, inclusive' }
     *       - in: query
     *         name: bis
     *         schema: { type: integer, description: 'Epoch ms, inclusive' }
     *       - in: query
     *         name: cursor
     *         description: Opaque, from the previous page. Absent from the last page.
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, minimum: 1, maximum: 500, default: 100 }
     *     responses:
     *       '200':
     *         description: One page
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DingeSeite'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.get(`${this.path}`, this.controller.getDinge);

    /**
     * @openapi
     * /api/dinge/stapel:
     *   post:
     *     summary: Drain an offline queue
     *     description: >
     *       Upserts every Ding on its own `ding_id` and answers one result per item.
     *       Partial success is normal: an item that will not validate is reported in its own result and the rest are written.
     *     tags: [Dinge]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               dinge:
     *                 type: array
     *                 items: { $ref: '#/components/schemas/Ding' }
     *     responses:
     *       '200':
     *         description: One result per submitted Ding
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ergebnisse:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       ding_id: { type: string, nullable: true }
     *                       ok: { type: boolean }
     *                       ding: { $ref: '#/components/schemas/Ding' }
     *                       problems: { type: array, items: { $ref: '#/components/schemas/DingProblem' } }
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.post(`${this.path}/stapel`, this.controller.postStapel);

    /**
     * @openapi
     * /api/dinge:
     *   post:
     *     summary: Write a Ding
     *     description: >
     *       Upserts on the client-minted `ding_id`, so a retry over a bad connection cannot log the same watering twice.
     *       `erfasst_at` is stamped by the server. A projected art is refused - it is read out of data that already exists.
     *       A club key may write only the arts in `SCHLUESSEL_ARTEN`, and its Dinge are attributed to the key's person.
     *     tags: [Dinge]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/Ding'
     *     responses:
     *       '200':
     *         description: The stored Ding
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ding: { $ref: '#/components/schemas/Ding' }
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.post(`${this.path}`, this.controller.postDing);

    /**
     * @openapi
     * /api/dinge/{ding_id}:
     *   patch:
     *     summary: Close or supersede a Ding
     *     description: >
     *       Changes `t_ende`, `storniert_von`, `d.geschlossen_von` and `d.dublette_von`, and nothing else.
     *       A value is corrected by writing a new Ding that supersedes this one, never by editing it.
     *     tags: [Dinge]
     *     parameters:
     *       - in: path
     *         name: ding_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               t_ende: { type: integer, nullable: true }
     *               storniert_von: { type: string }
     *               d:
     *                 type: object
     *                 properties:
     *                   geschlossen_von: { type: string }
     *                   dublette_von: { type: string }
     *     responses:
     *       '200':
     *         description: The changed Ding
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ding: { $ref: '#/components/schemas/Ding' }
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.patch(`${this.path}/:ding_id`, this.controller.patchDing);
  }
}

export default DingRoute;
