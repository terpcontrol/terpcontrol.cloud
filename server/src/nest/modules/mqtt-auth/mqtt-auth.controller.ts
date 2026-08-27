import { Body, Controller, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AuthResourceDto, AuthTopicDto, AuthUserDto, AuthVhostDto } from '@dtos/mqttauth.dto';
import MqttAuthService from '@services/mqttauth.service';
import { MqttAuthSecretGuard } from './mqtt-auth-secret.guard';

type Verdict = 'allow' | 'deny';

const verdict = (allowed: boolean): Verdict => (allowed ? 'allow' : 'deny');

/**
 * RabbitMQ's HTTP auth backend. It posts form-encoded fields and reads the body
 * as a bare `allow` or `deny`; the content type is the one Express sent, so
 * nothing on the broker side has to change.
 */
@ApiExcludeController()
@Controller('mqttauth/:secret')
@UseGuards(MqttAuthSecretGuard)
export class MqttAuthController {
  constructor(private readonly mqttAuth: MqttAuthService) {}

  @Post('user')
  @HttpCode(HttpStatus.OK)
  @Header('content-type', 'text/html; charset=utf-8')
  public async user(@Body() body: AuthUserDto): Promise<Verdict> {
    return verdict(await this.mqttAuth.user(body));
  }

  @Post('vhost')
  @HttpCode(HttpStatus.OK)
  @Header('content-type', 'text/html; charset=utf-8')
  public async vhost(@Body() body: AuthVhostDto): Promise<Verdict> {
    return verdict(await this.mqttAuth.vhost(body));
  }

  @Post('topic')
  @HttpCode(HttpStatus.OK)
  @Header('content-type', 'text/html; charset=utf-8')
  public async topic(@Body() body: AuthTopicDto): Promise<Verdict> {
    return verdict(await this.mqttAuth.topic(body));
  }

  @Post('resource')
  @HttpCode(HttpStatus.OK)
  @Header('content-type', 'text/html; charset=utf-8')
  public async resource(@Body() body: AuthResourceDto): Promise<Verdict> {
    return verdict(await this.mqttAuth.resource(body));
  }
}
