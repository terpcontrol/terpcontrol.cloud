import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SchemeWeek } from '@fg2/shared-types/v1';
import { productsOf, valueAt, type Product } from './grid';
import styles from './Scheme.module.css';

interface SchemeGridProps {
  grid: SchemeWeek[];
  /** The week the grow is in, marked down the column so the row being fed today is findable. */
  currentWeek: number | null;
  /** False for a session that may only look: the figures are the same, and nothing about them is a control. */
  mayEdit: boolean;
  /** The row the chips act on, which is how a product is removed without a button in every row. */
  picked: string | null;
  onPick: (productKey: string | null) => void;
  onChange: (weekNumber: number, product: Product, value: number | null) => void;
}

/**
 * The grid as it is printed: a row per product, a column per week.
 *
 * It is a real table because that is what it is - a week is a column heading
 * and a product is a row heading, and a screen reader that is told so can read
 * a figure back with both. The weeks run off the side of a phone rather than
 * being folded away, and the product column stays put while they scroll, so
 * that a figure never loses the row it belongs to.
 *
 * A cell is edited where it stands. An empty cell is "not this week" rather
 * than zero, which is the difference between a row that has stopped and a row
 * that is dosed at nothing, and the grid is read that way everywhere else.
 */
export function SchemeGrid({ grid, currentWeek, mayEdit, picked, onPick, onChange }: SchemeGridProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ week: number; productKey: string } | null>(null);
  const current = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    current.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, []);

  const products = productsOf(grid);
  // The corner carries the unit most of the rows are in, so that only the row
  // measured in something else has to repeat it beside its name.
  const corner = commonUnit(products) ?? t('grow.scheme.perLitre');

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.corner} scope="col">
              {corner}
            </th>
            {grid.map(week => (
              <th
                key={week.week}
                className={styles.weekHead}
                scope="col"
                data-current={week.week === currentWeek}
                ref={week.week === currentWeek ? current : null}
              >
                {t('grow.scheme.weekShort', { week: week.week })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map(product => (
            <tr key={product.productKey}>
              <th className={styles.rowHead} scope="row" data-picked={picked === product.productKey}>
                {mayEdit ? (
                  <button
                    type="button"
                    className={`${styles.cellButton} ${styles.rowName}`}
                    onClick={() => onPick(picked === product.productKey ? null : product.productKey)}
                  >
                    {product.name}
                  </button>
                ) : (
                  <span className={styles.rowName}>{product.name}</span>
                )}
                {product.unit !== corner ? <span className={styles.rowUnit}>{product.unit}</span> : null}
              </th>
              {grid.map(week => {
                const value = valueAt(grid, week.week, product.productKey);
                const label = t('grow.scheme.cellLabel', { product: product.name, week: week.week });
                const open = editing?.week === week.week && editing.productKey === product.productKey;

                return (
                  <td key={week.week} className={styles.cell} data-current={week.week === currentWeek}>
                    {open ? (
                      <CellInput
                        label={label}
                        value={value}
                        onDone={next => {
                          if (next !== value) onChange(week.week, product, next);
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : mayEdit ? (
                      <button
                        type="button"
                        className={styles.cellButton}
                        aria-label={label}
                        onClick={() => setEditing({ week: week.week, productKey: product.productKey })}
                      >
                        {figure(value)}
                      </button>
                    ) : (
                      <span className={value === null ? styles.empty : undefined}>{figure(value)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The unit the most rows are measured in, or nothing at all where there are no rows. */
const commonUnit = (products: Product[]): string | null => {
  const counts = new Map<string, number>();
  for (const product of products) counts.set(product.unit, (counts.get(product.unit) ?? 0) + 1);
  return [...counts.entries()].sort(([, one], [, other]) => other - one)[0]?.[0] ?? null;
};

/** An en dash is "not this week": a cell nobody doses, which is not a cell dosed at zero. */
const figure = (value: number | null): string => (value === null ? '–' : String(value));

/**
 * One cell, open. It commits when the cursor leaves it, so that tapping the
 * next cell records the one just typed rather than throwing it away; Escape is
 * the way to change nothing, and anything that is not a number is that too.
 */
function CellInput({
  label,
  value,
  onDone,
  onCancel,
}: {
  label: string;
  value: number | null;
  onDone: (value: number | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '') return onDone(null);
    const next = Number(trimmed.replace(',', '.'));
    return Number.isFinite(next) && next >= 0 ? onDone(next) : onCancel();
  };

  return (
    <input
      className={styles.cellInput}
      aria-label={label}
      inputMode="decimal"
      autoFocus
      value={text}
      onChange={event => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') onCancel();
      }}
    />
  );
}
