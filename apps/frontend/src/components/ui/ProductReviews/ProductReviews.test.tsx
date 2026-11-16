import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductReviews } from './ProductReviews';

const review = { id: 'review-1', rating: 5, body: 'Very good', author: { displayName: 'Private Personal Name' }, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };

describe('ProductReviews owner display', () => {
  it('labels the current customer review without showing their name', () => {
    render(<ProductReviews reviews={[review]} ownReviewId="review-1" />);
    expect(screen.getByText('Your review')).toBeInTheDocument();
    expect(screen.queryByText('Private Personal Name')).not.toBeInTheDocument();
  });

  it('keeps the public display name for other customers', () => {
    render(<ProductReviews reviews={[review]} ownReviewId="another-review" />);
    expect(screen.getByText('Private Personal Name')).toBeInTheDocument();
  });
});
