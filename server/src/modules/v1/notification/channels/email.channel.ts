import { Injectable } from '@nestjs/common';
import { MailService } from '@modules/mail/mail.service';
import { Announcement, Delivered, NotificationChannelSender } from '../notification.types';
import { StoredUser } from '@database/schemas/v1/users.schema';

/**
 * Mail, to the address the person named for notifications.
 *
 * Deliberately not the sign-in address. They are usually the same one, and
 * filling this in from the account would still be the server deciding to write
 * to somebody who never asked it to - which is what "every channel is off until
 * configured" is there to prevent. An account that has not set one is not
 * mailed.
 *
 * The transport itself is the install's, and an install with no SMTP settings
 * fails here in the same way it already fails on an alarm's own mail: loudly,
 * in the log, and without stopping anything else being said.
 */
@Injectable()
export class EmailChannel implements NotificationChannelSender {
  public readonly name = 'email' as const;

  constructor(private readonly mail: MailService) {}

  public async send(to: StoredUser, message: Announcement): Promise<Delivered | null> {
    const address = to.notifications.channels.email;
    if (!address) return null;

    await this.mail.send({ to: address, subject: `[TERP CONTROL] ${message.title}`, text: `${message.title}\n\n${message.body}\n` });

    // SMTP gives the message an id, but nothing here can be replied to, so
    // there is nothing to match one back to.
    return { externalMessageId: null };
  }
}
