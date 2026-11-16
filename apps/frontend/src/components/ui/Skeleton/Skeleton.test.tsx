import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from './Skeleton';

describe('Skeleton Component', () => {
  it('renders a rectangular skeleton by default', () => {
    const { container } = render(<Skeleton data-testid="skeleton" />);
    const skeleton = container.firstChild as HTMLElement;
    expect(skeleton).toBeInTheDocument();
    expect(skeleton.className).toContain('variant-rectangular');
  });

  it('renders a circular skeleton when specified', () => {
    const { container } = render(<Skeleton variant="circular" />);
    const skeleton = container.firstChild as HTMLElement;
    expect(skeleton.className).toContain('variant-circular');
  });

  it('renders a text skeleton when specified', () => {
    const { container } = render(<Skeleton variant="text" />);
    const skeleton = container.firstChild as HTMLElement;
    expect(skeleton.className).toContain('variant-text');
  });

  it('applies custom width and height styles', () => {
    const { container } = render(<Skeleton width="100px" height="50px" />);
    const skeleton = container.firstChild as HTMLElement;
    expect(skeleton.style.width).toBe('100px');
    expect(skeleton.style.height).toBe('50px');
  });

  it('applies aria-hidden to avoid screen reader noise', () => {
    const { container } = render(<Skeleton />);
    const skeleton = container.firstChild as HTMLElement;
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
  });
});
