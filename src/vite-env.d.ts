/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// some global object injected by platform
declare global {
  interface Window {
    aiSdk?: Record<string, any>;
    ywConfig?: Record<string, any>;
    ywSdk?: Record<string, any>;
  }
}

export {};