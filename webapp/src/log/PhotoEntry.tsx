import { Camera, ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadPhoto, writeEntry } from '@/api/entries';
import { useHome } from '@/api/home';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { useNow } from '@/ui/useNow';
import ui from '@/ui/ui.module.css';
import { about, lineLabel } from './lines';
import { useLog, type LogTarget } from './log-context';
import { Sheet } from './Sheet';
import styles from './Log.module.css';

/**
 * The photo entry: the picture the tent already took, or one taken now, tagged
 * with what was done while standing there.
 *
 * The cam still costs nothing - it exists, and the line simply names it - which
 * is why it is the side the sheet opens on wherever there is a cam, and the
 * phone's camera where there is none. A picture off the phone is uploaded first
 * and the entry names it afterwards; both go through the queue, so the sheet
 * closes on Save and the upload happens behind the toast.
 */

/** What the board offers to tag a picture with. Anything else is typed as "own". */
const TAGS = ['watered', 'fed', 'topped', 'defoliated', 'transplanted', 'pestCheck'];

export function PhotoEntry({ target, onClose }: { target: LogTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const now = useNow();
  const { log } = useLog();
  const { data: home } = useHome();

  const still = home?.spaces.find(card => card.spaceId === target.standsIn)?.latestStill ?? null;
  const [taken, setTaken] = useState<{ file: File; url: string } | null>(null);
  // The cam still costs nothing, so it is the side the sheet opens on wherever
  // there is one - and where there is none, the camera in the pocket is, rather
  // than an empty frame with the only way on greyed out beside it.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const fromCam = chosen ?? Boolean(still);
  const [tags, setTags] = useState<string[]>([]);
  const [own, setOwn] = useState('');
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const shown = useRef<string | null>(null);

  const camPicture = still ? mediaUrl(still.mediaId, THUMBNAIL_WIDTH.still) : null;
  const picture = fromCam ? camPicture : (taken?.url ?? null);

  /** The chosen file as something an <img> can show. The one before it is let go of here, and the last one on the way out. */
  const pick = (picked: File | null) => {
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = picked ? URL.createObjectURL(picked) : null;
    setTaken(picked && shown.current ? { file: picked, url: shown.current } : null);
    if (picked) setChosen(false);
  };

  useEffect(() => () => void (shown.current && URL.revokeObjectURL(shown.current)), []);

  const toggle = (tag: string) => setTags(current => (current.includes(tag) ? current.filter(one => one !== tag) : [...current, tag]));

  const save = () => {
    const words = [...tags.map(tag => t(`log.tags.${tag}`, { defaultValue: tag })), note.trim()].filter(Boolean).join(' · ');
    const text = words || null;

    if (fromCam && still) {
      log({
        label: lineLabel(t, 'photo', target),
        send: () =>
          writeEntry({ kind: 'photo', ...about(target), cameraId: still.cameraId, mediaIds: [still.mediaId], text, values: { kind: 'photo' } }),
      });
      return;
    }
    if (!taken) return;
    const { file: picture } = taken;

    log({
      label: lineLabel(t, 'photo', target),
      send: async () => {
        const media = await uploadPhoto(picture, { growId: target.growId, spaceId: target.growId ? null : (target.spaceId ?? target.standsIn) });
        return writeEntry({ kind: 'photo', ...about(target), mediaIds: [media.id], text, values: { kind: 'photo' } });
      },
    });
  };

  return (
    <Sheet
      title={t('log.photoTitle')}
      aside={
        <span className={styles.segmented}>
          <button type="button" data-chosen={fromCam} disabled={!still} onClick={() => setChosen(true)}>
            {t('log.camStill')}
          </button>
          <button type="button" data-chosen={!fromCam} onClick={() => setChosen(false)}>
            {t('log.takePhoto')}
          </button>
        </span>
      }
      onClose={onClose}
    >
      <div className={styles.picture}>
        {picture ? (
          <img src={picture} alt={t('log.pictureAlt')} />
        ) : (
          <button type="button" className={styles.pictureEmpty} onClick={() => file.current?.click()}>
            {fromCam ? <ImageOff size={20} strokeWidth={1.5} aria-hidden /> : <Camera size={20} strokeWidth={1.5} aria-hidden />}
            <span className={ui.note}>{fromCam ? t('log.noCam') : t('log.choosePicture')}</span>
          </button>
        )}
        {fromCam && still ? <span className={`mono ${styles.pictureStamp}`}>{t('log.camAge', { age: ageLabel(still.capturedAt, now) })}</span> : null}
      </div>

      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.file}
        onChange={event => pick(event.target.files?.[0] ?? null)}
      />
      {!fromCam && taken ? (
        <button type="button" className={`${ui.button} ${styles.retake}`} onClick={() => file.current?.click()}>
          {t('log.choosePicture')}
        </button>
      ) : null}

      <span className="label">{t('log.tagWhatYouDid')}</span>
      <div className={styles.tags}>
        {TAGS.map(tag => (
          <button
            key={tag}
            type="button"
            className={`${ui.chip} ${styles.target}`}
            data-chosen={tags.includes(tag)}
            aria-pressed={tags.includes(tag)}
            onClick={() => toggle(tag)}
          >
            {t(`log.tags.${tag}`)}
          </button>
        ))}
        {tags
          .filter(tag => !TAGS.includes(tag))
          .map(tag => (
            <button key={tag} type="button" className={`${ui.chip} ${styles.target}`} data-chosen aria-pressed onClick={() => toggle(tag)}>
              {tag}
            </button>
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

      <button type="button" className={`${ui.button} ${ui.primary} ${styles.save}`} onClick={save} disabled={fromCam ? !still : !taken}>
        {target.dayNumber === null ? t('log.save') : t('log.saveDay', { day: target.dayNumber })}
      </button>
    </Sheet>
  );
}
