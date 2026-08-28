import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { User } from '@fg2/shared-types';
import { authConfig } from '../../config/configuration';
import { MODEL } from '../../database/models.module';
import { PUBLIC_OPERATION } from '../../openapi';

@ApiTags('service')
@Controller()
export class HealthController {
  constructor(
    @InjectModel(MODEL.user) private readonly users: Model<User & Document>,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  @Get('/')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe', ...PUBLIC_OPERATION })
  @ApiResponse({ status: 200, description: 'The API is up.' })
  public liveness(): string {
    return 'OK';
  }

  @Get('/readycheck')
  @ApiOperation({ summary: 'Readiness probe', ...PUBLIC_OPERATION })
  @ApiResponse({ status: 200, description: 'The admin account exists, so the database is reachable and seeded.' })
  @ApiResponse({ status: 501, description: 'The admin account is missing.' })
  public async readiness(@Res() reply: FastifyReply): Promise<void> {
    // The account the server seeds on start, which is named by the deployment
    // and is not always called "admin".
    const admin = await this.users.findOne({ username: this.config.adminUsername });
    // 501 is what the probe has always answered; changing it would need the
    // deployment's health checks to change with it.
    await reply.status(admin ? HttpStatus.OK : HttpStatus.NOT_IMPLEMENTED).send(admin ? 'OK' : 'Not Implemented');
  }
}
