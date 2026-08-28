import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { mailConfig } from '../../config/configuration';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodemailer = require('nodemailer');

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Everything the server sends by mail - an activation link, a password recovery
 * link, an alarm - goes through here, so the transport is configured once and
 * the sender is set in one place.
 */
@Injectable()
export class MailService {
  private readonly transport;

  constructor(@Inject(mailConfig.KEY) private readonly config: ConfigType<typeof mailConfig>) {
    this.transport = nodemailer.createTransport({
      host: config.server,
      port: config.port,
      secure: config.secure,
      debug: false,
      logger: false,
      auth: { user: config.user, pass: config.password },
    });
  }

  public send(mail: Mail): Promise<unknown> {
    return this.transport.sendMail({ from: this.config.sender, ...mail });
  }
}
