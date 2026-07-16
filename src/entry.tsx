import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

console.log('src/entry.tsx loaded');

const rootEl = document.getElementById("root");
if (!rootEl) console.error('root element not found');

createRoot(rootEl!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

console.log('React createRoot render called');
