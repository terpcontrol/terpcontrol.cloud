import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, GrowScheme, Scheme, SchemeWeek } from '@fg2/shared-types/v1';
import { growSchemeOf, schemeVersionLabel, useCreateScheme, useScheme, type SchemeSummary } from '@/api/schemes';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Scheme.module.css';

interface SchemeSheetProps {
  grow: GrowListItem;
  /** The schemes this build ships, and the ones this person has written; a chip does not say which shelf it came off except by its own caption. */
  shipped: SchemeSummary[];
  own: Scheme[];
  /** The draft as it stands on the screen, which is what "save as my own" copies - edits and all. */
  grid: SchemeWeek[];
  onSwitch: (scheme: GrowScheme | null) => void;
  onClose: () => void;
}

/**
 * Where a grow's scheme is chosen, and where a grid becomes a scheme of one's
 * own.
 *
 * The two belong together because they are the two ends of the same shelf: a
 * grower who has spent a season correcting Biobizz's chart saves it here, and
 * the next grow starts from it. What the sheet has to be plain about is that
 * the shelf and the grow are copies of each other and not the same thing -
 * switching replaces this grow's grid, and editing a saved scheme afterwards
 * reaches no grow at all.
 */
export function SchemeSheet({ grow, shipped, own, grid, onSwitch, onClose }: SchemeSheetProps) {
  const { t } = useTranslation();
  const scheme = grow.scheme;
  // The sheet opens on where the grow already is, so that what it offers is a
  // change rather than a default: a "No scheme" waiting under the thumb is the
  // one answer nobody came here to give.
  const [choice, setChoice] = useState<string | null>(nowOn(scheme));
  const [name, setName] = useState('');
  const asset = useScheme(shipped.some(summary => summary.id === choice) ? choice : null);
  const create = useCreateScheme();

  const ownChoice = own.find(one => one.id === choice) ?? null;
  const ready = choice !== nowOn(scheme) && (choice === null || ownChoice !== null || asset.data !== undefined);

  // Switching takes the new scheme as published and keeps what is the grow's
  // own: the strength somebody settled on does not belong to the chart.
  const apply = () => {
    if (choice === null) return onSwitch(null);
    if (ownChoice) return onSwitch(ofOwn(ownChoice, scheme));
    if (!asset.data) return undefined;
    const fresh = growSchemeOf(asset.data, { type: grow.type, waterEc: scheme?.waterEc ?? null });
    return onSwitch(scheme ? { ...fresh, strength: scheme.strength } : fresh);
  };

  const saveOwn = () =>
    create.mutate({
      name: name.trim(),
      origin: scheme?.origin.type === 'asset' ? { assetId: scheme.origin.assetId, version: scheme.origin.version } : { assetId: null, version: null },
      grid,
    });

  return (
    <Sheet title={t('grow.scheme.sheet.title')} onClose={onClose}>
      <div className={styles.sheetBody}>
        <Block label={t('grow.scheme.sheet.follows')} aside={<span className="mono">{t('grow.scheme.sheet.replaces')}</span>}>
          <Choices label={t('grow.scheme.sheet.follows')}>
            {shipped.map(summary => (
              <Choice key={summary.id} chosen={choice === summary.id} onChoose={() => setChoice(summary.id)}>
                {summary.name} · {schemeVersionLabel(summary.version)}
              </Choice>
            ))}
            {own.map(one => (
              <Choice key={one.id} chosen={choice === one.id} onChoose={() => setChoice(one.id)}>
                {one.name} · {t('grow.scheme.sheet.mine')}
              </Choice>
            ))}
            <Choice chosen={choice === null} onChoose={() => setChoice(null)}>
              {t('grow.scheme.sheet.none')}
            </Choice>
          </Choices>
          {own.length === 0 ? <p className={ui.note}>{t('grow.scheme.sheet.noneSavedYet')}</p> : null}
          {scheme?.edited ? <p className={ui.note}>{t('grow.scheme.sheet.editedWarning')}</p> : null}
          {asset.isError ? <p className={ui.problem}>{t('grow.new.schemeUnreadable')}</p> : null}
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={!ready} onClick={apply}>
            {choice === null ? t('grow.scheme.sheet.useNone') : t('grow.scheme.sheet.use')}
          </button>
        </Block>

        {grid.length > 0 ? (
          <Block label={t('grow.scheme.sheet.saveOwn')}>
            <p className={ui.note}>{t('grow.scheme.sheet.saveOwnNote')}</p>
            <div className={styles.saveOwn}>
              <input
                className={`${ui.input} ${styles.saveOwnName}`}
                value={name}
                placeholder={t('grow.scheme.sheet.namePlaceholder')}
                aria-label={t('grow.scheme.sheet.name')}
                autoComplete="off"
                onChange={event => setName(event.target.value)}
              />
              <button type="button" className={ui.button} disabled={name.trim() === '' || create.isPending} onClick={saveOwn}>
                {create.isPending ? t('grow.scheme.saving') : t('grow.scheme.sheet.save')}
              </button>
            </div>
            {create.isSuccess ? (
              <p className={ui.note} role="status">
                {t('grow.scheme.sheet.saved', { name: create.data.name })}
              </p>
            ) : null}
            <Refused error={create.error} />
          </Block>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Which chip is this grow's today, so that the sheet opens on it. */
const nowOn = (scheme: GrowScheme | null): string | null =>
  scheme === null ? null : scheme.origin.type === 'own' ? scheme.origin.schemeId : scheme.origin.assetId;

/**
 * A scheme off the shelf, as this grow's own grid. The flip is read back out of
 * the grid, because a saved scheme states its stages and nothing else: the week
 * its bloom begins is the week it calls flowering.
 */
const ofOwn = (scheme: Scheme, was: GrowScheme | null): GrowScheme => ({
  origin: { type: 'own', schemeId: scheme.id },
  strength: was?.strength ?? 1,
  waterEc: was?.waterEc ?? null,
  plantType: was?.plantType ?? '',
  flipWeek: scheme.grid.find(week => week.stage === 'flowering')?.week ?? null,
  edited: false,
  grid: scheme.grid,
});
