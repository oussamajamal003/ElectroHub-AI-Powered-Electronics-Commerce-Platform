import { createContext, useContext } from 'react';

export type DiscoveryMode = 'text' | 'image';
export interface DiscoveryOpenOptions { mode?: DiscoveryMode; query?: string; camera?: boolean }
export interface DiscoveryContextValue { open: (options?: DiscoveryOpenOptions) => void; isOpen: boolean }

export const DiscoveryContext = createContext<DiscoveryContextValue | null>(null);

/** Null outside DiscoveryProvider so shared components (header, search page) still render in isolated tests. */
export const useDiscovery = () => useContext(DiscoveryContext);

export const isMacPlatform = () => typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '');
export const shortcutLabel = () => isMacPlatform() ? '⌘ K' : 'Ctrl K';
