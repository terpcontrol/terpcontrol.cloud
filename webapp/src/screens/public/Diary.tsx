import { ChevronRight, Leaf } from 'lucide-react';
import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowHarvest, PublicAuthor, PublicGrowPage } from '@fg2/shared-types/v1';
import { PUBLIC_WIDTH, type EarlierWeeks, type Picture } from '@/api/public';
import ui from '@/ui/ui.module.css';
import { DiaryWeek } from './DiaryWeek';
import { Photo } from '@/ui/Photo';
import styles from './Public.module.css';

interface DiaryProps {
  page: PublicGrowPage;
  picture: Picture;
  now: DateTime;
  /** Said above everything: the window a link puts its reader inside, where there is one. */
  banner?: ReactNode;
  /** Put beside the author, which is where a reader's one decision about the diary belongs. */
  aside?: ReactNode;
  /**
   * The weeks from before the ones the page carried, and the way to ask for
   * more of them. A diary longer than a page is otherwise a diary whose first
   * months nothing on the screen leads to.
   */
  earlier?: EarlierWeeks;
}

/**
 * A grow diary as somebody who is not in it reads it: the cover, who it is by,
 * what is growing, how far along it is, and then every week from the newest
 * back.
 *
 * It draws the answer and nothing else. Everything a reader may see has already
 * been clamped to their window and stripped by the owner's privacy before it
 * got here, so there is no id to look anything up by and nothing to ask a
 * second route for - which is what lets the same component serve a diary's own
 * address and a link onto it.
 */
export function Diary({ page, picture, now, banner, aside, earlier }: DiaryProps) {
  const { t } = useTranslation();
  const cover = page.coverMediaId ? picture(page.coverMediaId, PUBLIC_WIDTH.cover) : null;
  const weeks = [...page.weeks, ...(earlier?.weeks ?? [])];

  return (
    <article className={styles.diary}>
      {banner}

      <header className={styles.hero}>
        <Photo
          src={cover}
          alt={t('publicPage.coverAlt', { name: page.name })}
          className={styles.cover}
          fallback={<Leaf size={36} strokeWidth={1.25} aria-hidden />}
        />

        <div className={styles.titleRow}>
          <div className={styles.titles}>
            <h1 className={styles.title}>{page.name}</h1>
            <Author author={page.author} picture={picture} aside={aside} />
          </div>
          {page.dayNumber !== null ? (
            <div className={styles.day}>
              <span className={`figure ${styles.dayFigure}`}>{page.dayNumber}</span>
              {/* A grow that is over stopped counting on the day it ended, and
                  the figure beside this word is frozen there - so "day" reads
                  as a count still running on a diary the line underneath
                  already dates to last August. The end is the reader's own:
                  a link whose window closed before the grow did is inside a
                  diary that had not ended, exactly as the week cards on this
                  page are. */}
              <span className="label">{t(page.endedAt ? 'grow.finalDay' : 'home.card.day')}</span>
            </div>
          ) : null}
        </div>

        {page.description ? <p className={styles.description}>{page.description}</p> : null}
        <Facts page={page} />
      </header>

      {page.filmMediaId ? (
        <figure className={styles.film}>
          <video src={picture(page.filmMediaId)} controls preload="metadata" playsInline />
          <figcaption className={`mono ${styles.filmCaption}`}>{t('publicPage.film')}</figcaption>
        </figure>
      ) : null}

      <Totals page={page} />
      {page.harvest ? <Harvest harvest={page.harvest} /> : null}

      <section className={styles.weeks} aria-label={t('publicPage.weeks')}>
        {weeks.length === 0 ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('publicPage.nothingInWindow')}</p> : null}
        {weeks.map((week, index) => {
          // The server answers newest first, so the first card of a diary that
          // is still running is the week it is in; no clock of ours decides it.
          const current = index === 0 && page.endedAt === null;
          return (
            <DiaryWeek
              key={week.weekNumber}
              week={week}
              picture={picture}
              now={now}
              current={current}
              ended={page.endedAt !== null}
              asOf={current ? page.range.endsAt : null}
              explain={index === 0}
            />
          );
        })}
        {earlier?.more ? (
          <button type="button" className={ui.button} disabled={earlier.pending} onClick={earlier.more}>
            {earlier.pending ? t('home.waiting') : t('grow.earlierWeeks')}
          </button>
        ) : null}
      </section>
    </article>
  );
}

/**
 * Who the diary is by. The handle is the only name anybody here ever has; the
 * line of text and the picture are the profile, which is a separate thing its
 * owner decides to publish - so a handle with neither leads nowhere and is not
 * made a link.
 */
function Author({ author, picture, aside }: { author: PublicAuthor; picture: Picture; aside?: ReactNode }) {
  const published = author.bio !== null || author.avatarMediaId !== null;
  const avatar = author.avatarMediaId ? picture(author.avatarMediaId, PUBLIC_WIDTH.avatar) : null;

  const name = (
    <>
      <Photo src={avatar} alt="" className={styles.avatar} fallback={author.handle.slice(0, 2).toUpperCase()} />
      <span className={styles.handle}>@{author.handle}</span>
    </>
  );

  return (
    <>
      <div className={styles.author}>
        {published ? (
          <Link to={`/@${author.handle}`} className={styles.authorLink}>
            {name}
            <ChevronRight size={14} strokeWidth={2} aria-hidden />
          </Link>
        ) : (
          <span className={styles.authorLink}>{name}</span>
        )}
        {aside}
      </div>
      {author.bio ? <p className={styles.bio}>{author.bio}</p> : null}
    </>
  );
}

/** "Flowering · late flower · week 5 · Amnesia, Gelato · 3 plants · from 15 Aug" - what the diary is, in one line. */
function Facts({ page }: { page: PublicGrowPage }) {
  const { t } = useTranslation();
  const from = DateTime.fromISO(page.startedAt);
  const until = page.endedAt ? DateTime.fromISO(page.endedAt) : null;

  const parts = [
    page.stage ? (page.preset === 'late_flowering' ? t('grow.lateFlower') : t(`home.stage.${page.stage}`)) : t('home.card.noPhase'),
    // The week of the stage the word before it names, which is what the owner's
    // own header says and what the first card's pill repeats. The week of the
    // whole grow belongs to the cards' own headings: glued to a stage name it
    // told a reader that a grow had been curing for thirty-two weeks when it
    // had been curing for twelve.
    page.stageWeek !== null ? t('grow.week', { week: page.stageWeek }) : null,
    page.strains.length > 0 ? page.strains.join(', ') : null,
    page.plantCount ? t('home.card.plants', { count: page.plantCount }) : null,
    t(`publicPage.type.${page.type}`),
    until
      ? t('publicPage.ran', { from: from.toFormat('d LLL yyyy'), to: until.toFormat('d LLL yyyy') })
      : t('publicPage.since', { from: from.toFormat('d LLL yyyy') }),
  ].filter((part): part is string => Boolean(part));

  return <p className={`mono ${styles.facts}`}>{parts.join(' · ')}</p>;
}

/** The same five figures the owner's own Report tab counts, so a diary reads alike from both sides. */
function Totals({ page }: { page: PublicGrowPage }) {
  const { t } = useTranslation();
  const { totals } = page;

  return (
    <dl className={`${ui.strip} ${ui.stripEven} ${styles.totals}`}>
      {page.dayNumber !== null ? <Total value={page.dayNumber} label={t('grow.report.days')} /> : null}
      <Total value={totals.entryCount} label={t('grow.report.entries')} />
      <Total value={totals.waterCount} label={t('grow.report.waters')} />
      <Total value={totals.feedCount} label={t('grow.report.feeds')} />
      <Total value={totals.photoCount} label={t('grow.report.photos')} />
    </dl>
  );
}

function Total({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dd className={`figure ${ui.stripValue}`}>{value}</dd>
      <dt className="caption">{label}</dt>
    </div>
  );
}

/**
 * The harvest, where there is one. A weight the owner chose to keep to
 * themselves is not here at all rather than dashed out, which is why a null
 * weight simply drops its half of the line.
 */
function Harvest({ harvest }: { harvest: GrowHarvest }) {
  const { t } = useTranslation();
  const weights = [
    harvest.wetWeightG !== null ? t('grow.report.wet', { grams: harvest.wetWeightG }) : null,
    harvest.dryWeightG !== null ? t('grow.report.dry', { grams: harvest.dryWeightG }) : null,
  ].filter((part): part is string => part !== null);

  return (
    <p className={`mono ${styles.harvest}`}>
      {t('grow.report.harvest')}
      {harvest.harvestedAt ? ` · ${DateTime.fromISO(harvest.harvestedAt).toFormat('d LLL yyyy')}` : ''}
      {weights.length > 0 ? ` · ${weights.join(' · ')}` : ''}
    </p>
  );
}
