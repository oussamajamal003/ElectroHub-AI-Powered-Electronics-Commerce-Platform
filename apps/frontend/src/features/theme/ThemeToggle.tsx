import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export interface ThemeToggleProps {
  /** The host header's icon-button class, so the toggle matches its neighbours (size, hover, focus ring). */
  className?: string;
  iconSize?: number;
}

/**
 * Header theme switch shared by the customer and admin headers. The icon and accessible name describe the action
 * ("Switch to dark mode" shows a moon); because the name changes with the state, `aria-pressed` is intentionally not
 * used (ARIA APG: a toggle button keeps a constant label when it exposes a pressed state).
 */
export function ThemeToggle({ className, iconSize = 20 }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button type="button" className={className} onClick={toggleTheme} aria-label={label} title={label}
      data-theme-toggle="" data-active-theme={theme}>
      <Icon size={iconSize} aria-hidden="true" />
    </button>
  );
}
