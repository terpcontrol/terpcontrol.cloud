import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { notFound } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { StoredPasswordReset } from '@database/schemas/v1/password-resets.schema';
import { appConfig } from '@config/configuration';
import { MailService } from '@modules/mail/mail.service';
import { logger } from '@utils/logger';
import { AccountsService } from './accounts.service';

/**
 * The half of a password reset this server is allowed to keep.
 *
 * What is mailed is a secret; what is stored is its hash, so a copy of the
 * database is not a set of working reset links. A redemption hashes what it was
 * given and looks that up, which is also why the hash is what carries the unique
 * index.
 *
 * Asking for a reset, redeeming one and changing a password all retire whatever
 * is outstanding: a link somebody asked for and then remembered their password
 * instead must not stay usable behind them.
 */

/**
 * Long enough for a mail to arrive and be read, short enough that a link sitting
 * in a mailbox stops being a way in. The record expires itself at this instant,
 * so nothing has to sweep them.
 */
const VALID_FOR_MINUTES = 60;

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectModel(MODEL_V1.passwordReset) private readonly resets: Model<StoredPasswordReset>,
    private readonly accounts: AccountsService,
    private readonly mail: MailService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /**
   * Answers nothing either way. An address with no account here has none sent,
   * and the route answers the same to both, so that what comes back never tells
   * a stranger who is registered.
   */
  public async request(email: string): Promise<void> {
    const user = await this.accounts.byEmail(email);
    if (!user) return;

    await this.retire(user.id);

    const token = randomUUID();
    await this.resets.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + VALID_FOR_MINUTES * 60 * 1000),
    });

    try {
      await this.mail.send({
        to: email,
        subject: 'Reset your Terp Control password',
        text: `Change password: ${this.app.apiUrlExternal}/login?recovery=${token}`,
      });
    } catch (error) {
      // An install with no SMTP configured is a supported install; the account
      // simply cannot be recovered by mail there, and the caller is told
      // nothing either way.
      logger.error(`Could not send a password reset to ${email}: ${String(error)}`);
    }
  }

  /**
   * The token is spent here: the row goes, so a link that has been used once
   * refuses the second time even inside its hour.
   */
  public async redeem(token: string, password: string): Promise<void> {
    const reset = await this.resets.findOne({ tokenHash: digest(token) }).lean();
    if (!reset || reset.expiresAt.getTime() <= Date.now()) {
      throw notFound('reset_unknown', 'That recovery link has been used already, or it has run out.');
    }

    await this.accounts.setPassword(reset.userId, password);
    await this.retire(reset.userId);
  }

  public async retire(userId: string): Promise<void> {
    await this.resets.deleteMany({ userId });
  }
}
