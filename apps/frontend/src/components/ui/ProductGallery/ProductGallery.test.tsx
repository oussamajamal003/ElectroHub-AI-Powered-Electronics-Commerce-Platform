import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProductGallery } from './ProductGallery';

describe('ProductGallery', () => {
  const mockImages = [
    { id: 'img1', src: '/img1.jpg', alt: 'Front view' },
    { id: 'img2', src: '/img2.jpg', alt: 'Side view' },
    { id: 'img3', src: '/img3.jpg', alt: 'Back view' }
  ];

  it('renders main image and thumbnails', () => {
    render(<ProductGallery images={mockImages} />);
    
    // Main image uses ProductImage, which renders the alt text
    const mainImages = screen.getAllByAltText('Front view');
    expect(mainImages.length).toBeGreaterThan(0);
    
    // Thumbnails are buttons
    expect(screen.getByRole('tab', { name: 'View Front view' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'View Side view' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'View Back view' })).toBeInTheDocument();
  });

  it('updates selected image when thumbnail is clicked in uncontrolled mode', () => {
    render(<ProductGallery images={mockImages} />);
    
    const secondThumb = screen.getByRole('tab', { name: 'View Side view' });
    fireEvent.click(secondThumb);
    
    expect(secondThumb).toHaveAttribute('aria-selected', 'true');
    const mainImages = screen.getAllByAltText('Side view');
    expect(mainImages.length).toBeGreaterThan(0);
  });

  it('calls onSelectImage in controlled mode', () => {
    const handleSelect = vi.fn();
    render(<ProductGallery images={mockImages} selectedIndex={0} onSelectImage={handleSelect} />);
    
    const thirdThumb = screen.getByRole('tab', { name: 'View Back view' });
    fireEvent.click(thirdThumb);
    
    expect(handleSelect).toHaveBeenCalledWith(2);
    // Should not update internally if controlled (still expects index 0 to be active unless re-rendered)
    const firstThumb = screen.getByRole('tab', { name: 'View Front view' });
    expect(firstThumb).toHaveAttribute('aria-selected', 'true');
  });

  it('supports keyboard navigation', () => {
    render(<ProductGallery images={mockImages} />);
    
    const firstThumb = screen.getByRole('tab', { name: 'View Front view' });
    
    // Press ArrowRight
    fireEvent.keyDown(firstThumb, { key: 'ArrowRight' });
    const secondThumb = screen.getByRole('tab', { name: 'View Side view' });
    expect(secondThumb).toHaveAttribute('aria-selected', 'true');
    
    // Press ArrowLeft
    fireEvent.keyDown(secondThumb, { key: 'ArrowLeft' });
    expect(firstThumb).toHaveAttribute('aria-selected', 'true');
  });
});
