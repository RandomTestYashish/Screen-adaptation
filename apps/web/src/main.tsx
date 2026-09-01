import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App.js';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing');

// Accessibility checks run against the live UI in development
// (spec section 26), so regressions surface while building rather than in CI.
if (import.meta.env.DEV) {
  void import('@axe-core/react').then(async ({ default: axe }) => {
    const React = await import('react');
    const ReactDOM = await import('react-dom');
    void axe(React, ReactDOM, 1000);
  });
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
