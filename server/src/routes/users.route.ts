import { Router } from 'express';
import UsersController from '@controllers/users.controller';
import { CreateUserDto } from '@dtos/users.dto';
import { Routes } from '@interfaces/routes.interface';
import validationMiddleware from '@middlewares/validation.middleware';
import { authMiddleware, authAdminMiddleware } from '@/middlewares/auth.middleware';

class UsersRoute implements Routes {
  public path = '/users';
  public router = Router();
  public usersController = new UsersController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /users:
     *   get:
     *     summary: List all users (admin)
     *     tags: [Users]
     *     responses:
     *       '200':
     *         description: List of users
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/User'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}`, authAdminMiddleware, this.usersController.getUsers);

    /**
     * @openapi
     * /users/{id}:
     *   get:
     *     summary: Get a single user by id (admin)
     *     tags: [Users]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       '200':
     *         description: User
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   $ref: '#/components/schemas/User'
     *                 message:
     *                   type: string
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.get(`${this.path}/:id`, authAdminMiddleware, this.usersController.getUserById);

    /**
     * @openapi
     * /users:
     *   post:
     *     summary: Create a new user (admin)
     *     tags: [Users]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [username, password, is_admin]
     *             properties:
     *               username:
     *                 type: string
     *                 format: email
     *               password:
     *                 type: string
     *               is_admin:
     *                 type: boolean
     *     responses:
     *       '201':
     *         description: User created
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   $ref: '#/components/schemas/User'
     *                 message:
     *                   type: string
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}`, authAdminMiddleware, validationMiddleware(CreateUserDto, 'body'), this.usersController.createUser);

    /**
     * @openapi
     * /users/{id}:
     *   put:
     *     summary: Update an existing user (admin)
     *     tags: [Users]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               username:
     *                 type: string
     *                 format: email
     *               password:
     *                 type: string
     *               is_admin:
     *                 type: boolean
     *     responses:
     *       '200':
     *         description: User updated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   $ref: '#/components/schemas/User'
     *                 message:
     *                   type: string
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.put(`${this.path}/:id`, authAdminMiddleware, validationMiddleware(CreateUserDto, 'body', true), this.usersController.updateUser);

    /**
     * @openapi
     * /users/{id}:
     *   delete:
     *     summary: Delete a user (admin)
     *     tags: [Users]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       '200':
     *         description: User deleted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/MessageResponse'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.delete(`${this.path}/:id`, authAdminMiddleware, this.usersController.deleteUser);
  }
}

export default UsersRoute;
