import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Asking as Question } from '@/ui/Asking';
import { useFocusRescue } from '@/ui/focus-rescue';
import { Sheet } from '@/ui/Sheet';
import { translate } from './translations';

function Swapping() {
  useFocusRescue();
  const [paused, setPaused] = useState(false);
  return (
    <section>
      {paused ? (
        <button type="button" onClick={() => setPaused(false)}>
          Start
        </button>
      ) : (
        <button type="button" onClick={() => setPaused(true)}>
          Pause
        </button>
      )}
    </section>
  );
}

/** A screen reader whose focus falls to the body starts again from the top of the page. */
describe('the focus of a control that goes away', () => {
  it('lands on the control that took its place', async () => {
    render(
      <MemoryRouter>
        <Swapping />
      </MemoryRouter>,
    );
    const pause = screen.getByRole('button', { name: 'Pause' });
    pause.focus();
    fireEvent.click(pause);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toHaveFocus());
  });
});

/** A card that is taken away, between a control in front of it and one after it. */
function Declining() {
  useFocusRescue();
  const [offered, setOffered] = useState(true);
  return (
    <section>
      <button type="button">First on the page</button>
      <p>Readings</p>
      {offered ? (
        <div>
          <button type="button" onClick={() => setOffered(false)}>
            No thanks
          </button>
        </div>
      ) : null}
      <a href="/add">Add a place</a>
    </section>
  );
}

describe('the focus of a card that is taken away', () => {
  it('stays where the card stood - on the control after it - rather than going to the top of the page', async () => {
    render(<Declining />);
    const no = screen.getByRole('button', { name: 'No thanks' });
    no.focus();
    fireEvent.click(no);

    await waitFor(() => expect(screen.getByRole('link', { name: 'Add a place' })).toHaveFocus());
  });
});

describe('a sheet', () => {
  // The sheet names its close button from the catalogue.
  beforeAll(() => translate());

  /**
   * On a phone Back is how anything opened is put away, and a Back that took
   * the page with the sheet took the reader out of the app from Start.
   */
  describe('and the browser´s Back', () => {
    const back = async () => {
      await act(async () => {
        window.history.back();
        await new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
      });
    };

    function Page({ noEntry = false }: { noEntry?: boolean }) {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Ask
          </button>
          {open ? (
            <Sheet title="Question" noEntry={noEntry} onClose={() => setOpen(false)}>
              <p>Inside</p>
            </Sheet>
          ) : null}
        </>
      );
    }

    it('closes the sheet and leaves the page where it is', async () => {
      render(<Page />);
      const entries = window.history.length;
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      // The open sheet stands on an entry of its own.
      expect(window.history.length).toBe(entries + 1);

      await back();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    });

    it('gathers one entry however many sheets a page opens and closes without it', async () => {
      render(<Page />);
      const open = () => fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      const close = () => act(() => void fireEvent.keyDown(document, { key: 'Escape' }));

      open();
      const entries = window.history.length;
      close();
      open();
      close();
      open();

      expect(window.history.length).toBe(entries);
      await back();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('takes no entry for a sheet that is an address of its own, or the question a held-back navigation asks', () => {
      render(<Page noEntry />);
      const entries = window.history.length;
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

      expect(window.history.length).toBe(entries);
    });
  });

  /** Escape pressed over a question is the question's way back: the sheet under it stays, with what was typed into it. */
  it('leaves Escape to a question asked inside it, and takes the next one itself', () => {
    function Page() {
      const [open, setOpen] = useState(true);
      const [asking, setAsking] = useState(false);
      return open ? (
        <Sheet title="Scheme" onClose={() => setOpen(false)}>
          <input aria-label="Name" defaultValue="" />
          {asking ? (
            <Question note="Delete it?" yes="Yes" busy={false} onYes={() => undefined} onCancel={() => setAsking(false)} />
          ) : (
            <button type="button" onClick={() => setAsking(true)}>
              Delete
            </button>
          )}
        </Sheet>
      ) : null;
    }
    render(<Page />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // The question holds the focus, so it is what a screen reader reads.
    expect(screen.getByText('Delete it?')).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByText('Delete it?')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('typed');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('makes the page behind it unreachable while it is open, and gives it back as it closes', () => {
    function Page() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <p>The page</p>
          <div>
            {open ? (
              <Sheet title="Question" onClose={() => setOpen(false)}>
                <p>Inside</p>
              </Sheet>
            ) : null}
          </div>
        </>
      );
    }
    render(<Page />);

    expect(screen.getByText('The page')).toHaveAttribute('inert');
    // Out of the tree too, for a tool that reads the markup and does not know `inert`.
    expect(screen.getByText('The page')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Inside').closest('[inert], [aria-hidden]')).toBeNull();

    act(() => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect(screen.getByText('The page')).not.toHaveAttribute('inert');
    expect(screen.getByText('The page')).not.toHaveAttribute('aria-hidden');
  });

  /** A page with one button, which opens a sheet with one field in it. */
  function Asking() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Ask
        </button>
        {open ? (
          <Sheet title="Question" note="for the whole tent" onClose={() => setOpen(false)}>
            <input aria-label="Answer" />
          </Sheet>
        ) : null}
      </>
    );
  }

  const ask = () => {
    render(<Asking />);
    const opener = screen.getByRole('button', { name: 'Ask' });
    opener.focus();
    fireEvent.click(opener);
    const sheet = screen.getByRole('dialog', { name: 'Question' });
    return { opener, sheet, backdrop: sheet.parentElement!, handle: sheet.firstElementChild as HTMLElement };
  };

  it('closes on a tap beside it, and gives the focus back to what opened it', () => {
    const { opener, backdrop } = ask();

    fireEvent.pointerDown(backdrop);
    // What a browser does with a press on something that takes no focus.
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.click(backdrop);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('stays open where a press that began inside it is let go beside it', () => {
    const { backdrop } = ask();

    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Answer' }));
    fireEvent.click(backdrop);

    expect(screen.getByRole('dialog', { name: 'Question' })).toBeInTheDocument();
  });

  it('follows its handle down, springs back from a short pull and is put away by a long one', () => {
    const { sheet, handle } = ask();

    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerMove(handle, { clientY: 140 });
    expect(sheet.style.transform).toBe('translateY(40px)');
    fireEvent.pointerUp(handle, { clientY: 140 });
    expect(sheet.style.transform).toBe('');
    expect(screen.getByRole('dialog', { name: 'Question' })).toBeInTheDocument();

    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerMove(handle, { clientY: 260 });
    fireEvent.pointerUp(handle, { clientY: 260 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks the page as held still behind it, and says under its title what its answer is for', () => {
    const { sheet, backdrop } = ask();

    // global.css stops the page scrolling while an element so marked is on it.
    expect(backdrop).toHaveAttribute('data-scrim');
    expect(sheet).toHaveAccessibleName('Question');
    expect(sheet).toHaveTextContent('for the whole tent');
  });
});
