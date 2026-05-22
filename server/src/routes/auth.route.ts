import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import AuthController from '@controllers/auth.controller';
import { LoginDto, SignupDto, ActivationDto, PasswordResetDto } from '@dtos/users.dto';
import { Routes } from '@interfaces/routes.interface';
import { authMiddleware } from '@middlewares/auth.middleware';
import validationMiddleware from '@middlewares/validation.middleware';

const tokenLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many token-login attempts, please try again later.' },
});

class AuthRoute implements Routes {
  public path = '/';
  public router = Router();
  public authController = new AuthController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /signup:
     *   post:
     *     summary: Sign up new user
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [username, password]
     *             properties:
     *               username:
     *                 type: string
     *                 format: email
     *                 description: Email address used as login name
     *               password:
     *                 type: string
     *     responses:
     *       '201':
     *         description: User created
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/MessageResponse'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     */
    this.router.post(`${this.path}signup`, validationMiddleware(SignupDto, 'body'), this.authController.signUp);

    /**
     * @openapi
     * /activate:
     *   post:
     *     summary: Activate a freshly signed-up user
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [activation_code]
     *             properties:
     *               activation_code:
     *                 type: string
     *                 description: Activation code delivered to the user's email address
     *     responses:
     *       '201':
     *         description: Account activated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/MessageResponse'
     */
    this.router.post(`${this.path}activate`, validationMiddleware(ActivationDto, 'body'), this.authController.activate);

    /**
     * @openapi
     * /login:
     *   post:
     *     summary: Log in with username and password
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [username, password]
     *             properties:
     *               username:
     *                 type: string
     *                 format: email
     *               password:
     *                 type: string
     *               stayLoggedIn:
     *                 type: boolean
     *     responses:
     *       '200':
     *         description: Token pair and user information
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/LoginResponse'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}login`, validationMiddleware(LoginDto, 'body'), this.authController.logIn);

    /**
     * @openapi
     * /tokenlogin:
     *   post:
     *     summary: Log in with a one-time token
     *     description: Exchanges a short-lived token (e.g. emailed magic link) for a user token. Rate limited to 20 requests/min per IP.
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [token]
     *             properties:
     *               token:
     *                 type: string
     *     responses:
     *       '200':
     *         description: New user token
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 userToken:
     *                   type: object
     *                   properties:
     *                     token: { type: string }
     *                     expiresIn: { type: integer }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '429':
     *         description: Rate limit exceeded
     */
    this.router.post(`${this.path}tokenlogin`, tokenLoginLimiter, this.authController.loginWithToken);

    /**
     * @openapi
     * /refresh:
     *   post:
     *     summary: Refresh user/refresh tokens
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [token]
     *             properties:
     *               token:
     *                 type: string
     *                 description: Valid refresh token previously issued by /login
     *     responses:
     *       '200':
     *         description: New token pair
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/TokenPair'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '404':
     *         description: Authentication token missing
     */
    this.router.post(`${this.path}refresh`, this.authController.refresh);

    /**
     * @openapi
     * /getreset:
     *   post:
     *     summary: Request a password reset token
     *     description: Sends a password reset email to the given username, if it exists. Always responds 201 to avoid leaking account presence.
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [username, password]
     *             properties:
     *               username:
     *                 type: string
     *                 format: email
     *               password:
     *                 type: string
     *                 description: Unused, may be empty
     *     responses:
     *       '201':
     *         description: Reset email sent (if account exists)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/MessageResponse'
     */
    this.router.post(`${this.path}getreset`, validationMiddleware(LoginDto, 'body'), this.authController.getPasswordToken);

    /**
     * @openapi
     * /reset:
     *   post:
     *     summary: Reset password using a reset token
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [token, password]
     *             properties:
     *               token:
     *                 type: string
     *                 description: Token from the password reset email
     *               password:
     *                 type: string
     *                 description: New password
     *     responses:
     *       '200':
     *         description: Password changed
     */
    this.router.post(`${this.path}reset`, validationMiddleware(PasswordResetDto, 'body'), this.authController.resetPassword);

    /**
     * @openapi
     * /logout:
     *   post:
     *     summary: Log out the current user
     *     description: Clears the `Authorization` cookie. The bearer token itself remains valid until it expires.
     *     tags: [Auth]
     *     responses:
     *       '200':
     *         description: Logged out
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}logout`, authMiddleware, this.authController.logOut);

    /**
     * @openapi
     * /changepass:
     *   post:
     *     summary: Change the current user's password
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [username, password]
     *             properties:
     *               username:
     *                 type: string
     *                 format: email
     *               password:
     *                 type: string
     *                 description: New password
     *     responses:
     *       '200':
     *         description: Password changed
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}changepass`, authMiddleware, validationMiddleware(LoginDto), this.authController.changePassword);
  }
}

export default AuthRoute;
