import { render, screen, fireEvent, within } from '@testing-library/react';
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
    expect(screen.getByRole('tab', { name: 'View image 1 — Front view' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'View image 2 — Side view' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'View image 3 — Back view' })).toBeInTheDocument();
  });

  it('updates selected image when thumbnail is clicked in uncontrolled mode', () => {
    render(<ProductGallery images={mockImages} />);
    
    const secondThumb = screen.getByRole('tab', { name: 'View image 2 — Side view' });
    fireEvent.click(secondThumb);
    
    expect(secondThumb).toHaveAttribute('aria-selected', 'true');
    const mainImages = screen.getAllByAltText('Side view');
    expect(mainImages.length).toBeGreaterThan(0);
  });

  it('calls onSelectImage in controlled mode', () => {
    const handleSelect = vi.fn();
    render(<ProductGallery images={mockImages} selectedIndex={0} onSelectImage={handleSelect} />);
    
    const thirdThumb = screen.getByRole('tab', { name: 'View image 3 — Back view' });
    fireEvent.click(thirdThumb);
    
    expect(handleSelect).toHaveBeenCalledWith(2);
    // Should not update internally if controlled (still expects index 0 to be active unless re-rendered)
    const firstThumb = screen.getByRole('tab', { name: 'View image 1 — Front view' });
    expect(firstThumb).toHaveAttribute('aria-selected', 'true');
  });

  it('supports keyboard navigation', () => {
    render(<ProductGallery images={mockImages} />);
    
    const firstThumb = screen.getByRole('tab', { name: 'View image 1 — Front view' });
    
    // Press ArrowRight
    fireEvent.keyDown(firstThumb, { key: 'ArrowRight' });
    const secondThumb = screen.getByRole('tab', { name: 'View image 2 — Side view' });
    expect(secondThumb).toHaveAttribute('aria-selected', 'true');
    
    // Press ArrowLeft
    fireEvent.keyDown(secondThumb, { key: 'ArrowLeft' });
    expect(firstThumb).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps thumbnail names unique while preserving descriptive alt text and keyboard tab semantics', () => {
    const images = [
      { id: 'duplicate-1', src: '/one.jpg', alt: 'Tablet front' },
      { id: 'duplicate-2', src: '/two.jpg', alt: 'Tablet front' },
      { id: 'blank', src: '/blank.jpg', alt: '   ' },
    ];
    render(<ProductGallery images={images} />);

    expect(screen.getByRole('tab', { name: 'View image 1 — Tablet front' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'View image 2 — Tablet front' })).toHaveAttribute('tabindex', '-1');
    const blankAltTab = screen.getByRole('tab', { name: 'View image 3 — Product image' });
    expect(blankAltTab).toBeInTheDocument();
    expect(screen.getByAltText('Tablet front')).toBeInTheDocument();
    fireEvent.click(blankAltTab);
    expect(screen.getByAltText('Product image')).toBeInTheDocument();
  });

  it('shows the shared unavailable-image fallback inside a failed thumbnail', () => {
    render(<ProductGallery images={mockImages} />);
    const thumbnail = screen.getByRole('tab', { name: 'View image 3 — Back view' });
    const image = thumbnail.querySelector('img');
    expect(image).not.toBeNull();

    fireEvent.error(image!);

    expect(within(thumbnail).getByTestId('product-image-fallback')).toBeInTheDocument();
    expect(within(thumbnail).getByText('No photo')).toBeInTheDocument();
    expect(thumbnail).toHaveAccessibleName('View image 3 — Back view');
  });

  it('shows a replacement source for the same gallery image without retaining the prior error', () => {
    const images = [{ id: 'same-image', src: '/missing.jpg', alt: 'Front view' }];
    const { rerender } = render(<ProductGallery images={images} />);
    fireEvent.error(screen.getByAltText('Front view'));
    expect(screen.getByTestId('product-image-fallback')).toBeInTheDocument();

    rerender(<ProductGallery images={[{ ...images[0]!, src: '/replacement.jpg' }]} />);

    expect(screen.queryByTestId('product-image-fallback')).not.toBeInTheDocument();
    expect(screen.getByAltText('Front view')).toHaveAttribute('src', '/replacement.jpg');
  });

  it('uses product name for blank image alt text and distinct thumbnail names', () => {
    const images = [
      { id: 'blank-1', src: '/one.jpg', alt: '' },
      { id: 'blank-2', src: '/two.jpg', alt: '   ' },
    ];
    render(<ProductGallery productName="Acer Predator Cestus 330" images={images} />);
    expect(screen.getByAltText('Acer Predator Cestus 330')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'View Acer Predator Cestus 330 — image 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'View Acer Predator Cestus 330 — image 2' })).toBeInTheDocument();
  });
});
