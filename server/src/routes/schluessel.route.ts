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
  /** A club key is revoked by its own id, which names no tent - §15.3 puts it at the top level for that reason. */
  public schluesselPath = '/api/schluessel';
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
     * /api/zelte/{zelt_id}/zugangsschluessel:
     *   delete:
     *     summary: Turn the tent's read key off
     *     description: >
     *       Leaves the Zelt with no read key at all. Owner only.
     *       Rotation replaces a key and can never remove one, so this is the only way to stop a key that was pasted somewhere it should not have been.
     *     tags: [Zelte]
     *     parameters:
     *       - in: path
     *         name: zelt_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Whether a key was there to remove
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 geloescht: { type: boolean }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.delete(`${this.path}/:zelt_id/zugangsschluessel`, this.controller.deleteZugangsschluessel);

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
     *       '409':
     *         description: The Zelt already holds as many live keys as it may - revoke one first
     */
    this.router.post(`${this.path}/:zelt_id/schluessel`, this.controller.postSchluessel);

    /**
     * @openapi
     * /api/zelte/{zelt_id}/schluessel:
     *   get:
     *     summary: The club keys of this Zelt
     *     description: >
     *       Which keys exist, for whom, when they were last used and whether they were revoked. Owner only.
     *       Never a token and never a hash - a key is shown once, at the moment it is minted.
     *     tags: [Zelte]
     *     parameters:
     *       - in: path
     *         name: zelt_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Every key of this Zelt, revoked ones included, newest first
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 schluessel:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       schluessel_id: { type: string }
     *                       mensch_ding_id: { type: string }
     *                       erstellt_at: { type: integer }
     *                       zuletzt_at: { type: integer, nullable: true }
     *                       widerrufen_at: { type: integer, nullable: true }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.get(`${this.path}/:zelt_id/schluessel`, this.controller.getSchluessel);

    /**
     * @openapi
     * /api/schluessel/{schluessel_id}:
     *   delete:
     *     summary: Revoke a club key
     *     description: >
     *       Stops the key immediately. Owner of the key's Zelt only, and an id that belongs to no key is refused
     *       rather than reported missing - a 404 would tell whoever asks which ids exist.
     *     tags: [Zelte]
     *     parameters:
     *       - in: path
     *         name: schluessel_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: The key is revoked
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 schluessel_id: { type: string }
     *                 widerrufen_at: { type: integer }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     */
    this.router.delete(`${this.schluesselPath}/:schluessel_id`, this.controller.deleteSchluessel);
  }
}

export default SchluesselRoute;
