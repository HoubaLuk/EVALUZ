import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EvaluzDashboard from './App.tsx';
import { DialogProvider } from './contexts/DialogContext';
import './utils/chartSetup';   // Chart.js centrální registrace modulů
import './styles/main.scss';   // NCIKT Visual Standards v1.1
import './index.css';          // Tailwind (dočasně, odstraní se v Fázi 6)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      <EvaluzDashboard />
    </DialogProvider>
  </StrictMode>,
);
