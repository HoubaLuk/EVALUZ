import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EvaluzDashboard from './App.tsx';
import { DialogProvider } from './contexts/DialogContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      <EvaluzDashboard />
    </DialogProvider>
  </StrictMode>,
);
