import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowScheme, SchemeWeek } from '@fg2/shared-types/v1';
import { useUpdateGrow } from '@/api/grows';
import { growSchemeLabel, schemeVersionLabel, useOwnSchemes, useScheme, useSchemes } from '@/api/schemes';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { sameScheme, useSchemeEdit } from './scheme/edit-store';
import { hasEcTargets, withFlipWeek } from './scheme/grid';
import { GridEditor } from './scheme/GridEditor';
import { SchemeSheet } from './scheme/SchemeSheet';
import styles from './scheme/Scheme.module.css';

/** How strong a can is mixed, as the steps a grower actually reaches for; a grow already on something else keeps its own. */
const STRENGTHS = [0.5, 0.75, 1, 1.25];

/**
 * The Feeding tab: which scheme this grow is on, at what strength and on what
 * water, and the grid itself, editable cell by cell.
 *
 * The grid the grow carries is the grow's, not the scheme's. That is the one
 * thing this screen keeps saying, because everything about it invites the
 * opposite assumption: a correction made here feeds these plants and no
 * others, and a scheme saved to the shelf afterwards is a copy that reaches
 * nothing already growing. A grower who believes otherwise finds out in a
 * season they cannot have back.
 *
 * Nothing is written until Save. A grid is a table somebody works across, and
 * a PATCH per cell would put a dozen writes and a dozen chances of a refusal
 * between a thought and its result.
 *
 * That is also why the draft is held against the grid it was changed against
 * rather than seeded once. With nothing typed the screen follows the stored
 * grow, so a correction made on another device is what is drawn; with something
 * typed and the stored grow moved underneath it, the screen says so and asks
 * which grid is to stand, because the alternative is one grower's Save quietly
 * undoing another's.
 */
export function Feeding({ grow, mayManage }: { grow: GrowListItem; mayManage: boolean }) {
  const { t } = useTranslation();
  const shipped = useSchemes();
  const own = useOwnSchemes();
  const update = useUpdateGrow(grow.id);
  const queryClient = useQueryClient();

  const [edit, setEdit] = useSchemeEdit(grow.id);
  const [choosing, setChoosing] = useState(false);

  // With nothing typed the screen is the stored grow, so a correction saved
  // elsewhere is what is drawn rather than a grid that no longer feeds anything.
  const stored = grow.scheme;
  const draft = edit ? edit.draft : stored;
  const setDraft = (next: GrowScheme | null) => setEdit({ draft: next, against: stored });
  const dirty = !sameScheme(draft, stored);

  const origin = draft?.origin ?? null;
  // The published grid, for the chip that goes back to it: a shipped asset is
  // read from the bundle, one of the grower's own came with the shelf.
  const asset = useScheme(origin?.type === 'asset' ? origin.assetId : null);
  const ownOrigin = origin?.type === 'own' ? (own.data?.items.find(one => one.id === origin.schemeId) ?? null) : null;
  const published = origin?.type === 'own' ? (ownOrigin?.grid ?? null) : (asset.data?.grid ?? null);

  // Somebody else has saved this grid since this one was started, and the two
  // disagree. Until that is settled there is nothing honest for Save to send.
  const moved = edit !== null && dirty && !sameScheme(edit.against, stored);

  /** Every edit of the grid goes through here, so that "edited" is set by the same hand that changed a figure. */
  const editGrid = (next: (grid: SchemeWeek[]) => SchemeWeek[]) => {
    if (draft) setDraft({ ...draft, grid: next(draft.grid), edited: true });
  };

  const save = () =>
    update.mutate(
      { scheme: draft },
      {
        onSuccess: () => {
          setEdit(null);
          // The week cards carry the doses this grid states, so they are now stale.
          void queryClient.invalidateQueries({ queryKey: ['grow', grow.id, 'weeks'] });
        },
      },
    );

  // Taking a grow off its scheme leaves a draft of nothing, which is still a
  // change and still has to be saved: the empty state therefore carries the
  // same bar as the grid does rather than swallowing the decision.
  const unsaved =
    mayManage && dirty ? (
      <>
        <div className={styles.unsaved} role={moved ? 'alert' : undefined}>
          <span className={`mono ${styles.unsavedNote}`}>{moved ? t('grow.scheme.movedUnder') : t('grow.scheme.unsaved')}</span>
          <button type="button" className={ui.button} disabled={update.isPending} onClick={() => setEdit(null)}>
            {moved ? t('grow.scheme.takeTheirs') : t('grow.scheme.discard')}
          </button>
          {moved ? (
            <button type="button" className={ui.button} onClick={() => setEdit({ draft, against: stored })}>
              {t('grow.scheme.keepMine')}
            </button>
          ) : (
            <button type="button" className={`${ui.button} ${ui.primary}`} disabled={update.isPending} onClick={save}>
              {update.isPending ? t('grow.scheme.saving') : t('grow.scheme.save')}
            </button>
          )}
        </div>
        <Refused error={update.error} />
      </>
    ) : null;

  if (!draft) {
    return (
      <div className={styles.page}>
        <section className={ui.cardDashed}>
          <span className="label">{t('grow.noScheme')}</span>
          <p className={ui.note}>{t('grow.noSchemeNote')}</p>
        </section>
        {mayManage ? (
          <div className={styles.chips}>
            <button type="button" className={ui.button} onClick={() => setChoosing(true)}>
              {t('grow.scheme.choose')}
            </button>
          </div>
        ) : null}
        {unsaved}
        {choosing ? (
          <SchemeSheet
            grow={grow}
            shipped={shipped.data ?? []}
            own={own.data?.items ?? []}
            grid={[]}
            onSwitch={scheme => {
              setDraft(scheme);
              setChoosing(false);
            }}
            onClose={() => setChoosing(false)}
          />
        ) : null}
      </div>
    );
  }

  const fromAsset = draft.origin.type === 'asset' ? draft.origin : null;
  const label = growSchemeLabel(draft.origin, shipped.data ?? [], own.data?.items ?? [], t('grow.ownScheme'));
  const version = fromAsset ? schemeVersionLabel(fromAsset.version) : null;
  const plantTypes = fromAsset ? (shipped.data?.find(summary => summary.id === fromAsset.assetId)?.plantTypes ?? []) : [];
  const currentWeek = grow.summary.weekNumber;
  const strengths = [...new Set([...STRENGTHS, draft.strength])].sort((a, b) => a - b);

  return (
    <div className={styles.page}>
      <BasedOn
        name={label}
        edited={draft.edited}
        version={version}
        onOpen={mayManage ? () => setChoosing(true) : null}
        openLabel={t('grow.scheme.sheet.title')}
      />

      <div className={styles.settings}>
        <label className={`${ui.card} ${styles.setting}`}>
          <span className="label">{t('grow.scheme.strength')}</span>
          <select
            className={styles.settingValue}
            disabled={!mayManage}
            value={String(draft.strength)}
            onChange={event => setDraft({ ...draft, strength: Number(event.target.value) })}
          >
            {strengths.map(strength => (
              <option key={strength} value={strength}>
                {STRENGTHS.includes(strength)
                  ? t(`grow.scheme.strengthStep.${stepKey(strength)}`)
                  : t('grow.strength', { percent: Math.round(strength * 100) })}
              </option>
            ))}
          </select>
        </label>

        <label className={`${ui.card} ${styles.setting}`}>
          <span className="label">{t('grow.scheme.water')}</span>
          <span className={styles.waterRow}>
            <span className={styles.waterKind}>{t(waterKey(draft.waterEc))}</span>
            <input
              className={styles.settingValue}
              type="number"
              min={0}
              step={0.1}
              disabled={!mayManage}
              aria-label={t('grow.scheme.waterEc')}
              placeholder={t('grow.scheme.ecPlaceholder')}
              value={draft.waterEc ?? ''}
              onChange={event => setDraft({ ...draft, waterEc: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </span>
        </label>

        <label className={`${ui.card} ${styles.setting}`}>
          <span className="label">{t('grow.scheme.plantType')}</span>
          {plantTypes.length > 0 ? (
            <select
              className={styles.settingValue}
              disabled={!mayManage}
              value={draft.plantType}
              onChange={event => setDraft({ ...draft, plantType: event.target.value })}
            >
              {plantTypes.some(one => one.key === draft.plantType) ? null : <option value={draft.plantType}>{draft.plantType}</option>}
              {plantTypes.map(one => (
                <option key={one.key} value={one.key}>
                  {one.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={styles.settingValue}
              disabled={!mayManage}
              placeholder={t('grow.scheme.plantTypePlaceholder')}
              value={draft.plantType}
              onChange={event => setDraft({ ...draft, plantType: event.target.value })}
            />
          )}
        </label>

        <label className={`${ui.card} ${styles.setting}`}>
          <span className="label">{t('grow.scheme.flip')}</span>
          <select
            className={styles.settingValue}
            disabled={!mayManage}
            value={draft.flipWeek === null ? '' : String(draft.flipWeek)}
            onChange={event => {
              const flipWeek = event.target.value === '' ? null : Number(event.target.value);
              setDraft({ ...draft, flipWeek, grid: withFlipWeek(draft.grid, flipWeek) });
            }}
          >
            <option value="">{t('grow.scheme.noFlip')}</option>
            {draft.grid.map(week => (
              <option key={week.week} value={week.week}>
                {t('grow.scheme.weekShort', { week: week.week })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <GridEditor
        grid={draft.grid}
        currentWeek={currentWeek}
        mayEdit={mayManage}
        waterEc={draft.waterEc}
        reset={
          published && draft.edited
            ? {
                name: label,
                // Back to the chart as this build ships it, which for a
                // shipped asset also means the version this build ships.
                onReset: () =>
                  setDraft({
                    ...draft,
                    edited: false,
                    grid: published,
                    origin: draft.origin.type === 'asset' && asset.data ? { ...draft.origin, version: asset.data.version } : draft.origin,
                  }),
              }
            : null
        }
        onEdit={editGrid}
      >
        <p className={styles.note}>
          {currentWeek !== null ? `${t('grow.scheme.thisWeekLine', { week: currentWeek })} ` : ''}
          {draft.flipWeek !== null ? `${t('grow.scheme.flipLine', { week: draft.flipWeek })} ` : ''}
          {mayManage ? t('grow.scheme.howLine') : null}
        </p>
      </GridEditor>

      {unsaved}

      <p className={styles.caption}>
        {hasEcTargets(draft.grid) ? `${t('grow.scheme.ecCaption')} ` : ''}
        {t('grow.scheme.chartCaption')} {t('grow.scheme.honesty')}
      </p>

      {choosing ? (
        <SchemeSheet
          grow={grow}
          shipped={shipped.data ?? []}
          own={own.data?.items ?? []}
          grid={draft.grid}
          onSwitch={scheme => {
            setDraft(scheme);
            setChoosing(false);
          }}
          onClose={() => setChoosing(false)}
        />
      ) : null}
    </div>
  );
}

/** Where the grid came from, and whether it is still what that chart says. */
function BasedOn({
  name,
  edited,
  version,
  onOpen,
  openLabel,
}: {
  name: string;
  edited: boolean;
  version: string | null;
  /** Null for a session that may only look: there is nothing behind the card it could do. */
  onOpen: (() => void) | null;
  openLabel: string;
}) {
  const { t } = useTranslation();
  const inside = (
    <>
      <span>
        {t('grow.scheme.basedOn')} <span className={styles.basedOnName}>{name}</span>
      </span>
      <span className={`mono ${styles.basedOnAside}`}>
        {edited ? `${t('grow.edited')} · ` : ''}
        {version ?? ''}
        {onOpen ? <ChevronRight size={14} strokeWidth={1.75} aria-hidden /> : null}
      </span>
    </>
  );

  return onOpen ? (
    <button type="button" className={`${ui.card} ${styles.basedOn}`} aria-label={openLabel} onClick={onOpen}>
      {inside}
    </button>
  ) : (
    <section className={`${ui.card} ${styles.basedOn}`}>{inside}</section>
  );
}

/** A catalogue key for a step, since a decimal point is the separator in one. */
const stepKey = (strength: number): string => String(strength).replace('.', '_');

/** What the water is, read off its own EC: osmosis water measures nothing, tap water measures something, and an empty field says nobody has looked. */
const waterKey = (waterEc: number | null): string =>
  waterEc === null ? 'grow.scheme.waterUnknown' : waterEc === 0 ? 'grow.scheme.waterOsmosis' : 'grow.scheme.waterTap';
