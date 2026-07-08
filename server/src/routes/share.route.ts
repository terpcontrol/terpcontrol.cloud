import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import { authMiddleware } from '@/middlewares/auth.middleware';
import ShareController from '@/controllers/share.controller';

class ShareRoute implements Routes {
  public path = '/share';
  public router = Router();
  public controller = new ShareController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /share/resolve/{share_id}:
     *   get:
     *     summary: Resolve a share link
     *     description: Validates a share link and returns the shared device's access info. Increments the link's open counter. Public endpoint used when a shared page is opened.
     *     tags: [Shares]
     *     security: []
     *     parameters:
     *       - in: path
     *         name: share_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Device access info for the shared page
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DeviceAccessInfo'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.get(`${this.path}/resolve/:share_id`, this.controller.resolve);

    /**
     * @openapi
     * /share:
     *   get:
     *     summary: List the current user's share links
     *     tags: [Shares]
     *     responses:
     *       '200':
     *         description: Share links (newest first)
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/ShareLink'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}`, authMiddleware, this.controller.list);

    /**
     * @openapi
     * /share:
     *   post:
     *     summary: Create a share link for a device page
     *     description: Creates a link that grants read access to the chosen page (charts or diary) of an owned device. Anyone with the link can open the page without an account.
     *     tags: [Shares]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id, page]
     *             properties:
     *               device_id: { type: string }
     *               page: { type: string, enum: [charts, diary] }
     *               editable:
     *                 type: boolean
     *                 description: Whether visitors may change the view (time frame, measures, filters, webcam).
     *               webcam:
     *                 type: boolean
     *                 description: Whether webcam images are included in a view-only link.
     *               valid_days:
     *                 type: number
     *                 nullable: true
     *                 description: Days until the link expires. Omit or null for a link that never expires.
     *     responses:
     *       '201':
     *         description: Created share link
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ShareLink'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}`, authMiddleware, this.controller.create);

    /**
     * @openapi
     * /share/{share_id}/revoke:
     *   post:
     *     summary: Revoke a share link
     *     description: Immediately invalidates the link. Revoked links remain listed until deleted.
     *     tags: [Shares]
     *     parameters:
     *       - in: path
     *         name: share_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: The revoked share link
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ShareLink'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.post(`${this.path}/:share_id/revoke`, authMiddleware, this.controller.revoke);

    /**
     * @openapi
     * /share/inactive:
     *   delete:
     *     summary: Delete all expired and revoked share links
     *     tags: [Shares]
     *     responses:
     *       '200':
     *         description: Inactive links deleted
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 status: { type: string, example: ok }
     *                 deleted: { type: integer }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.delete(`${this.path}/inactive`, authMiddleware, this.controller.removeInactive);

    /**
     * @openapi
     * /share/{share_id}:
     *   delete:
     *     summary: Delete an expired or revoked share link
     *     description: Only inactive links can be deleted; active links must be revoked first.
     *     tags: [Shares]
     *     parameters:
     *       - in: path
     *         name: share_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Link deleted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.delete(`${this.path}/:share_id`, authMiddleware, this.controller.remove);
  }
}

export default ShareRoute;
