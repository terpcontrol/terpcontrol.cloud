import path from 'path';
import swaggerJSDoc from 'swagger-jsdoc';

export function buildSwaggerSpec(serverUrl?: string): object {
  // Source files compiled by swc keep their relative layout under dist/, so the
  // same glob works for both `ts-node` (src/) and the production build (dist/).
  const apis = [path.join(__dirname, '..', 'routes', '*.{ts,js}'), path.join(__dirname, '..', 'dtos', '*.{ts,js}')];

  return swaggerJSDoc({
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'Terp Control API',
        version: '1.0.0',
        description:
          'OpenAPI documentation for the Terp Control cloud server API.\n\n' +
          'The API is served by the `server` service in Docker Compose. ' +
          'This documentation is generated from JSDoc annotations in the source code.',
      },
      servers: serverUrl ? [{ url: serverUrl, description: 'Current server' }] : [],
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Index', description: 'Health and readiness probes' },
        { name: 'Auth', description: 'User authentication and password management' },
        { name: 'Users', description: 'User administration (admin only)' },
        { name: 'Devices', description: 'Device management, configuration and firmware' },
        { name: 'Data', description: 'Time-series and latest sensor measurements' },
        { name: 'Images', description: 'Device image and timelapse access' },
        { name: 'Shares', description: 'Share links granting read access to a device page' },
        { name: 'Chart presets', description: 'Saved chart views (measures, timespan) of the current user' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT user token issued by `/login` or `/refresh`. Sent as `Authorization: Bearer <token>`.',
          },
        },
        schemas: {
          User: {
            type: 'object',
            properties: {
              user_id: { type: 'string' },
              username: { type: 'string', format: 'email' },
              is_admin: { type: 'boolean' },
              is_active: { type: 'boolean' },
            },
          },
          TokenPair: {
            type: 'object',
            properties: {
              userToken: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  expiresIn: { type: 'integer' },
                },
              },
              refreshToken: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  expiresIn: { type: 'integer' },
                },
              },
              imageToken: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  expiresIn: { type: 'integer' },
                },
              },
            },
          },
          LoginResponse: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              userToken: { type: 'object', properties: { token: { type: 'string' }, expiresIn: { type: 'integer' } } },
              refreshToken: { type: 'object', properties: { token: { type: 'string' }, expiresIn: { type: 'integer' } } },
              imageToken: { type: 'object', properties: { token: { type: 'string' }, expiresIn: { type: 'integer' } } },
            },
          },
          Alarm: {
            type: 'object',
            properties: {
              alarmId: { type: 'string' },
              name: { type: 'string' },
              disabled: { type: 'boolean' },
              sensorType: { type: 'string' },
              upperThreshold: { type: 'number', nullable: true },
              lowerThreshold: { type: 'number', nullable: true },
              actionType: { type: 'string', enum: ['email', 'webhook', 'info'] },
              actionTarget: { type: 'string' },
              additionalInfo: { type: 'boolean' },
              cooldownSeconds: { type: 'number' },
              retriggerSeconds: { type: 'number' },
              thresholdSeconds: { type: 'number' },
              isTriggered: { type: 'boolean' },
              lastTriggeredAt: { type: 'number' },
              lastResolvedAt: { type: 'number' },
              extremeValue: { type: 'number' },
              latestDataPointTime: { type: 'number' },
              webhookMethod: { type: 'string', enum: ['GET', 'POST', 'PUT'] },
              webhookHeaders: { type: 'object', additionalProperties: { type: 'string' } },
              webhookTriggeredPayload: {
                type: 'string',
                description:
                  'Raw request body. Supports {{placeholder}} substitution: alarmName, deviceName, deviceId, sensorType, ' +
                  'value, upperThreshold, lowerThreshold, event, timestamp, alarmId, extremeValue. ' +
                  'Values are JSON-escaped in payloads and URL-encoded in the target URL; strings without {{ are sent verbatim.',
              },
              webhookResolvedPayload: { type: 'string' },
              reportWebhookErrors: { type: 'boolean' },
              tunnelWebhook: { type: 'boolean' },
            },
          },
          CloudSettings: {
            type: 'object',
            properties: {
              autoFirmwareUpdate: { type: 'boolean' },
              firmwareChannel: { type: 'string', enum: ['stable', 'beta', 'alpha', 'manual'] },
              pendingFirmware: { type: 'string' },
              vpdLeafTempOffsetDay: { type: 'number' },
              vpdLeafTempOffsetNight: { type: 'number' },
              ppfdLuxFactor: { type: 'number' },
              betaFeatures: { type: 'boolean' },
              rtspStream: { type: 'string' },
              rtspStreamTransport: { type: 'string' },
              logRtspStreamErrors: { type: 'boolean' },
              tunnelRtspStream: { type: 'boolean' },
              maintenanceWebcamOff: { type: 'boolean' },
              controlProfile: {
                type: 'string',
                enum: ['full', 'light_only', 'monitor'],
                description:
                  'What the device actually actuates, chosen by the user. Absent means full. ' +
                  'monitor = sensors only, light_only = built-in lamp output only; the app then presents climate targets as reference values.',
              },
              webcamModel: {
                type: 'string',
                enum: ['terp_cam', 'tapo_c200', 'reolink', 'hikvision', 'custom'],
                description:
                  'Which camera the rtspStream URL was built for (presentation hint only). ' +
                  'terp_cam = Terp Control Cam whose URL the device reports via hardware-info after local pairing.',
              },
            },
          },
          RecipeStep: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              settings: {},
              durationUnit: { type: 'string', enum: ['minutes', 'hours', 'days', 'weeks'] },
              duration: { type: 'number' },
              waitForConfirmation: { type: 'boolean' },
              confirmationMessage: { type: 'string' },
              lastTimeApplied: { type: 'number' },
              notified: { type: 'boolean' },
              stage: {
                type: 'string',
                enum: ['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing'],
                description: 'Grow lifecycle stage this step represents. Stage changes of a running plan are logged to the grow diary.',
              },
            },
          },
          Recipe: {
            type: 'object',
            properties: {
              steps: { type: 'array', items: { $ref: '#/components/schemas/RecipeStep' } },
              activeStepIndex: { type: 'integer' },
              activeSince: { type: 'number' },
              loop: { type: 'boolean' },
              notifications: { type: 'string', enum: ['off', 'onStep', 'onConfirmation'] },
              additionalInfo: { type: 'boolean' },
              email: { type: 'string' },
            },
          },
          RecipeTemplate: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              name: { type: 'string' },
              owner_id: { type: 'string' },
              public: { type: 'boolean' },
              createdAt: { type: 'number' },
              updatedAt: { type: 'number' },
              steps: { type: 'array', items: { $ref: '#/components/schemas/RecipeStep' } },
            },
          },
          Device: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              device_id: { type: 'string' },
              name: { type: 'string' },
              device_type: { type: 'string' },
              class_id: { type: 'string' },
              owner_id: { type: 'string' },
              serialnumber: { type: 'number' },
              lastseen: { type: 'number' },
              current_firmware: { type: 'string' },
              pending_firmware: { type: 'string', description: 'Deprecated. Use cloudSettings.pendingFirmware.' },
              fwupdate_start: { type: 'number' },
              fwupdate_end: { type: 'number' },
              configuration: { type: 'string' },
              alarms: { type: 'array', items: { $ref: '#/components/schemas/Alarm' } },
              cloudSettings: { $ref: '#/components/schemas/CloudSettings' },
              maintenance_mode_until: { type: 'number' },
              recipe: { $ref: '#/components/schemas/Recipe' },
              hardwareInfo: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
          DeviceAccessInfo: {
            type: 'object',
            properties: {
              device_id: { type: 'string' },
              device_type: { type: 'string' },
              name: { type: 'string' },
              isPublic: { type: 'boolean' },
              cloudSettings: { $ref: '#/components/schemas/CloudSettings' },
              share: {
                type: 'object',
                description: 'Set when access was granted through a share link.',
                properties: {
                  share_id: { type: 'string' },
                  page: { type: 'string', enum: ['charts', 'diary'] },
                  editable: { type: 'boolean' },
                  webcam: { type: 'boolean' },
                  charts: { type: 'boolean' },
                  query: { type: 'string', description: 'Query string capturing the shared view.' },
                  expiresAt: { type: 'number', nullable: true },
                },
              },
            },
          },
          ShareLink: {
            type: 'object',
            properties: {
              share_id: { type: 'string' },
              device_id: { type: 'string' },
              owner_id: { type: 'string' },
              page: { type: 'string', enum: ['charts', 'diary'] },
              editable: { type: 'boolean' },
              webcam: { type: 'boolean' },
              charts: { type: 'boolean' },
              createdAt: { type: 'number' },
              expiresAt: { type: 'number', nullable: true },
              revokedAt: { type: 'number', nullable: true },
              openCount: { type: 'integer' },
              lastOpenedAt: { type: 'number', nullable: true },
            },
          },
          ChartPreset: {
            type: 'object',
            properties: {
              preset_id: { type: 'string' },
              owner_id: { type: 'string' },
              name: { type: 'string' },
              device_type: { type: 'string' },
              query: {
                type: 'string',
                description: 'Query string capturing the chart view (measures, timespan, interval, vpdMode), in the charts page URL format.',
              },
              createdAt: { type: 'number' },
            },
          },
          DeviceClass: {
            type: 'object',
            properties: {
              class_id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              concurrent: { type: 'integer' },
              maxfails: { type: 'integer' },
              firmware_id: { type: 'string' },
              beta_firmware_id: { type: 'string' },
              alpha_firmware_id: { type: 'string' },
            },
          },
          DeviceFirmware: {
            type: 'object',
            properties: {
              firmware_id: { type: 'string' },
              name: { type: 'string' },
              version: { type: 'string' },
              class_id: { type: 'string' },
              createdAt: { type: 'number' },
            },
          },
          ClaimCode: {
            type: 'object',
            properties: {
              claim_code: { type: 'string' },
              device_id: { type: 'string' },
            },
          },
          DeviceLog: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              device_id: { type: 'string' },
              title: { type: 'string' },
              message: { type: 'string' },
              severity: { type: 'integer' },
              time: { type: 'string', format: 'date-time' },
              categories: { type: 'array', items: { type: 'string' } },
              deleted: { type: 'boolean' },
              raw: { type: 'boolean' },
              images: { type: 'array', items: { type: 'string' } },
            },
          },
          Image: {
            type: 'object',
            properties: {
              image_id: { type: 'string' },
              device_id: { type: 'string' },
              timestamp: { type: 'number' },
              timestampEnd: { type: 'number' },
              format: { type: 'string', enum: ['jpeg', 'mp4', 'user/jpeg'] },
              duration: { type: 'string', enum: ['1d', '1w', '1m'] },
            },
          },
          SeriesPoint: {
            type: 'object',
            properties: {
              _time: { type: 'string', format: 'date-time' },
              _value: { type: 'number' },
            },
          },
          LatestValue: {
            type: 'object',
            properties: {
              value: { type: 'number' },
            },
          },
          StatusOk: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'ok' },
            },
          },
          MessageResponse: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
          ErrorResponse: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
              status: { type: 'integer' },
            },
          },
        },
        responses: {
          Unauthorized: {
            description: 'Missing or invalid authentication',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          Forbidden: {
            description: 'Authenticated but not allowed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          NotFound: {
            description: 'Resource not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          BadRequest: {
            description: 'Invalid input',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    apis,
  });
}
