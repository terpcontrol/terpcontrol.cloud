import { useQueryClient } from '@tanstack/react-query';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SocketOverrideState } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useSetOverride, type OverrideRequest } from '@/api/devices';
import { useLog } from '@/log/log-context';
import { durationLabel, instantOf } from '@/ui/age';
import { Announce } from '@/ui/Announce';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { answerSoon, HOLD_SECONDS } from './sockets';
import styles from './HandHold.module.css';

/** An output held by hand: which way, and until when. */
export interface Held {
  state: 'on' | 'off';
  until: string;
}

const WAYS = ['auto', 'on', 'off'] as const;

/** How long a device has to report what it was asked before the control stops waiting for it: two of its tables. */
const ANSWER_MS = 60_000;

interface HandHoldProps {
  /** What is held, as the toast and a screen reader name it. */
  name: string;
  deviceId: string;
  target: OverrideRequest['target'];
  /** What holds it now, in the device's own word - or, for an output it reports no hold of, in the word of whoever keeps what was sent. */
  held: Held | null;
  /** What the control says while nothing is on its way, where no line beside it says what holds. */
  standing?: string | null;
  help: HelpTopic;
  now: DateTime;
  /** The device was listening when this went out; null hands the output back. */
  onHeard?: (hold: Held | null) => void;
}

/**
 * Holding an output by hand - a smart socket, the controller's own light:
 * Auto · An · Aus, and under An or Aus, once tapped, the lengths a hold can
 * have, headed by the way they hold. A length is the tap that sends, Auto
 * sends at once, and nothing sends a way it does not name.
 *
 * What was asked is marked at once and named in a toast; while it is on its
 * way a second tap sends nothing; and when the device reports, `held` is its
 * word again. A device that says nothing within a minute is not taken at the
 * app's word. The way that already holds is not sent a second time: a device
 * reports a hold only when its way changes, so another length would go on
 * being counted down from the old one.
 */
export function HandHold({ name, deviceId, target, held, standing = null, help, now, onHeard }: HandHoldProps) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const client = useQueryClient();
  const override = useSetOverride();
  const [choosing, setChoosing] = useState<Held['state'] | null>(null);
  const [asked, setAsked] = useState<{ state: SocketOverrideState; heardAt: number | null } | null>(null);
  const inForce = held?.state ?? 'auto';
  if (asked?.state === inForce) setAsked(null);

  const waiting = asked !== null && (asked.heardAt === null || now.toMillis() - asked.heardAt < ANSWER_MS);
  const shown = waiting ? asked.state : inForce;
  const busy = override.isPending;

  const send = (state: SocketOverrideState, forSeconds: number) => {
    if (busy) return;
    setChoosing(null);
    setAsked({ state, heardAt: null });
    override.mutate(
      { deviceId, target, state, forSeconds },
      {
        onSuccess: ({ deviceOnline }) => {
          if (!deviceOnline) return setAsked(null);
          const heardAt = serverNow();
          setAsked(open => open && { ...open, heardAt: heardAt.toMillis() });
          onHeard?.(state === 'auto' ? null : { state, until: instantOf(heardAt.plus({ seconds: forSeconds })) });
          answerSoon(client, deviceId, target.kind === 'socket' ? 'sockets' : 'live');
          tell({ label: t(`devices.hold.told.${state}`, { name, duration: durationLabel(forSeconds) }), undo: null });
        },
        onError: () => setAsked(null),
      },
    );
  };

  const pick = (way: SocketOverrideState) => {
    if (busy) return;
    if (way === shown || way === choosing) setChoosing(null);
    else if (way === 'auto') send('auto', 0);
    else setChoosing(way);
  };

  const said = waiting
    ? t('devices.hold.asking')
    : asked
      ? t('devices.hold.silent')
      : override.data?.deviceOnline === false
        ? t('devices.socket.notListening')
        : standing;

  return (
    <div className={styles.hold}>
      <div className={`${ui.segments} ${styles.ways}`} role="group" aria-label={t('devices.hold.label', { name })}>
        {WAYS.map(way => (
          <button
            key={way}
            type="button"
            className={ui.segment}
            aria-pressed={way === shown}
            aria-expanded={way === 'auto' || way === shown ? undefined : way === choosing}
            aria-disabled={busy || undefined}
            onClick={() => pick(way)}
          >
            {t(`devices.hold.way.${way}`)}
          </button>
        ))}
      </div>

      {choosing ? (
        <div className={styles.lengths} role="group" aria-label={t(`devices.hold.for.${choosing}`)}>
          <span className="label">
            {t(`devices.hold.for.${choosing}`)}
            <Help topic={help} />
          </span>
          <div>
            {HOLD_SECONDS.map(seconds => (
              <button
                key={seconds}
                type="button"
                className={ui.chip}
                aria-label={t(`devices.hold.send.${choosing}`, { name, duration: durationLabel(seconds) })}
                onClick={() => send(choosing, seconds)}
              >
                {durationLabel(seconds)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Refused error={override.error} fallback={t('devices.socket.askFailed')} />
      {said ? <p className={ui.note}>{said}</p> : null}
      <Announce text={said === standing ? null : said} />
    </div>
  );
}
