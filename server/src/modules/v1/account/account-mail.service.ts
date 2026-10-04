import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { appConfig } from '@config/configuration';
import { MailService } from '@modules/mail/mail.service';
import { logger } from '@utils/logger';

/**
 * The two mails an account is sent before it can sign in: the code that
 * activates it, and the way back in after a forgotten password.
 *
 * Both carry a link into the app where this install knows the app's address,
 * and the code itself always: a mail is often read on another device than the
 * one the form is open on, and an install that has not said where the app is
 * served would otherwise send a link to nowhere. They are written in German and
 * English at once, because neither address has told this server its language
 * yet - a sign-up has no preference stored, and a reset is asked by somebody
 * who is not signed in.
 */

export interface AccountMail {
  subject: string;
  text: string;
}

/** As long as the recovery record lives; the service that writes it says so too. */
export const RECOVERY_VALID_MINUTES = 60;

const link = (appUrl: string | null, path: string): string | null => (appUrl ? `${appUrl}${path}` : null);

export const recoveryMail = (appUrl: string | null, token: string): AccountMail => {
  const url = link(appUrl, `/recover/${encodeURIComponent(token)}`);

  return {
    subject: 'Terp Control: Passwort zurücksetzen / Reset your password',
    text: [
      'Hallo,',
      '',
      url
        ? `für dein Terp-Control-Konto wurde ein neues Passwort angefordert. Hier setzt du es:\n${url}\n\nOder gib in der App unter „Passwort vergessen?“ › „Code aus der Mail eingeben“ diesen Code ein:`
        : 'für dein Terp-Control-Konto wurde ein neues Passwort angefordert. Gib in der App unter „Passwort vergessen?“ › „Code aus der Mail eingeben“ diesen Code ein:',
      token,
      '',
      `Link und Code gelten ${RECOVERY_VALID_MINUTES} Minuten und nur einmal. Hast du nichts angefordert, ignoriere diese Mail - dein Passwort bleibt, wie es ist.`,
      '',
      '---',
      '',
      'Hello,',
      '',
      url
        ? `a new password was requested for your Terp Control account. Set it here:\n${url}\n\nOr enter this code in the app under "Forgot password?" › "Enter the code from the mail":`
        : 'a new password was requested for your Terp Control account. Enter this code in the app under "Forgot password?" › "Enter the code from the mail":',
      token,
      '',
      `The link and the code work once, for ${RECOVERY_VALID_MINUTES} minutes. If you did not ask for this, ignore this mail - your password stays as it is.`,
      '',
    ].join('\n'),
  };
};

export const activationMail = (appUrl: string | null, code: string): AccountMail => {
  const url = link(appUrl, `/activate/${encodeURIComponent(code)}`);

  return {
    subject: 'Terp Control: Konto aktivieren / Activate your account',
    text: [
      'Willkommen bei Terp Control!',
      '',
      url
        ? `Öffne diesen Link und tippe dort auf „Konto aktivieren“:\n${url}\n\nOder gib diesen Code in der App ein, wenn sie danach fragt:`
        : 'Gib diesen Code in der App ein, wenn sie danach fragt, um dein Konto zu aktivieren:',
      code,
      '',
      'Hast du kein Konto angelegt, ignoriere diese Mail.',
      '',
      '---',
      '',
      'Welcome to Terp Control!',
      '',
      url
        ? `Open this link and tap “Activate account” there:\n${url}\n\nOr enter this code in the app when it asks for it:`
        : 'Enter this code in the app when it asks for it to activate your account:',
      code,
      '',
      'If you did not create an account, ignore this mail.',
      '',
    ].join('\n'),
  };
};

@Injectable()
export class AccountMailService {
  constructor(
    private readonly mail: MailService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  public activation(to: string, code: string): Promise<void> {
    return this.deliver(to, activationMail(this.app.appUrlExternal, code));
  }

  public recovery(to: string, token: string): Promise<void> {
    return this.deliver(to, recoveryMail(this.app.appUrlExternal, token));
  }

  /**
   * An install with no SMTP configured is a supported install, and a reset that
   * answered with a failure would tell a stranger which address has an account
   * here. So a mail that could not go out is logged for whoever runs the
   * install and is otherwise silent; an account waiting for its code can still
   * be activated by an administrator.
   */
  private async deliver(to: string, mail: AccountMail): Promise<void> {
    try {
      await this.mail.send({ to, ...mail });
    } catch (error) {
      logger.error(`Could not send "${mail.subject}" to ${to}: ${String(error)}`);
    }
  }
}
