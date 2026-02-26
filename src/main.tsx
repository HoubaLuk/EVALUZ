import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EvaluzDashboard from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EvaluzDashboard />
  </StrictMode>,
);
