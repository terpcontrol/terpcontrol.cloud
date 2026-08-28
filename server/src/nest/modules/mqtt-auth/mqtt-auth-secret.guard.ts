import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { FastifyRequest } from 'fastify';
import { logger } from '@utils/logger';
import { PlainTextException } from '../../common/http-exception.filter';
import { mqttConfig } from '../../config/configuration';

/**
 * The broker proves it is the broker by the secret in the path. It reads the
 * body, so every refusal answers `deny` rather than an error document.
 */
@Injectable()
export class MqttAuthSecretGuard implements CanActivate {
  constructor(@Inject(mqttConfig.KEY) private readonly mqtt: ConfigType<typeof mqttConfig>) {}

  public canActivate(context: ExecutionContext): boolean {
    const expected = this.mqtt.authSharedSecret;
    if (!expected) {
      logger.error('MQTTAUTH_SHARED_SECRET is not configured; rejecting /mqttauth request');
      throw new PlainTextException(500, 'deny');
    }

    const provided = (context.switchToHttp().getRequest<FastifyRequest>().params as { secret?: string })?.secret;
    if (typeof provided !== 'string') {
      throw new PlainTextException(401, 'deny');
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new PlainTextException(401, 'deny');
    }

    return true;
  }
}
