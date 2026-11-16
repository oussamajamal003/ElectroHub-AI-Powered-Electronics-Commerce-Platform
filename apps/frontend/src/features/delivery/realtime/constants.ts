/** Same bound as the server's recorded path (Task 04.6 MAP_PATH_LIMIT). */
export const MAP_PATH_LIMIT_CLIENT = 200;
/** A drop shorter than this shows "Reconnecting…"; longer becomes "Live updates paused" and is announced once. */
export const PAUSE_AFTER_MS = 10_000;
/** How long "Back online · up to date" stays before returning to "Live updates on". */
export const RESYNCED_FOR_MS = 4_000;
/** Status / ETA toasts auto-dismiss after 6 s (design artifact, ConnectionStatusIndicator). */
export const TOAST_MS = 6_000;
