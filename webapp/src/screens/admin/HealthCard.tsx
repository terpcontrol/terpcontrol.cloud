import type { UseQueryResult } from '@tanstack/react-query';
import { type DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { AdminAlarmWatch, AdminRetentionRun, AdminStats, Device, Fleet } from '@fg2/shared-types/v1';
import { fileSize } from '@/api/exports';
import { ApiError } from '@/api/problem';
import { ageLabel, deviceLiveness } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { clock, useZone } from '@/ui/zone';
import styles from './Admin.module.css';

/**
 * How the install itself is doing, in the figures it actually answers.
 *
 * The board drew one line of figures and one of jobs: MQTT connections, the
 * size of the time-series database and of the picture bucket, films queued for
 * rendering; then when the retention jobs last ran, with how many errors, and
 * whether the demo device is alive. `GET /admin/stats` answers most of that
 * now, and the card is drawn from it in the board's order - with two of the
 * figures deliberately not what the board called them, and said as such rather
 * than relabelled. The broker's connection count is the broker's to report,
 * RabbitMQ's and not this server's, so the first slot is devices heard from
 * inside the offline window, which is the liveness every other screen uses,
 * and it is called that. The retention pass is the running server's own memory
 * and is stored nowhere, so a server that has just restarted answers null; the
 * line then says that nobody has swept since this server started, which is a
 * different fact from a pass that met nothing, and is never drawn as a zero.
 *
 * What the route still does not answer stays in the closing line, because the
 * point of that line is that an operator can tell what this install does not
 * know from what it knows. A figure the server did not compute is not drawn
 * from something else that happens to be a number: when the stats read fails,
 * the lines counted from the fleet answer stay, the figure's place says why,
 * and the closing line names what went missing with it.
 *
 * The camera count is the stats route's and nothing else's. The camera list
 * the fleet table reads is answered per account, an administrator's included,
 * so a count of it would be the operator's own cameras drawn as the install's;
 * without the stats answer there is no honest number, and the line is not
 * drawn.
 */
export function HealthCard({ fleet, devices, stats, now }: { fleet: Fleet; devices: Device[]; stats: UseQueryResult<AdminStats>; now: DateTime }) {
  const { t } = useTranslation();

  const updating = fleet.classes.reduce((count, one) => count + one.firmwares.reduce((sum, build) => sum + build.updating, 0), 0);
  const gaveUp = fleet.classes.reduce((count, one) => count + one.firmwares.reduce((sum, build) => sum + build.failed, 0), 0);
  const paused = fleet.classes.filter(one => one.rollout.paused).length;

  const demo = devices.filter(device => device.isDemo);
  const demoAlive = demo.filter(device => deviceLiveness(device.state.lastSeenAt, now) !== 'offline');
  const newest = demo.map(device => device.state.lastSeenAt).filter((at): at is string => at !== null)[0] ?? null;

  const answer = stats.data ?? null;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className="label">{t('admin.health.title')}</span>
        <span className={styles.actions}>
          {/* A dozen counts gathered over a second are not "now", and the
              answer says when it was taken; so does the card. */}
          {answer ? <span className={`mono ${styles.consequence}`}>{t('admin.health.asOf', { age: ageLabel(answer.collectedAt, now) })}</span> : null}
          <Link className={ui.chip} to="/admin/demo">
            {t('admin.health.openDemo')}
          </Link>
        </span>
      </div>

      {answer ? (
        <span className={`mono ${styles.figure}`}>
          {[
            t('admin.count.online', { count: answer.devices.online }),
            t('admin.health.pictures', { size: sizeLabel(answer.content.mediaBytes, t) }),
            t('admin.count.rendersQueued', { count: answer.renders.queued }),
          ].join(' · ')}
          {' · '}
          {/* A queue that fails every night looks exactly like an empty one
              from every other screen, so the failures are the one figure here
              that changes colour. */}
          <span className={answer.renders.failed > 0 ? styles.trouble : undefined}>
            {t('admin.count.rendersFailed', { count: answer.renders.failed })}
          </span>
        </span>
      ) : stats.isPending ? (
        <span className={`mono ${styles.figure} ${styles.waitingFigure}`}>{t('home.waiting')}</span>
      ) : (
        <div className={styles.row}>
          <p className={ui.problem} role="alert">
            {stats.error instanceof ApiError && stats.error.status === 404 ? t('admin.health.statsMissing') : t('admin.health.statsFailed')}
          </p>
          <button type="button" className={ui.chip} disabled={stats.isFetching} onClick={() => void stats.refetch()}>
            {t('home.retry')}
          </button>
        </div>
      )}

      <ul className={styles.lines}>
        {answer ? (
          <li className="mono">{answer.retention ? <RetentionLine run={answer.retention} now={now} /> : t('admin.health.noRetention')}</li>
        ) : null}
        {answer ? (
          <li className="mono">
            <AlarmWatchLine watch={answer.alarmWatch} now={now} />
          </li>
        ) : null}
        <li className="mono">
          {demo.length === 0
            ? t('admin.health.noDemo')
            : t('admin.health.demo', {
                ofDevices: t('admin.count.ofDevices', { count: demo.length }),
                online: demoAlive.length,
                age: newest ? ageLabel(newest, now) : '—',
              })}
        </li>
        <li className="mono">
          {t('admin.health.updates', {
            installing: t('admin.count.installing', { count: updating }),
            gaveUp: t('admin.count.gaveUp', { count: gaveUp }),
          })}
        </li>
        {answer ? (
          <li className="mono">
            {t('admin.health.cameras', {
              cameras: t('admin.count.cameras', { count: answer.cameras.total }),
              quiet: t('admin.count.quietCameras', { count: answer.cameras.stale }),
            })}
          </li>
        ) : null}
        <li className="mono">{t('admin.health.unclassified', { devices: t('admin.count.devices', { count: fleet.unclassifiedDevices }) })}</li>
        <li className="mono">{t('admin.health.paused', { paused, ofClasses: t('admin.count.ofClasses', { count: fleet.classes.length }) })}</li>
      </ul>

      {/* Said plainly, because an operator who cannot see a figure should know
          whether it is zero or whether nobody is counting it. */}
      <p className={`${ui.note} ${styles.consequence}`}>
        {t('admin.health.notAnswered')}
        {answer ? '' : ` ${t('admin.health.statsGap')}`}
      </p>
    </section>
  );
}

/**
 * The sweep's last pass: the hour the board drew, how long ago that was so a
 * pass from three nights back reads as one, how far round the fleet it got,
 * and the devices it left as they were. Those errors are the figure this line
 * exists for, so they alone change colour when there are any.
 */
function RetentionLine({ run, now }: { run: AdminRetentionRun; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();

  return (
    <>
      {t('admin.health.retention', {
        time: clock(run.ranAt, zone),
        age: ageLabel(run.ranAt, now),
        reached: t('admin.count.reached', { count: run.reached }),
      })}
      {' · '}
      <span className={run.errors > 0 ? styles.trouble : undefined}>{t('admin.count.errors', { count: run.errors })}</span>
    </>
  );
}

/**
 * The offline watchdog's last pass, which is the one line on this card that is
 * about whether an alarm would be raised at all.
 *
 * The loop that writes it raises "device offline" and "camera not delivering",
 * and those are the only alarms on the install that nothing else can raise: a
 * threshold is answered by a reading arriving, and silence is not a reading. A
 * loop that cannot finish a pass therefore leaves every device without the rule
 * the cloud keeps for it, and every alerts inbox on the install saying that
 * nothing has gone wrong - which is exactly what a healthy fleet looks like
 * from every other screen. So the failures are drawn even when there is no pass
 * to date, and they and the devices the pass could not vouch for are what
 * changes colour, because either of them means a part of the fleet is not being
 * watched at this moment.
 */
function AlarmWatchLine({ watch, now }: { watch: AdminAlarmWatch; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const trouble = watch.failures > 0 || watch.unjudged > 0 || watch.ranAt === null;

  return (
    <>
      {watch.ranAt
        ? t('admin.health.alarmWatch', {
            time: clock(watch.ranAt, zone),
            age: ageLabel(watch.ranAt, now),
            watched: t('admin.count.watched', { count: watch.devices }),
          })
        : t('admin.health.noAlarmWatch')}
      {' · '}
      <span className={trouble ? styles.trouble : undefined}>
        {[t('admin.count.unjudged', { count: watch.unjudged }), t('admin.count.failedPasses', { count: watch.failures })].join(' · ')}
      </span>
    </>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What a bucket weighs, in the unit it is felt in. It is the export chip's own
 * formatter, so that one zip weighs the same on this card as on the account
 * page that offers it; what is added here is the bottom of the scale, because
 * an install with no picture in it yet holds bytes rather than a rounded
 * nothing, and a fresh one should read as empty rather than as broken.
 */
const sizeLabel = (bytes: number, t: Translate): string => (bytes < 1024 ? t('admin.count.bytes', { count: bytes }) : fileSize(bytes));
