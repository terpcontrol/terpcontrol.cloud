import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_URL_EXTERNAL } from '@config';

/**
 * The API description, built from the controllers themselves rather than from
 * comments kept alongside them, so it cannot drift from what the server serves.
 */
export const setupOpenApi = (app: NestFastifyApplication): void => {
  const builder = new DocumentBuilder()
    .setTitle('Terp Control API')
    .setVersion('1.0.0')
    .setDescription('OpenAPI documentation for the Terp Control cloud server API.')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The user token from `/login` or `/refresh`.' }, 'bearerAuth')
    .addCookieAuth('Authorization', { type: 'apiKey', description: 'The session cookie the browser gets from `/login`.' })
    .addSecurityRequirements('bearerAuth');

  if (API_URL_EXTERNAL) {
    builder.addServer(API_URL_EXTERNAL, 'Current server');
  }

  const document = SwaggerModule.createDocument(app, builder.build());

  SwaggerModule.setup('api-docs', app, document, { jsonDocumentUrl: 'swagger.json', explorer: true });
};
