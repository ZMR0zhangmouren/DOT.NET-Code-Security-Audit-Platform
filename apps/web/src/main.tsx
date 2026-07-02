import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';

import App from './App';

import { ThemeProvider } from '@/components/ThemeProvider';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <Toaster position="top-right" richColors closeButton />
    </ThemeProvider>
  </StrictMode>,
);
