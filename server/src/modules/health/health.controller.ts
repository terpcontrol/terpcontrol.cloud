import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MODEL_V1 } from '@database/models';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { authConfig } from '../../config/configuration';
import { PUBLIC_OPERATION } from '../../openapi';

/** Both probes answer a word, not a document: they are read by a load balancer. */
const PLAIN_OK = { 'text/plain': { schema: { type: 'string' } } };

/**
 * The two probes, outside `/v1`: they say whether this process is worth routing
 * to, which is not a question about the API's version.
 */
@ApiTags('service')
@Controller()
export class HealthController {
  constructor(
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  @Get('/healthz')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: 'The process is up.', content: PLAIN_OK })
  public liveness(): string {
    return 'OK';
  }

  @Get('/readyz')
  @ApiOperation({ summary: 'Readiness probe', ...PUBLIC_OPERATION })
  @ApiResponse({ status: HttpStatus.OK, description: 'The admin account exists, so the database is reachable and seeded.', content: PLAIN_OK })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, description: 'The admin account is missing.', content: PLAIN_OK })
  public async readiness(@Res() reply: FastifyReply): Promise<void> {
    // The account the server seeds on start, which is named by the deployment
    // and is not always called "admin". It is the login address, which the model
    // calls `email`.
    const admin = await this.users.exists({ email: this.config.adminUsername });

    await reply.status(admin ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).send(admin ? 'OK' : 'Not ready');
  }
}
