import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { CookieControls } from './CookieControls';
import { analyticsAllowed, CONSENT_KEY } from './consent';

describe('CookieControls', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it('defaults off, saves rejection and reopens to allow withdrawal after acceptance', () => {
    render(<MemoryRouter><CookieControls locked={false} /></MemoryRouter>);
    expect(analyticsAllowed()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reject optional' }));
    expect(screen.queryByRole('region', { name: 'Cookie preferences' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY)!).analytics).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cookie Settings' }));
    const checkbox = screen.getByRole('checkbox', { name: 'Analytics' });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(analyticsAllowed()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cookie Settings' }));
    expect(screen.getByRole('checkbox', { name: 'Analytics' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Reject optional' }));
    expect(analyticsAllowed()).toBe(false);
  });
  it('closing customization does not imply consent', () => {
    render(<MemoryRouter><CookieControls locked={false} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(analyticsAllowed()).toBe(false);
    expect(screen.getByRole('region', { name: 'Cookie preferences' })).toBeInTheDocument();
  });
});
