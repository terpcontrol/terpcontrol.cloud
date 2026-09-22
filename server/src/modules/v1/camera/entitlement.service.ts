import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { CameraEntitlement, MediaQuality, PremiumFree } from '@fg2/shared-types/v1';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { premiumConfig } from '@config/configuration';

/**
 * What Premium is worth, decided in one place.
 *
 * It sits on the camera and nowhere else: control, charts, the diary and the
 * alarms are the same whatever a camera is entitled to. Three things depend on
 * it, and nothing else does - the width a still is **served** at, whether a
 * render may be HD or has to carry a watermark, and, only where an install has
 * turned that switch on, how long a free camera's pictures are kept.
 *
 * With `PREMIUM_ENFORCED` unset nothing is gated: every camera reads as
 * `premium`, stills are served whole and no picture is ever deleted for being a
 * free camera's. That is what a self-hosted install gets, and it is the default.
 */

/** How long before a year runs out the renewal is worth mentioning, as the record decides. */
const RENEWAL_WINDOW_DAYS = 60;

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

/** Twelve months, as the record decides, for a Terp Cam when it is first claimed or paired. */
export const ENTITLEMENT_MONTHS = 12;

export const yearFrom = (at: Date): Date => {
  const until = new Date(at);
  until.setMonth(until.getMonth() + ENTITLEMENT_MONTHS);
  return until;
};

/** How long a camera's pictures are kept when nothing is entitled and the install has said to sweep. */
export interface FreeRetention {
  stillDays: number;
  timelapseDays: number;
}

/**
 * What a free camera gets here, translated from the install's configuration
 * into the contract's shape. Zero is how the configuration spells "not set" and
 * null is how the contract does, and the sweep being off means no window at all
 * - so the translation lives in one place and both the account screen and a
 * camera read the same answer.
 *
 * It is a function rather than only a method because `/me` answers it without
 * having a camera in its hands.
 */
export const freeTierOf = (premium: ConfigType<typeof premiumConfig>): PremiumFree => {
  const sweeping = premium.enforced && premium.freeRetention;
  return {
    stillWidth: premium.enforced && premium.freeStillWidth > 0 ? premium.freeStillWidth : null,
    stillDays: sweeping && premium.freeStillDays > 0 ? premium.freeStillDays : null,
    timelapseDays: sweeping && premium.freeTimelapseDays > 0 ? premium.freeTimelapseDays : null,
  };
};

@Injectable()
export class EntitlementService {
  constructor(@Inject(premiumConfig.KEY) private readonly premium: ConfigType<typeof premiumConfig>) {}

  public get enforced(): boolean {
    return this.premium.enforced;
  }

  /** A camera is free only where enforcement is on and its year has run out. */
  public isEntitled(camera: Pick<CameraDocument, 'entitlement'>, now: Date = new Date()): boolean {
    if (!this.premium.enforced) return true;

    const validUntil = camera.entitlement.validUntil;
    return validUntil !== null && validUntil.getTime() > now.getTime();
  }

  /**
   * The entitlement as it is answered: what is stored, plus the two values read
   * from it and from the install's configuration every time, so neither a client
   * nor this server needs a billing system to draw the renewal notice.
   */
  public serialise(camera: Pick<CameraDocument, 'entitlement'>, now: Date = new Date()): CameraEntitlement {
    return {
      validUntil: camera.entitlement.validUntil?.toISOString() ?? null,
      grant: camera.entitlement.grant,
      tier: this.isEntitled(camera, now) ? 'premium' : 'free',
      // Nothing to offer without somewhere to send the person, nothing to renew
      // where nothing is gated, and nothing to say about a year that is not
      // nearly up: the record shows the renewal sixty days ahead, and a camera
      // whose year has already run out is past that window rather than outside
      // it, so it still says so.
      renewalVisible: this.premium.enforced && this.premium.extendUrl.length > 0 && this.withinRenewalWindow(camera, now),
    };
  }

  /**
   * Whether the renewal is near enough to be worth a word. A camera that has
   * never been entitled at all has no date to count towards and is offered the
   * renewal at once, because there is nothing else the screen could say to
   * somebody who has just added an RTSP camera.
   */
  private withinRenewalWindow(camera: Pick<CameraDocument, 'entitlement'>, now: Date): boolean {
    const validUntil = camera.entitlement.validUntil;
    if (validUntil === null) return true;
    return validUntil.getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * MS_IN_A_DAY;
  }

  /** What a free camera gets on this install, as `/me` answers it. */
  public freeTier(): PremiumFree {
    return freeTierOf(this.premium);
  }

  /**
   * The width a still of this camera goes over the wire at, or undefined for the
   * stored picture whole. The bytes in the bucket are never touched: a camera
   * that is extended serves its whole history at full size again.
   */
  public servedStillWidth(camera: Pick<CameraDocument, 'entitlement'>, now: Date = new Date()): number | undefined {
    if (this.premium.freeStillWidth <= 0 || this.isEntitled(camera, now)) return undefined;
    return this.premium.freeStillWidth;
  }

  /** HD is entitled; a free camera renders at the resolution it always has. */
  public allowedQuality(camera: Pick<CameraDocument, 'entitlement'>, asked: MediaQuality | undefined, now: Date = new Date()): MediaQuality {
    return asked === 'hd' && this.isEntitled(camera, now) ? 'hd' : 'sd';
  }

  public watermarks(camera: Pick<CameraDocument, 'entitlement'>, now: Date = new Date()): boolean {
    return !this.isEntitled(camera, now);
  }

  /**
   * The windows a free camera's pictures are swept by, or null - which is the
   * answer unless an install has turned the switch on and named the days, so an
   * install that says nothing keeps every picture as long as it does today.
   */
  public freeRetention(): FreeRetention | null {
    if (!this.premium.enforced || !this.premium.freeRetention) return null;

    const stillDays = this.premium.freeStillDays;
    const timelapseDays = this.premium.freeTimelapseDays;
    return stillDays > 0 || timelapseDays > 0 ? { stillDays, timelapseDays } : null;
  }
}
