import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProductImage } from './ProductImage';

describe('ProductImage', () => {
  it('renders image successfully and applies loaded class', () => {
    render(<ProductImage src="test.jpg" alt="Test image" />);
    
    const img = screen.getByAltText('Test image');
    expect(img).toBeInTheDocument();
    
    // Simulate image load
    fireEvent.load(img);
    expect(img.className).toContain('loaded');
    expect(img).toHaveAttribute('alt', 'Test image');
    expect(screen.queryByText('Test image')).not.toBeInTheDocument();
  });

  it('renders fallback when image fails to load', () => {
    render(<ProductImage src="invalid.jpg" alt="Broken image" />);
    
    const img = screen.getByAltText('Broken image');
    fireEvent.error(img);
    
    expect(screen.getByTestId('product-image-fallback')).toBeInTheDocument();
    expect(screen.getByText('Photo unavailable: Broken image')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Broken image' })).toBeInTheDocument();
  });

  it('renders custom fallback text', () => {
    render(<ProductImage src="invalid.jpg" alt="Broken image" fallbackText="No photo" />);
    
    const img = screen.getByAltText('Broken image');
    fireEvent.error(img);
    
    expect(screen.getByText('No photo')).toBeInTheDocument();
  });

  it('retries a replacement source after the previous image failed', () => {
    const { rerender } = render(<ProductImage src="missing.webp" alt="Product photo" />);
    fireEvent.error(screen.getByAltText('Product photo'));
    expect(screen.getByTestId('product-image-fallback')).toBeInTheDocument();

    rerender(<ProductImage src="replacement.webp" alt="Product photo" />);

    const replacement = screen.getByAltText('Product photo');
    expect(screen.queryByTestId('product-image-fallback')).not.toBeInTheDocument();
    fireEvent.load(replacement);
    expect(replacement.className).toContain('loaded');
  });
});
