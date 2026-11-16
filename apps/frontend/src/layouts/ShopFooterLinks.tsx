import { Link } from 'react-router-dom';
import { useCategories } from '@/features/search/queries';
import { orderCategoriesByCount } from '@/features/products/categoryOrder';

/** The footer lists the largest live storefront categories; the full set is one click away via All Products. */
const FOOTER_CATEGORY_COUNT = 8;

export function ShopFooterLinks() {
  // Shares the cached Category reference query with Home and Products. While it loads or fails only All Products shows,
  // so the footer never renders guessed or stale category slugs.
  const categories = useCategories(true);
  const footerCategories = orderCategoriesByCount(categories.data ?? []).slice(0, FOOTER_CATEGORY_COUNT);
  return <>
    <Link to="/products">All Products</Link>
    {footerCategories.map(category => <Link key={category.id} to={`/products?category=${encodeURIComponent(category.slug)}`}>{category.name}</Link>)}
  </>;
}
