import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Scheme, SchemeWeek } from '@fg2/shared-types/v1';
import { schemeVersionLabel, useDeleteScheme, useOwnSchemes, useScheme, useSchemes, useUpdateScheme, type SchemeSummary } from '@/api/schemes';
import { useSession } from '@/api/session';
import { Sheet } from '@/log/Sheet';
import { GridEditor } from '@/screens/grow/scheme/GridEditor';
import { SchemeGrid } from '@/screens/grow/scheme/SchemeGrid';
import { LoadFailed, Refused, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { calendarDay, useZone } from '@/ui/zone';
import { joined } from '../doors';
import { MePage } from '../parts';
import styles from './Schemes.module.css';

/** Which scheme is open over the list, and off which shelf. */
type Opened = { kind: 'asset'; id: string } | { kind: 'own'; id: string };

/**
 * Me › Feeding schemes: the two shelves.
 *
 * The first is what the build ships - a manufacturer's chart, read into the
 * grid and versioned by the chart's own date - and it is read-only here as it
 * is everywhere, because a shipped scheme corrected in place would silently
 * change what the next grow starts from. The second is the person's own, kept
 * from a grow's feeding tab, and those are edited here with the same editor
 * that grid has: a table, cell by cell, and the chips under it.
 *
 * What the page keeps saying is that the shelf and the grows are copies of
 * each other. A scheme edited or deleted here reaches no grow that is already
 * on it, which is what makes both safe to offer.
 */
export function Schemes() {
  const { t } = useTranslation();
  const { user } = useSession();
  const isDemo = user?.isDemo === true;
  const shipped = useSchemes();
  const own = useOwnSchemes(!isDemo);
  const [open, setOpen] = useState<Opened | null>(null);

  const opened = open?.kind === 'own' ? (own.data?.items.find(scheme => scheme.id === open.id) ?? null) : null;

  return (
    <MePage title={t('me.schemes.title')}>
      <span className="label">{t('me.schemes.shipped')}</span>
      {shipped.isPending ? (
        <Waiting lines={3} />
      ) : !shipped.data ? (
        <LoadFailed retry={() => void shipped.refetch()} />
      ) : shipped.data.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.schemes.noneShipped')}</p>
      ) : (
        shipped.data.map(summary => (
          <SchemeRow
            key={summary.id}
            title={summary.name}
            line={joined([summary.manufacturer, t('me.schemes.weeks', { count: summary.weeks }), schemeVersionLabel(summary.version)])}
            onOpen={() => setOpen({ kind: 'asset', id: summary.id })}
          />
        ))
      )}

      <span className="label">{t('me.schemes.mine')}</span>
      {isDemo ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.schemes.demo')}</p>
      ) : own.isPending ? (
        <Waiting lines={2} />
      ) : !own.data ? (
        <LoadFailed retry={() => void own.refetch()} />
      ) : own.data.items.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>
          {t('grow.scheme.sheet.noneSavedYet')} {t('me.schemes.howToKeep')}
        </p>
      ) : (
        own.data.items.map(scheme => (
          <SchemeRow
            key={scheme.id}
            title={scheme.name}
            line={joined([originLabel(t, scheme, shipped.data ?? []), t('me.schemes.weeks', { count: scheme.grid.length })])}
            onOpen={() => setOpen({ kind: 'own', id: scheme.id })}
          />
        ))
      )}
      {!isDemo ? <p className={ui.note}>{t('me.schemes.copyNote')}</p> : null}

      {open?.kind === 'asset' ? <AssetSheet id={open.id} onClose={() => setOpen(null)} /> : null}
      {opened ? <OwnSheet scheme={opened} shipped={shipped.data ?? []} onClose={() => setOpen(null)} /> : null}
    </MePage>
  );
}

/** Where an own scheme started: the chart it was kept from, by the name this build gives that chart, or by hand. */
const originLabel = (t: (key: string, options?: Record<string, unknown>) => string, scheme: Scheme, shipped: SchemeSummary[]): string =>
  scheme.origin.assetId === null
    ? t('me.schemes.byHand')
    : t('me.schemes.fromAsset', { name: shipped.find(summary => summary.id === scheme.origin.assetId)?.name ?? scheme.origin.assetId });

/** One scheme on a shelf: its name, one mono line about it, and the chevron that opens it. */
function SchemeRow({ title, line, onOpen }: { title: string; line: string; onOpen: () => void }) {
  return (
    <button type="button" className={`${ui.card} ${ui.joined} ${styles.schemeRow}`} onClick={onOpen}>
      <span className={styles.schemeText}>
        <span className={styles.schemeTitle}>{title}</span>
        <span className={`mono ${styles.schemeLine}`}>{line}</span>
      </span>
      <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/**
 * A shipped scheme, as the chart printed it. The grid is drawn without a
 * control on it, and the chart it was read from is linked under it so that
 * any figure can be taken back to what printed it.
 */
function AssetSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const zone = useZone();
  const asset = useScheme(id);

  return (
    <Sheet
      title={asset.data?.name ?? t('me.schemes.title')}
      aside={asset.data ? schemeVersionLabel(asset.data.version) : undefined}
      onClose={onClose}
    >
      {asset.isPending ? (
        <Waiting lines={4} />
      ) : !asset.data ? (
        <p className={ui.problem}>{t('grow.new.schemeUnreadable')}</p>
      ) : (
        <div className={styles.sheetBody}>
          <p className={`mono ${styles.meta}`}>
            {joined([
              asset.data.manufacturer,
              t('me.schemes.weeks', { count: asset.data.grid.length }),
              t('me.schemes.flip', { week: asset.data.flipWeek }),
            ])}
          </p>
          <SchemeGrid
            grid={asset.data.grid}
            currentWeek={null}
            mayEdit={false}
            waterEc={null}
            picked={null}
            onPick={() => undefined}
            onChange={() => undefined}
          />
          <p className={styles.caption}>
            {t('me.schemes.readFrom')}{' '}
            <a href={asset.data.source.url} target="_blank" rel="noreferrer">
              {asset.data.source.title}
            </a>{' '}
            · {t('me.schemes.readAt', { date: calendarDay(asset.data.source.readAt, zone) })} · {t('grow.scheme.chartCaption')}
          </p>
        </div>
      )}
    </Sheet>
  );
}

/**
 * One of the person's own, open for editing: its name, the grid with the
 * same editor a grow's feeding tab has, and the way to be rid of it.
 *
 * Nothing is written until Save, and Save sends the name and the whole grid
 * together, so that what the shelf holds afterwards is exactly what was on
 * the screen. Deleting asks once, in place, in words that say what it does not
 * do: a grow already fed by this scheme keeps its own grid.
 */
function OwnSheet({ scheme, shipped, onClose }: { scheme: Scheme; shipped: SchemeSummary[]; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateScheme();
  const remove = useDeleteScheme();
  const [name, setName] = useState(scheme.name);
  const [grid, setGrid] = useState<SchemeWeek[]>(scheme.grid);
  const [asking, setAsking] = useState(false);

  const origin = shipped.find(summary => summary.id === scheme.origin.assetId) ?? null;
  const asset = useScheme(origin?.id ?? null);
  const published = asset.data?.grid ?? null;
  const dirty = name.trim() !== scheme.name || !same(grid, scheme.grid);
  const left = published !== null && !same(grid, published);

  return (
    <Sheet
      title={scheme.name}
      aside={origin ? t('me.schemes.fromAsset', { name: origin.name }) : t('me.schemes.byHand')}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={!dirty || name.trim() === '' || update.isPending}
            onClick={() => update.mutate({ id: scheme.id, body: { name: name.trim(), grid } }, { onSuccess: onClose })}
          >
            {update.isPending ? t('me.schemes.saving') : t('me.schemes.save')}
          </button>
          <Refused error={update.error} />
        </>
      }
    >
      <div className={styles.sheetBody}>
        <label className={styles.field}>
          <span className="label">{t('me.schemes.name')}</span>
          <input className={ui.input} value={name} autoComplete="off" onChange={event => setName(event.target.value)} />
        </label>

        <GridEditor
          grid={grid}
          currentWeek={null}
          mayEdit
          waterEc={null}
          reset={left && published && origin ? { name: origin.name, onReset: () => setGrid(published) } : null}
          onEdit={next => setGrid(current => next(current))}
        >
          <p className={styles.caption}>{t('grow.scheme.howLine')}</p>
        </GridEditor>

        <p className={ui.note}>{t('me.schemes.copyNote')}</p>

        {asking ? (
          <div className={styles.asking}>
            <p className={ui.note}>{t('me.schemes.deleteAsk', { name: scheme.name })}</p>
            <div className={styles.askingActions}>
              <button
                type="button"
                className={`${ui.button} ${styles.dangerButton}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(scheme.id, { onSuccess: onClose })}
              >
                {t('me.schemes.deleteYes')}
              </button>
              <button type="button" className={ui.button} onClick={() => setAsking(false)}>
                {t('me.schemes.cancel')}
              </button>
            </div>
            <Refused error={remove.error} />
          </div>
        ) : (
          <div>
            <button type="button" className={`${ui.chip} ${styles.danger}`} onClick={() => setAsking(true)}>
              {t('me.schemes.delete')}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Whether two grids say the same thing, which is what "there is something to save" is read off. */
const same = (one: SchemeWeek[], other: SchemeWeek[]): boolean => JSON.stringify(one) === JSON.stringify(other);
