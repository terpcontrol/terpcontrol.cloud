import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SchemeWeek } from '@fg2/shared-types/v1';
import ui from '@/ui/ui.module.css';
import {
  flowerWeeks,
  productKeyFor,
  productsOf,
  withFlowerWeeks,
  withLastWeekRepeated,
  withProduct,
  withValue,
  withoutProduct,
  type Product,
} from './grid';
import { SchemeGrid } from './SchemeGrid';
import styles from './Scheme.module.css';

/** The bloom most strains are given when the chart runs out first. The chip only ever offers to reach it. */
const LONG_BLOOM = 10;

/** What a row can be measured in. Both are per litre, which is what the feed sheet multiplies by the can. */
const UNITS = ['ml/l', 'g/l'];

interface GridEditorProps {
  grid: SchemeWeek[];
  /** The week the grow is in, marked down the column; null on a shelf, where no week is this week. */
  currentWeek: number | null;
  /** False for a session that may only look: the grid is drawn, and none of the chips. */
  mayEdit: boolean;
  /** What the grower's own water measures, which the EC row is drawn on top of. Null where nobody has said. */
  waterEc: number | null;
  /** The chart this grid can be put back to, where there is one and the grid has left it; null draws no such chip. */
  reset: { name: string; onReset: () => void } | null;
  /** Every change of the grid, as a function of the grid it changes, so the caller marks it edited by the same hand. */
  onEdit: (next: (grid: SchemeWeek[]) => SchemeWeek[]) => void;
  /** What is said under the grid, before the chips that change it. */
  children?: ReactNode;
}

/**
 * The grid and everything that changes it: a cell at a time in the table, and
 * the chips underneath for the edits that touch more than one - a product
 * added to every week, the last week repeated, the bloom stretched, a product
 * taken out, the whole thing put back to the chart it came from.
 *
 * It is one component because it is edited from two places - the grow that is
 * being fed, and the shelf a scheme is kept on - and a grid that could be
 * corrected one way here and another way there would be two editors for one
 * table. What it does not hold is the draft: whether an edit is saved, and to
 * what, is the caller's, which is why every change goes out as a function of
 * the grid rather than as a grid.
 */
export function GridEditor({ grid, currentWeek, mayEdit, waterEc, reset, onEdit, children }: GridEditorProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const products = productsOf(grid);
  const pickedProduct = products.find(product => product.productKey === picked) ?? null;

  return (
    <>
      <SchemeGrid
        grid={grid}
        currentWeek={currentWeek}
        mayEdit={mayEdit}
        waterEc={waterEc}
        picked={picked}
        onPick={setPicked}
        onChange={(week, product, value) => onEdit(current => withValue(current, week, product, value))}
      />

      {children}

      {mayEdit ? (
        <>
          <div className={styles.chips}>
            <button type="button" className={ui.chip} onClick={() => setAdding(value => !value)}>
              {t('grow.scheme.addProduct')}
            </button>
            <button type="button" className={ui.chip} onClick={() => onEdit(withLastWeekRepeated)}>
              {t('grow.scheme.repeatLastWeek')}
            </button>
            {flowerWeeks(grid) < LONG_BLOOM ? (
              <button type="button" className={ui.chip} onClick={() => onEdit(current => withFlowerWeeks(current, LONG_BLOOM))}>
                {t('grow.scheme.stretch', { count: LONG_BLOOM })}
              </button>
            ) : null}
            {reset ? (
              <button type="button" className={ui.chip} onClick={reset.onReset}>
                {t('grow.scheme.reset', { name: reset.name })}
              </button>
            ) : null}
            {pickedProduct ? (
              <button
                type="button"
                className={ui.chip}
                onClick={() => {
                  onEdit(current => withoutProduct(current, pickedProduct.productKey));
                  setPicked(null);
                }}
              >
                {t('grow.scheme.removeProduct', { name: pickedProduct.name })}
              </button>
            ) : null}
          </div>

          {adding ? (
            <AddProduct
              taken={products}
              onAdd={product => {
                onEdit(current => withProduct(current, product));
                setAdding(false);
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** A row of one's own: what it is called and what it is measured in. */
function AddProduct({ taken, onAdd }: { taken: Product[]; onAdd: (product: Product) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState(UNITS[0]);

  return (
    <div className={styles.newProduct}>
      <input
        className={`${ui.input} ${styles.newProductName}`}
        value={name}
        placeholder={t('grow.scheme.productPlaceholder')}
        aria-label={t('grow.scheme.productName')}
        autoComplete="off"
        onChange={event => setName(event.target.value)}
      />
      <select className={styles.newProductUnit} aria-label={t('grow.scheme.unit')} value={unit} onChange={event => setUnit(event.target.value)}>
        {UNITS.map(one => (
          <option key={one} value={one}>
            {one}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={ui.button}
        disabled={name.trim() === ''}
        onClick={() => onAdd({ productKey: productKeyFor(name.trim(), taken), name: name.trim(), unit })}
      >
        {t('grow.scheme.add')}
      </button>
    </div>
  );
}
