import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import userModel from '@models/users.model';

@ApiTags('service')
@Controller()
export class HealthController {
  @Get('/')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'The API is up.' })
  public liveness(): string {
    return 'OK';
  }

  @Get('/readycheck')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'The admin account exists, so the database is reachable and seeded.' })
  @ApiResponse({ status: 501, description: 'The admin account is missing.' })
  public async readiness(@Res() reply: FastifyReply): Promise<void> {
    const admin = await userModel.findOne({ username: 'admin' });
    // 501 is what the probe has always answered; changing it would need the
    // deployment's health checks to change with it.
    await reply.status(admin ? HttpStatus.OK : HttpStatus.NOT_IMPLEMENTED).send(admin ? 'OK' : 'Not Implemented');
  }
}
