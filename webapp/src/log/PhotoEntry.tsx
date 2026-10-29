import { Camera, Plus, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import { uploadPhoto, writeEntry } from '@/api/entries';
import { useGrow } from '@/api/grows';
import { Choice } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { dayAt } from './defaults';
import { about, lineLabel, occurredAt } from './lines';
import { useLog, type LogTarget } from './log-context';
import { Moment } from './Moment';
import { takenAt } from './taken-at';
import { Sheet } from '@/ui/Sheet';
import styles from './Log.module.css';

/**
 * The photo entry: pictures off the phone, tagged with what was done while
 * standing there. The tent's cam takes its own pictures and the timeline shows
 * them; a line in the diary is for what the grower saw up close.
 *
 * The pictures are uploaded first and the entry names them afterwards; both go
 * through the queue, so the sheet closes on Save and the uploads happen behind
 * the toast, which counts them. A turn is sent with the upload rather than baked in here, so the
 * server turns the original - HEIC included - and not a re-encoded copy.
 *
 * The line is dated to when the first picture was taken, where the file says,
 * so a picture from last week lands on last week's day without anybody typing
 * it; the moment in the corner says so and can still be changed, and once it
 * has been changed by hand no later picture moves it again.
 */

/** What the board offers to tag a picture with. Anything else is typed as "own". */
const TAGS = ['watered', 'fed', 'topped', 'defoliated', 'transplanted', 'pestCheck'];

/**
 * How many pictures go up at once. One after another, nine phone pictures held
 * the toast for minutes; all at once, they share one slow uplink and each runs
 * into the request time-out. Three keeps the line moving without either.
 */
const PARALLEL_UPLOADS = 3;

type Picked = { file: File; url: string; rotate: number };

export function PhotoEntry({ target, onClose }: { target: LogTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const { log } = useLog();
  const zone = useZone();
  const { data: grow } = useGrow(target.growId);
  const [pictures, setPictures] = useState<Picked[]>([]);
  /** When the line happened, or null for now; `fromPicture` says the first picture's file named it. */
  const [at, setAt] = useState<Date | null>(null);
  const [fromPicture, setFromPicture] = useState(false);
  const byHand = useRef(false);
  const [tags, setTags] = useState<string[]>([]);
  const [own, setOwn] = useState('');
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  // Every URL handed out, so leaving the sheet lets go of them all - including ones whose picture was removed meanwhile.
  const urls = useRef<string[]>([]);

  const add = (files: FileList | null) => {
    const added = Array.from(files ?? []).map(picked => ({ file: picked, url: URL.createObjectURL(picked), rotate: 0 }));
    urls.current.push(...added.map(one => one.url));
    if (pictures.length === 0 && added.length > 0 && !byHand.current) {
      void takenAt(added[0].file, zone).then(taken => {
        // A camera whose clock runs ahead is not believed past now.
        if (!taken || byHand.current || taken.getTime() > serverNow().toMillis()) return;
        setAt(taken);
        setFromPicture(true);
      });
    }
    setPictures(current => [...current, ...added]);
  };
  const turn = (url: string) => setPictures(current => current.map(one => (one.url === url ? { ...one, rotate: (one.rotate + 90) % 360 } : one)));
  const remove = (url: string) => setPictures(current => current.filter(one => one.url !== url));

  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);

  const toggle = (tag: string) => setTags(current => (current.includes(tag) ? current.filter(one => one !== tag) : [...current, tag]));

  // The grow day the line is filed under is the one it is dated to.
  const filed = at ? { ...target, dayNumber: dayAt(grow, target, at) } : target;

  const save = () => {
    if (pictures.length === 0) return;
    const words = [...tags.map(tag => t(`log.tags.${tag}`, { defaultValue: tag })), note.trim()].filter(Boolean).join(' · ');
    const owner = { growId: target.growId, spaceId: target.growId ? null : (target.spaceId ?? target.standsIn) };

    // Outlives one attempt, so Try again sends only the pictures that did not arrive.
    const mediaIds: (string | null)[] = pictures.map(() => null);

    log({
      label: lineLabel(t, 'photo', filed),
      send: async progress => {
        const done = () => mediaIds.filter(Boolean).length;
        progress(done(), pictures.length);
        const waiting = pictures.map((_, index) => index).filter(index => mediaIds[index] === null);
        const upload = async (): Promise<void> => {
          const index = waiting.shift();
          if (index === undefined) return;
          const picture = pictures[index];
          mediaIds[index] = (await uploadPhoto(picture.file, owner, picture.rotate)).id;
          progress(done(), pictures.length);
          return upload();
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, waiting.length) }, upload));
        return writeEntry({
          kind: 'photo',
          ...about(target),
          ...occurredAt(at),
          mediaIds: mediaIds.filter((id): id is string => id !== null),
          text: words || null,
          values: { kind: 'photo' },
        });
      },
    });
  };

  return (
    <Sheet
      title={t('log.photoTitle')}
      corner={
        <Moment
          at={at}
          onChange={next => {
            byHand.current = true;
            setAt(next);
            setFromPicture(false);
          }}
        />
      }
      onClose={onClose}
    >
      {pictures.length === 0 ? (
        <div className={styles.picture}>
          <button type="button" className={styles.pictureEmpty} onClick={() => file.current?.click()}>
            <Camera size={20} strokeWidth={1.5} aria-hidden />
            <span className={ui.note}>{t('log.choosePicture')}</span>
          </button>
        </div>
      ) : (
        <div className={styles.pictures}>
          {pictures.map((picture, index) => (
            <div key={picture.url} className={styles.picked}>
              <img src={picture.url} alt={t('log.pictureAlt', { n: index + 1 })} style={{ transform: `rotate(${picture.rotate}deg)` }} />
              <button
                type="button"
                className={`${styles.pickedAction} ${styles.pickedTurn}`}
                aria-label={t('log.rotatePicture', { n: index + 1 })}
                onClick={() => turn(picture.url)}
              >
                <RotateCw size={16} strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                className={`${styles.pickedAction} ${styles.pickedRemove}`}
                aria-label={t('log.removePicture', { n: index + 1 })}
                onClick={() => remove(picture.url)}
              >
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          ))}
          <button type="button" className={styles.pickedAdd} onClick={() => file.current?.click()}>
            <Plus size={20} strokeWidth={1.5} aria-hidden />
            <span className={ui.note}>{t('log.addPicture')}</span>
          </button>
        </div>
      )}

      {fromPicture ? <p className={`mono ${styles.subject}`}>{t('log.moment.fromPicture')}</p> : null}

      {/* No capture attribute: it would open the camera straight away and leave no way to the pictures already taken. */}
      <input
        ref={file}
        type="file"
        accept="image/*"
        multiple
        className={styles.file}
        onChange={event => {
          add(event.target.files);
          event.target.value = '';
        }}
      />

      <span className="label">{t('log.tagWhatYouDid')}</span>
      <div className={styles.tags}>
        {TAGS.map(tag => (
          <Choice key={tag} chosen={tags.includes(tag)} onChoose={() => toggle(tag)}>
            {t(`log.tags.${tag}`)}
          </Choice>
        ))}
        {tags
          .filter(tag => !TAGS.includes(tag))
          .map(tag => (
            <Choice key={tag} chosen onChoose={() => toggle(tag)}>
              {tag}
            </Choice>
          ))}
        <input
          className={`${ui.chip} ${styles.ownTag}`}
          value={own}
          placeholder={t('log.ownTag')}
          onChange={event => setOwn(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || !own.trim()) return;
            event.preventDefault();
            setTags(current => [...current, own.trim()]);
            setOwn('');
          }}
        />
      </div>

      <input className={ui.input} value={note} placeholder={t('log.noteOptional')} onChange={event => setNote(event.target.value)} />

      <button type="button" className={`${ui.button} ${ui.primary} ${styles.save}`} onClick={save} disabled={pictures.length === 0}>
        {filed.dayNumber === null ? t('log.save') : t('log.saveDay', { day: filed.dayNumber })}
      </button>
    </Sheet>
  );
}
