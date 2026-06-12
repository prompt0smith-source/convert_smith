export interface ExecutableCheck {
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface LibreOfficeDetection {
  available: boolean;
  path?: string;
  message: string;
}
