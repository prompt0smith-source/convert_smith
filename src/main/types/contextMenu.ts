export type ContextMenuLaunchAction = "convert" | "merge" | "split";

export interface ContextMenuLaunchRequest {
  action: ContextMenuLaunchAction;
  paths: string[];
}

export interface ContextMenuStatus {
  supported: boolean;
  registered: boolean;
  message: string;
}
