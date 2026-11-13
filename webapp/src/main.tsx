// Albert Sans with its weight axis: the app sets titles and figures light, text regular and what is stressed medium.
import '@fontsource-variable/albert-sans/wght.css';
import './theme/tokens.css';
import './styles/global.css';
// The shared shapes before any screen's own styles: where both speak of an element, the screen's rule is the later one and wins.
import './ui/ui.module.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { catchInstallPrompt } from './app/install';
import { followReleases } from './app/update';
import { warmUp } from './app/warm-up';
import { initI18n } from './i18n/i18n';

// The browser offers the install once, as the page loads; it is kept for the
// screen that offers it later.
catchInstallPrompt();

// A new release reloads the page once its worker has taken over.
followReleases();

// The session and the home are asked for while the catalogues load, rather than once the first render asks.
warmUp(window.location);

// The catalogues are fetched before the first render: every label on the shell
// is a key, and a frame of raw keys is worse than a frame of nothing.
const start = async () => {
  await initI18n();
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

void start();
