import { Info } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { anchorOf, placeBubble, type HelpTopic } from './explain';
import styles from './Help.module.css';

/**
 * The app's one way of explaining itself: a short text that opens beside a
 * control, a heading or a word, and goes away again.
 *
 * There are two faces to it. `Help` is the small (i) beside a control or a
 * heading whose label cannot say everything; `Term` is a word in running text
 * that explains itself, drawn with a dotted underline. Both open the same
 * bubble from the same catalogue block, so a term reads the same wherever it
 * is met.
 *
 * It is a toggletip rather than a tooltip, because a tooltip that waits for a
 * hover does not exist on a phone: a tap or a click opens it and a second one
 * closes it, and so does reaching it with the keyboard - a keyboard has no
 * hover either, and Tab is how it arrives. A press anywhere else and Escape put
 * it away. The press that opens it also focuses the button in most browsers,
 * so a focus that a press brought is left to the click that follows, which
 * would otherwise close again what the focus had just opened.
 *
 * Escape is caught on its way down, before anything else hears it: an
 * explanation opened inside a sheet is the last thing opened, and Escape takes
 * back that, not the sheet round it.
 *
 * A screen reader does not have to open anything: the explanation is the
 * button's description from the start, so it is read out whenever the button
 * is reached. The bubble is drawn at the end of the document rather than where
 * it was opened - a card, a joined group and a sheet's scrolling body all clip
 * what overflows them, and a heading's text would otherwise carry the
 * explanation in it - and it stands where `placeBubble` says: above the line
 * it explains when it fits, clear of the short block it stands in, so it
 * covers neither the word, nor the sentence, nor the control it is about.
 */

/** The one explanation open at a time: opening another puts this one away. */
let putAway: (() => void) | null = null;

/** Keeps a press or a click inside the explanation from reaching a row it stands in, such as a card that opens on a tap. */
const keep = (event: SyntheticEvent) => event.stopPropagation();

function useExplanation(topic: HelpTopic) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  /** A press is under way: the focus it brings is not a keyboard's, and the click after it decides. */
  const pressing = useRef(false);
  /** The focus is being handed back after Escape, and must not open the bubble again. */
  const returning = useRef(false);
  const id = useId();
  const textId = `${id}-text`;
  const bubbleId = `${id}-bubble`;
  const title = t(`help.${topic}.title`);
  const text = t(`help.${topic}.text`);

  const close = useCallback(() => setOpen(false), []);
  const show = useCallback(() => {
    if (putAway && putAway !== close) putAway();
    putAway = close;
    setOpen(true);
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      if (bubble.current?.contains(document.activeElement)) {
        returning.current = true;
        trigger.current?.focus();
        returning.current = false;
      }
      setOpen(false);
    };
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || bubble.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPress, true);
      if (putAway === close) putAway = null;
    };
  }, [open, close]);

  // Placed before it is painted, and again whenever the page or a sheet
  // scrolls under it or the window changes; once its trigger has left the
  // window there is nothing left for it to point at, and it goes.
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): boolean => {
      const button = trigger.current?.getBoundingClientRect();
      const box = bubble.current;
      const content = box?.firstElementChild;
      if (!button || !box || !content) return true;
      if (button.bottom < 0 || button.top > window.innerHeight) return false;
      const anchor = anchorOf(button, trigger.current?.parentElement?.getBoundingClientRect() ?? null);
      const height = box.offsetHeight - content.clientHeight + content.scrollHeight;
      const at = placeBubble(anchor, { width: box.offsetWidth, height }, { width: window.innerWidth, height: window.innerHeight });
      box.style.top = `${at.top}px`;
      box.style.left = `${at.left}px`;
      box.style.setProperty('--room', `${at.room}px`);
      box.style.setProperty('--arrow', `${at.arrow}px`);
      box.dataset.side = at.side;
      return true;
    };
    place();
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!place()) setOpen(false);
      });
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open, text]);

  const triggerProps = {
    ref: trigger,
    type: 'button' as const,
    'aria-expanded': open,
    'aria-controls': bubbleId,
    'aria-describedby': textId,
    onPointerDown: () => {
      pressing.current = true;
    },
    onPointerCancel: () => {
      pressing.current = false;
    },
    onFocus: () => {
      if (!pressing.current && !returning.current) show();
    },
    onBlur: (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && bubble.current?.contains(event.relatedTarget))) close();
    },
    onClick: (event: SyntheticEvent) => {
      event.stopPropagation();
      pressing.current = false;
      if (open) close();
      else show();
    },
  };

  // Always in the document, and hidden while shut: the text in it is the
  // trigger's description whether or not the bubble is showing. The title is
  // drawn only while it is open - it is most often the very label the (i)
  // stands beside, and a shut bubble would otherwise put that label into the
  // page a second time for anything that reads the page's text.
  const parts = createPortal(
    <div
      ref={bubble}
      id={bubbleId}
      role="tooltip"
      hidden={!open}
      tabIndex={-1}
      className={styles.bubble}
      data-print="omit"
      onPointerDown={keep}
      onClick={keep}
      onBlur={event => {
        const next = event.relatedTarget;
        if (!(next instanceof Node && (trigger.current?.contains(next) || bubble.current?.contains(next)))) close();
      }}
    >
      <div className={styles.content}>
        {open ? <strong className={styles.title}>{title}</strong> : null}
        <span id={textId}>{text}</span>
      </div>
      <span className={styles.arrow} aria-hidden />
    </div>,
    document.body,
  );

  return { title, triggerProps, parts };
}

/** The (i) beside a control or a heading. Its name says what it explains; the explanation is its description. */
export function Help({ topic }: { topic: HelpTopic }) {
  const { t } = useTranslation();
  const { title, triggerProps, parts } = useExplanation(topic);

  return (
    <>
      <button {...triggerProps} className={styles.info} aria-label={t('help.about', { title })} data-print="omit">
        <Info size={15} strokeWidth={2} aria-hidden />
      </button>
      {parts}
    </>
  );
}

/** A word in running text that explains itself: the word is the button, and stays the word in the sentence. */
export function Term({ topic, children }: { topic: HelpTopic; children: ReactNode }) {
  const { triggerProps, parts } = useExplanation(topic);

  return (
    <>
      <button {...triggerProps} className={styles.term}>
        {children}
      </button>
      {parts}
    </>
  );
}
