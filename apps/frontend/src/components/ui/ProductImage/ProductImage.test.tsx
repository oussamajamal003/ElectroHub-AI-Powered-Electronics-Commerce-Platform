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
  });

  it('renders fallback when image fails to load', () => {
    render(<ProductImage src="invalid.jpg" alt="Broken image" />);
    
    const img = screen.getByAltText('Broken image');
    fireEvent.error(img);
    
    expect(screen.getByTestId('product-image-fallback')).toBeInTheDocument();
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });

  it('renders custom fallback text', () => {
    render(<ProductImage src="invalid.jpg" alt="Broken image" fallbackText="No photo" />);
    
    const img = screen.getByAltText('Broken image');
    fireEvent.error(img);
    
    expect(screen.getByText('No photo')).toBeInTheDocument();
  });
});
