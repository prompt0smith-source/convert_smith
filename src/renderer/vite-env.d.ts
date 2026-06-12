/// <reference types="vite/client" />

import type { ConvertSmithApi } from "../preload/exposedApi";

declare global {
  interface Window {
    convertSmith: ConvertSmithApi;
  }

  interface File {
    path?: string;
  }
}
