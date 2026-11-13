import { useState, type ReactNode } from 'react';
import { Refused } from './PageState';
import { Sheet } from './Sheet';
import { Block } from './SheetParts';
import ui from './ui.module.css';

/**
 * What something is called, put right: a field per name as it stands now,
 * anything else the sheet asks below them (`children`), and the one button
 * that saves, on the sheet's bottom edge. Every name is handed on trimmed;
 * `ready` says whether what stands there may be saved, which without it is
 * that no name is empty.
 */
export function NameSheet<K extends string>({
  title,
  aside,
  fields,
  children,
  error,
  busy,
  save,
  ready = names => Object.values(names).every(name => name !== ''),
  onSave,
  onClose,
}: {
  title: string;
  aside?: ReactNode;
  fields: Record<K, { label: string; value: string }>;
  children?: ReactNode;
  error: unknown;
  busy: boolean;
  /** The button's words, which while it saves are the caller's "saving". */
  save: string;
  ready?: (names: Record<K, string>) => boolean;
  onSave: (names: Record<K, string>) => void;
  onClose: () => void;
}) {
  const keys = Object.keys(fields) as K[];
  const [typed, setTyped] = useState(() => Object.fromEntries(keys.map(key => [key, fields[key].value])) as Record<K, string>);
  const names = Object.fromEntries(keys.map(key => [key, typed[key].trim()])) as Record<K, string>;

  return (
    <Sheet
      title={title}
      aside={aside}
      onClose={onClose}
      actions={
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy || !ready(names)} onClick={() => onSave(names)}>
          {save}
        </button>
      }
    >
      <div className={ui.sheetBody}>
        {keys.map(key => (
          <Block key={key} label={fields[key].label}>
            <input
              className={ui.input}
              value={typed[key]}
              aria-label={fields[key].label}
              autoComplete="off"
              onChange={event => setTyped({ ...typed, [key]: event.target.value })}
            />
          </Block>
        ))}
        {children}
        <Refused error={error} />
      </div>
    </Sheet>
  );
}
