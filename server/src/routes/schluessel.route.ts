import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import SchluesselController from '@controllers/schluessel.controller';

/**
 * The two keys that reach a Zelt without an account. They sit under `/api/zelte`
 * with the tent they belong to, but in their own route: handing out a credential
 * is not tent bookkeeping, and keeping it apart is what lets it be exercised
 * without dragging in the device half of the server.
 */
class SchluesselRoute implements Routes {
  public path = '/api/zelte';
  public router = Router();
  public controller = new SchluesselController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /api/zelte/{zelt_id}/zugangsschluessel:
     *   post:
     *     summary: Mint or rotate the tent's read key
     *     description: >
     *       The per-Zelt `x-api-key` accepted on the read endpoints and the export. Owner only.
     *       The token is returned once and only its hash is stored; minting again rotates, and the previous token stops working.
     *     tags: [Zelte]
     *     parameters:
     *       - in: path
     *         name: zelt_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: The new key, shown once
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 token: { type: string }
     *                 erstellt_at: { type: integer }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.post(`${this.path}/:zelt_id/zugangsschluessel`, this.controller.postZugangsschluessel);

    /**
     * @openapi
     * /api/zelte/{zelt_id}/schluessel:
     *   post:
     *     summary: Mint a club write key for one person
     *     description: >
     *       Lets a member write Gaben, Notizen and Zustände in this tent without an account. Owner only.
     *       Every Ding the key writes is attributed to its `mensch_ding_id`, which is why a body may never carry `akteur`.
     *     tags: [Zelte]
     *     parameters:
     *       - in: path
     *         name: zelt_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               mensch_ding_id: { type: string, description: 'ding_id of a mensch in this Zelt' }
     *     responses:
     *       '200':
     *         description: The new key, shown once
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 schluessel_id: { type: string }
     *                 token: { type: string }
     *                 url: { type: string }
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.post(`${this.path}/:zelt_id/schluessel`, this.controller.postSchluessel);
  }
}

export default SchluesselRoute;
