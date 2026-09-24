// Inter with its optical-size axis, so a 12 px caption gets the open text cut
// and a 32 px title the tighter display one without anybody asking.
import '@fontsource-variable/inter/opsz.css';
import './theme/tokens.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initI18n } from './i18n/i18n';

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
