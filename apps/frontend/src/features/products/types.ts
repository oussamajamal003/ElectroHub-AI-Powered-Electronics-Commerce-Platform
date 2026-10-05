export type Money = string;
export type ProductAvailability = 'AVAILABLE' | 'UNAVAILABLE';
export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
export interface ProductRelationSummary { id: string; name: string; slug: string }
export interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}
export interface ProductSpecification {
  id: string;
  group: string;
  name: string;
  value: string;
  sortOrder: number;
}
export interface ProductSummary {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  price: Money;
  compareAtPrice: Money | null;
  discountPercent: number | null;
  averageRating: string | null;
  reviewCount: number;
  currency: 'USD';
  availability: ProductAvailability;
  stockStatus?: StockStatus | null;
  availableQuantity?: number;
  purchasable?: boolean;
  category: ProductRelationSummary;
  brand: ProductRelationSummary | null;
  primaryImage: ProductImage | null;
  secondaryImage?: ProductImage | null;
}
export interface ProductDetail extends Omit<ProductSummary, 'primaryImage' | 'secondaryImage'> {
  availableQuantity: number;
  sku: string;
  modelNumber: string | null;
  images: ProductImage[];
  specifications: { group: string; items: ProductSpecification[] }[];
}
export interface Category extends ProductRelationSummary { description: string | null; imageUrl: string | null; productCount: number }
export interface Brand extends ProductRelationSummary { description: string | null; logoUrl: string | null }
export interface ProductResponse<Resource> { data: Resource }
export interface ProductCollection<Resource> {
  data: Resource[];
  meta: { page: number; pageSize: number; total: number };
}
export interface Review {
  id: string;
  rating: number;
  body: string;
  author: { displayName: string };
  createdAt: string;
  updatedAt: string;
}
export interface ReviewCollection extends ProductCollection<Review> {
  meta: ProductCollection<Review>['meta'] & { totalPages: number };
  summary?: { averageRating: string | null; reviewCount: number };
}
export interface ReviewMutationResponse extends ProductResponse<Review> {
  summary: { averageRating: string | null; reviewCount: number };
}
export interface MyReviewItem extends Review {
  product: { slug: string; name: string; primaryImage: Pick<ProductImage, 'id' | 'url' | 'altText'> | null };
}
