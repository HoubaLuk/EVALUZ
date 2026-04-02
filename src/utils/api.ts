// Relativní cesta — funguje za Nginx reverse proxy (produkce) i za Vite proxy (dev).
// Nezávisí na protokolu (http/https) ani portu → žádné mixed-content problémy.
export const API_BASE_URL = '/api/v1';
