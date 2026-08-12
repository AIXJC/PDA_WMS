// URL base del backend. Vacío por default: las llamadas a /api quedan relativas y
// siguen funcionando igual que hoy (proxy de Vite en dev). Se define solo cuando el
// frontend se empaqueta como app nativa (Capacitor) y necesita hablarle a un backend
// desplegado por separado.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
