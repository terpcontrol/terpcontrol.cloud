import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { mailTransport } from '../../../services/mail-transport';
import { mailConfig } from '../../config/configuration';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Everything the server sends by mail - an activation link, a password recovery
 * link, an alarm - goes through here, so the sender is set in one place.
 *
 * The transport itself still lives beside the services that have not become
 * providers yet; it moves in here with the last of them.
 */
@Injectable()
export class MailService {
  constructor(@Inject(mailConfig.KEY) private readonly config: ConfigType<typeof mailConfig>) {}

  public send(mail: Mail): Promise<unknown> {
    return mailTransport.sendMail({ from: this.config.sender, ...mail });
  }
}
