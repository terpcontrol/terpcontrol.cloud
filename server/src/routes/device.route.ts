import { Router } from 'express';
import DeviceController from '@controllers/device.controller';
import { Routes } from '@interfaces/routes.interface';
import validationMiddleware from '@/middlewares/validation.middleware';
import {
  AddDeviceDto,
  ClaimDeviceDto,
  ConfigureDeviceDto,
  AddDeviceFirmwareDto,
  AddDeviceClassDto,
  TestDeviceDto,
  SetNameDto,
  RegisterDeviceDto,
} from '@dtos/device.dto';
import { authMiddleware, authAdminMiddleware } from '@/middlewares/auth.middleware';

class DeviceRoute implements Routes {
  public path = '/device';
  public router = Router();
  public deviceController = new DeviceController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /device/all:
     *   get:
     *     summary: List every device in the system (admin)
     *     tags: [Devices]
     *     responses:
     *       '200':
     *         description: All devices
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Device'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/all`, authAdminMiddleware, this.deviceController.getDevices);

    /**
     * @openapi
     * /device/create:
     *   post:
     *     summary: Provision a new device record (admin)
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [class_id, device_type]
     *             properties:
     *               class_id: { type: string }
     *               device_type: { type: string }
     *     responses:
     *       '201':
     *         description: Created device
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Device'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/create`, authAdminMiddleware, validationMiddleware(AddDeviceDto, 'body'), this.deviceController.create);

    /**
     * @openapi
     * /device/register:
     *   post:
     *     summary: Self-registration endpoint for a new device
     *     description: Used by a freshly provisioned device to register itself against the server. Requires the shared `SELF_REGISTRATION_PASSWORD`.
     *     tags: [Devices]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [registration_password, device_id, username, password, device_type]
     *             properties:
     *               registration_password: { type: string }
     *               device_id: { type: string }
     *               username: { type: string }
     *               password: { type: string }
     *               device_type: { type: string }
     *     responses:
     *       '201':
     *         description: Device registered
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Device'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/register`, validationMiddleware(RegisterDeviceDto, 'body'), this.deviceController.register);

    /**
     * @openapi
     * /device:
     *   get:
     *     summary: List the current user's devices
     *     tags: [Devices]
     *     responses:
     *       '200':
     *         description: Devices linked to the current user
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Device'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}`, authMiddleware, this.deviceController.getUserDevices);

    /**
     * @openapi
     * /device:
     *   post:
     *     summary: Claim a device with a claim code
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [claim_code]
     *             properties:
     *               claim_code:
     *                 type: string
     *                 description: Code displayed on the device screen during pairing.
     *     responses:
     *       '200':
     *         description: Device claimed
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '400':
     *         description: Invalid claim code or device not found
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}`, authMiddleware, validationMiddleware(ClaimDeviceDto, 'body'), this.deviceController.claimDevice);

    /**
     * @openapi
     * /device/{device_id}:
     *   delete:
     *     summary: Unlink a device from the current user
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Device unlinked
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.delete(`${this.path}/:device_id`, authMiddleware, this.deviceController.unClaimDevice);

    /**
     * @openapi
     * /device/configure:
     *   post:
     *     summary: Set device configuration
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id, configuration]
     *             properties:
     *               device_id: { type: string }
     *               configuration:
     *                 type: string
     *                 description: Stringified JSON configuration blob delivered to the device.
     *     responses:
     *       '200':
     *         description: Configuration applied
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(
      `${this.path}/configure`,
      authMiddleware,
      validationMiddleware(ConfigureDeviceDto, 'body'),
      this.deviceController.configureDevice,
    );

    /**
     * @openapi
     * /device/alarms:
     *   post:
     *     summary: Replace the alarm definitions for a device
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id, alarms]
     *             properties:
     *               device_id: { type: string }
     *               alarms:
     *                 type: array
     *                 items:
     *                   $ref: '#/components/schemas/Alarm'
     *     responses:
     *       '200':
     *         description: Alarms saved
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/alarms`, authMiddleware, this.deviceController.setDeviceAlarms);

    /**
     * @openapi
     * /device/cloudsettings:
     *   post:
     *     summary: Update a device's cloud settings
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id, cloud_settings]
     *             properties:
     *               device_id: { type: string }
     *               cloud_settings:
     *                 $ref: '#/components/schemas/CloudSettings'
     *     responses:
     *       '200':
     *         description: Cloud settings saved
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/cloudsettings`, authMiddleware, this.deviceController.setDeviceCloudSettings);

    /**
     * @openapi
     * /device/setname:
     *   post:
     *     summary: Set the display name for a device
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id, name]
     *             properties:
     *               device_id: { type: string }
     *               name: { type: string }
     *     responses:
     *       '200':
     *         description: Name updated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/setname`, authMiddleware, validationMiddleware(SetNameDto, 'body'), this.deviceController.setDeviceName);

    /**
     * @openapi
     * /device/config/{device_id}:
     *   get:
     *     summary: Get the current device configuration
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Configuration blob (stringified JSON or object)
     *         content:
     *           application/json:
     *             schema:
     *               oneOf:
     *                 - type: string
     *                 - type: object
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/config/:device_id`, authMiddleware, this.deviceController.getDeviceConfig);

    /**
     * @openapi
     * /device/alarms/{device_id}:
     *   get:
     *     summary: Get a device's alarm definitions
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Alarms
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Alarm'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/alarms/:device_id`, authMiddleware, this.deviceController.getDeviceAlarms);

    /**
     * @openapi
     * /device/cloudsettings/{device_id}:
     *   get:
     *     summary: Get device access info and cloud settings
     *     description: Returns a unified payload with device metadata and the effective cloud settings. Owner only; share-link visitors use `/share/resolve/{share_id}` instead.
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Device access information
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DeviceAccessInfo'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.get(`${this.path}/cloudsettings/:device_id`, this.deviceController.getDeviceCloudSettings);

    /**
     * @openapi
     * /device/recipe/{device_id}:
     *   get:
     *     summary: Get the recipe currently assigned to a device
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Recipe payload (defaults to an empty recipe)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Recipe'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/recipe/:device_id`, authMiddleware, this.deviceController.getRecipe);

    /**
     * @openapi
     * /device/recipe:
     *   post:
     *     summary: Set the active recipe for a device
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id, recipe]
     *             properties:
     *               device_id: { type: string }
     *               recipe:
     *                 $ref: '#/components/schemas/Recipe'
     *     responses:
     *       '200':
     *         description: Recipe stored
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.post(`${this.path}/recipe`, authMiddleware, this.deviceController.setRecipe);

    /**
     * @openapi
     * /device/recipes:
     *   get:
     *     summary: List recipe templates visible to the user
     *     description: Returns templates marked as public plus templates owned by the current user.
     *     tags: [Devices]
     *     responses:
     *       '200':
     *         description: Recipe templates
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/RecipeTemplate'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/recipes`, authMiddleware, this.deviceController.listRecipes);

    /**
     * @openapi
     * /device/recipes:
     *   post:
     *     summary: Create a new recipe template
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name, steps]
     *             properties:
     *               name: { type: string }
     *               public: { type: boolean }
     *               steps:
     *                 type: array
     *                 items:
     *                   $ref: '#/components/schemas/RecipeStep'
     *     responses:
     *       '201':
     *         description: Template created
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/RecipeTemplate'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '409':
     *         description: Template name already exists
     */
    this.router.post(`${this.path}/recipes`, authMiddleware, this.deviceController.createRecipeTemplate);

    /**
     * @openapi
     * /device/recipes/{template_id}:
     *   get:
     *     summary: Get a single recipe template
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: template_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Template
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/RecipeTemplate'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.get(`${this.path}/recipes/:template_id`, authMiddleware, this.deviceController.getRecipeTemplate);

    /**
     * @openapi
     * /device/recipes/{template_id}:
     *   put:
     *     summary: Update a recipe template
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: template_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name: { type: string }
     *               public: { type: boolean }
     *               steps:
     *                 type: array
     *                 items:
     *                   $ref: '#/components/schemas/RecipeStep'
     *     responses:
     *       '200':
     *         description: Template updated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/RecipeTemplate'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     *       '409':
     *         description: Template name already exists
     */
    this.router.put(`${this.path}/recipes/:template_id`, authMiddleware, this.deviceController.updateRecipeTemplate);

    /**
     * @openapi
     * /device/recipes/{template_id}:
     *   delete:
     *     summary: Delete a recipe template
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: template_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Template deleted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '403':
     *         $ref: '#/components/responses/Forbidden'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.delete(`${this.path}/recipes/:template_id`, authMiddleware, this.deviceController.deleteRecipeTemplate);

    /**
     * @openapi
     * /device/claimcode:
     *   post:
     *     summary: Get a claim code for a device
     *     description: Used by the device itself to obtain a fresh claim code that the user can enter in the app to pair the device.
     *     tags: [Devices]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id, password]
     *             properties:
     *               device_id: { type: string }
     *               password: { type: string }
     *     responses:
     *       '200':
     *         description: Claim code
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ClaimCode'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/claimcode`, this.deviceController.getClaimCode);

    /**
     * @openapi
     * /auth/v0.0.1/device/claimcode:
     *   post:
     *     summary: Legacy alias for /device/claimcode
     *     description: Deprecated alias kept for older firmware. Same payload as `/device/claimcode`.
     *     deprecated: true
     *     tags: [Devices]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               device_id: { type: string }
     *               password: { type: string }
     *     responses:
     *       '200':
     *         description: Claim code
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ClaimCode'
     */
    this.router.post(`/auth/v0.0.1/device/claimcode`, this.deviceController.getClaimCode);

    /**
     * @openapi
     * /device/firmware:
     *   get:
     *     summary: List firmware images (admin)
     *     tags: [Devices]
     *     responses:
     *       '200':
     *         description: Firmware images
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/DeviceFirmware'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/firmware`, authAdminMiddleware, this.deviceController.listFirmware);

    /**
     * @openapi
     * /device/firmwares/{device_id}:
     *   get:
     *     summary: List firmware versions available for a device (owner)
     *     description: Returns firmware versions available for the device's class, tagged with which channels (stable/beta/alpha) they currently represent and which one is the device's current firmware.
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Firmware list for the device
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 current_firmware: { type: string }
     *                 firmwares:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       firmware_id: { type: string }
     *                       version: { type: string }
     *                       channels:
     *                         type: array
     *                         items: { type: string, enum: [stable, beta, alpha, manual] }
     *                       current: { type: boolean }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.get(`${this.path}/firmwares/:device_id`, authMiddleware, this.deviceController.listFirmwaresForDevice);

    /**
     * @openapi
     * /device/firmware/find:
     *   get:
     *     summary: Find a firmware image by name and version (admin)
     *     tags: [Devices]
     *     parameters:
     *       - in: query
     *         name: name
     *         schema: { type: string }
     *       - in: query
     *         name: version
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Firmware image
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DeviceFirmware'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.get(`${this.path}/firmware/find`, authAdminMiddleware, this.deviceController.findFirmware);

    /**
     * @openapi
     * /device/firmware/{firmware_id}/{binary}:
     *   get:
     *     summary: Download a firmware binary
     *     description: Returns the raw firmware binary as `application/octet-stream`. Used by devices during OTA updates.
     *     tags: [Devices]
     *     security: []
     *     parameters:
     *       - in: path
     *         name: firmware_id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: binary
     *         required: true
     *         schema: { type: string }
     *         description: Binary identifier within the firmware bundle (e.g. `firmware.bin`).
     *     responses:
     *       '200':
     *         description: Firmware binary
     *         content:
     *           application/octet-stream:
     *             schema: { type: string, format: binary }
     */
    this.router.get(`${this.path}/firmware/:firmware_id/:binary`, this.deviceController.getFirmware);

    /**
     * @openapi
     * /device/firmware/{firmware_id}:
     *   delete:
     *     summary: Delete a firmware image (admin)
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: firmware_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Firmware deleted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.delete(`${this.path}/firmware/:firmware_id`, authAdminMiddleware, this.deviceController.deleteFirmware);

    /**
     * @openapi
     * /device/firmware/{firmware_id}:
     *   put:
     *     summary: Update a firmware record's version (admin)
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: firmware_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [version]
     *             properties:
     *               version: { type: string }
     *     responses:
     *       '200':
     *         description: Firmware updated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DeviceFirmware'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.put(`${this.path}/firmware/:firmware_id`, authAdminMiddleware, this.deviceController.updateFirmware);

    /**
     * @openapi
     * /auth/v0.0.1/device/firmware/{firmware_id}/{binary}:
     *   get:
     *     summary: Legacy alias for the firmware download endpoint
     *     deprecated: true
     *     tags: [Devices]
     *     security: []
     *     parameters:
     *       - in: path
     *         name: firmware_id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: binary
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Firmware binary
     *         content:
     *           application/octet-stream:
     *             schema: { type: string, format: binary }
     */
    this.router.get(`/auth/v0.0.1/device/firmware/:firmware_id/:binary`, this.deviceController.getFirmware);

    /**
     * @openapi
     * /device/firmware/{firmware_id}/{binary}:
     *   post:
     *     summary: Upload a firmware binary (admin)
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: firmware_id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: binary
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         multipart/form-data:
     *           schema:
     *             type: object
     *             required: [binary]
     *             properties:
     *               binary:
     *                 type: string
     *                 format: binary
     *     responses:
     *       '200':
     *         description: Binary stored
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 firmware_id: { type: string }
     *                 name: { type: string }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/firmware/:firmware_id/:binary`, authAdminMiddleware, this.deviceController.createFirmwareBinary);

    /**
     * @openapi
     * /device/firmware:
     *   post:
     *     summary: Create a firmware record (admin)
     *     description: Registers a new firmware image, before its binary payload is uploaded via `/device/firmware/{firmware_id}/{binary}`.
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name, version]
     *             properties:
     *               name: { type: string }
     *               version: { type: string }
     *     responses:
     *       '200':
     *         description: Firmware record created
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DeviceFirmware'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(
      `${this.path}/firmware`,
      authAdminMiddleware,
      validationMiddleware(AddDeviceFirmwareDto, 'body'),
      this.deviceController.createFirmware,
    );

    /**
     * @openapi
     * /device/class:
     *   get:
     *     summary: List all device classes (admin)
     *     tags: [Devices]
     *     responses:
     *       '200':
     *         description: Device classes
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/DeviceClass'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/class`, authAdminMiddleware, this.deviceController.listClasses);

    /**
     * @openapi
     * /device/class/find/{class_name}:
     *   get:
     *     summary: Find a device class by name (admin)
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: class_name
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Device class
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DeviceClass'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.get(`${this.path}/class/find/:class_name`, authAdminMiddleware, this.deviceController.findClass);

    /**
     * @openapi
     * /device/class/{class_id}:
     *   get:
     *     summary: Get a device class by id (admin)
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: class_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Device class
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DeviceClass'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/class/:class_id`, authAdminMiddleware, this.deviceController.getClass);

    /**
     * @openapi
     * /device/class:
     *   post:
     *     summary: Create a new device class (admin)
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name, description, firmware_id, concurrent, maxfails]
     *             properties:
     *               name: { type: string }
     *               description: { type: string }
     *               firmware_id: { type: string }
     *               concurrent: { type: integer }
     *               maxfails: { type: integer }
     *               beta_firmware_id: { type: string }
     *               alpha_firmware_id: { type: string }
     *     responses:
     *       '200':
     *         description: Class created
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/class`, authAdminMiddleware, validationMiddleware(AddDeviceClassDto, 'body'), this.deviceController.createClass);

    /**
     * @openapi
     * /device/class/{class_id}:
     *   post:
     *     summary: Update a device class (admin)
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: class_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name: { type: string }
     *               description: { type: string }
     *               firmware_id: { type: string }
     *               concurrent: { type: integer }
     *               maxfails: { type: integer }
     *               beta_firmware_id: { type: string }
     *               alpha_firmware_id: { type: string }
     *     responses:
     *       '200':
     *         description: Class updated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(
      `${this.path}/class/:class_id`,
      authAdminMiddleware,
      validationMiddleware(AddDeviceClassDto, 'body'),
      this.deviceController.updateClass,
    );

    /**
     * @openapi
     * /device/test/{device_id}:
     *   post:
     *     summary: Activate test mode and set outputs
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [heater, dehumidifier, co2, lights, fanint, fanext, fanbw]
     *             properties:
     *               heater: { type: integer }
     *               dehumidifier: { type: integer }
     *               co2: { type: integer }
     *               lights: { type: integer }
     *               fanint: { type: integer }
     *               fanext: { type: integer }
     *               fanbw: { type: integer }
     *     responses:
     *       '200':
     *         description: Test mode active
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/test/:device_id`, authMiddleware, validationMiddleware(TestDeviceDto, 'body'), this.deviceController.testMode);

    /**
     * @openapi
     * /device/test/{device_id}:
     *   delete:
     *     summary: Stop device test mode
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Test mode stopped
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.delete(`${this.path}/test/:device_id`, authMiddleware, this.deviceController.stopTest);

    /**
     * @openapi
     * /device/logs/{device_id}:
     *   get:
     *     summary: Get device log entries
     *     description: Returns log entries for owned devices and for devices opened through a valid share link (`share` query parameter or `X-Share-Token` header).
     *     tags: [Devices]
     *     security:
     *       - bearerAuth: []
     *       - {}
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: from
     *         schema: { type: number }
     *         description: Unix timestamp (seconds) to start from.
     *       - in: query
     *         name: to
     *         schema: { type: number }
     *       - in: query
     *         name: deleted
     *         schema: { type: boolean }
     *         description: Include soft-deleted entries.
     *       - in: query
     *         name: categories
     *         schema: { type: string }
     *         description: Comma-separated list of categories to filter on.
     *     responses:
     *       '200':
     *         description: Device log entries
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/DeviceLog'
     */
    this.router.get(`${this.path}/logs/:device_id`, this.deviceController.getDeviceLogs);

    /**
     * @openapi
     * /device/logs/{device_id}:
     *   delete:
     *     summary: Clear all log entries for a device
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Logs cleared
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.delete(`${this.path}/logs/:device_id`, authMiddleware, this.deviceController.deleteDeviceLogs);

    /**
     * @openapi
     * /device/logs/{device_id}/{log_id}:
     *   delete:
     *     summary: Delete a single log entry
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: log_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Log entry deleted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.delete(`${this.path}/logs/:device_id/:log_id`, authMiddleware, this.deviceController.deleteDeviceLog);

    /**
     * @openapi
     * /device/logs/{device_id}:
     *   post:
     *     summary: Add a manual diary/log entry to a device
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [severity, categories, time]
     *             properties:
     *               title: { type: string }
     *               message: { type: string }
     *               severity: { type: integer }
     *               categories:
     *                 type: array
     *                 items: { type: string }
     *               time: { type: string, format: date-time }
     *               data: { type: object }
     *               images:
     *                 type: array
     *                 items: { type: string }
     *     responses:
     *       '200':
     *         description: Log entry stored
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/logs/:device_id`, authMiddleware, this.deviceController.addDeviceLog);

    /**
     * @openapi
     * /device/logs/{device_id}/{log_id}:
     *   put:
     *     summary: Update an existing log entry
     *     tags: [Devices]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: log_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               title: { type: string }
     *               message: { type: string }
     *               severity: { type: integer }
     *               categories:
     *                 type: array
     *                 items: { type: string }
     *               data: { type: object }
     *               images:
     *                 type: array
     *                 items: { type: string }
     *     responses:
     *       '200':
     *         description: Log entry updated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.put(`${this.path}/logs/:device_id/:log_id`, authMiddleware, this.deviceController.updateDeviceLog);

    /**
     * @openapi
     * /device/byserial:
     *   get:
     *     summary: Find a device by serial number (admin)
     *     tags: [Devices]
     *     parameters:
     *       - in: query
     *         name: serialnumber
     *         required: true
     *         schema: { type: integer }
     *     responses:
     *       '200':
     *         description: Device
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Device'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/byserial`, authAdminMiddleware, this.deviceController.getDeviceBySerial);

    /**
     * @openapi
     * /device/maintenancemode:
     *   post:
     *     summary: Activate maintenance mode for a device
     *     description: Suppresses alarms and webcam recording for a limited window.
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id]
     *             properties:
     *               device_id: { type: string }
     *               duration_minutes:
     *                 type: integer
     *                 description: Minutes the maintenance window should last. Defaults to 0 (off).
     *     responses:
     *       '200':
     *         description: Maintenance mode set
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/maintenancemode`, authMiddleware, this.deviceController.activateMaintenanceMode);

    /**
     * @openapi
     * /device/reboot:
     *   post:
     *     summary: Reboot a device
     *     description: Sends a command instructing the device to restart immediately.
     *     tags: [Devices]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [device_id]
     *             properties:
     *               device_id: { type: string }
     *     responses:
     *       '200':
     *         description: Reboot command sent
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/reboot`, authMiddleware, this.deviceController.rebootDevice);

    /**
     * @openapi
     * /device/onlinedevices:
     *   get:
     *     summary: List currently online devices (admin)
     *     tags: [Devices]
     *     responses:
     *       '200':
     *         description: Online devices
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Device'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/onlinedevices`, authAdminMiddleware, this.deviceController.getOnlineDevices);

    /**
     * @openapi
     * /device/firmwareversions:
     *   get:
     *     summary: Get an aggregated count of devices per firmware version (admin)
     *     tags: [Devices]
     *     responses:
     *       '200':
     *         description: Firmware versions seen across the fleet
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/firmwareversions`, authAdminMiddleware, this.deviceController.getFirmwareVersions);
  }
}

export default DeviceRoute;
