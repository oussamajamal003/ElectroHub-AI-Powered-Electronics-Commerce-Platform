export type Money = string;
export type ProductAvailability = 'AVAILABLE' | 'UNAVAILABLE';
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
  slug: string;
  price: Money;
  compareAtPrice: Money | null;
  currency: 'USD';
  availability: ProductAvailability;
  category: ProductRelationSummary;
  brand: ProductRelationSummary | null;
  primaryImage: ProductImage | null;
}
export interface ProductDetail extends Omit<ProductSummary, 'primaryImage'> {
  description: string | null;
  sku: string;
  modelNumber: string | null;
  images: ProductImage[];
  specifications: { group: string; items: ProductSpecification[] }[];
}
export interface Category extends ProductRelationSummary { description: string | null; imageUrl: string | null }
export interface Brand extends ProductRelationSummary { description: string | null; logoUrl: string | null }
export interface ProductResponse<Resource> { data: Resource }
export interface ProductCollection<Resource> {
  data: Resource[];
  meta: { page: number; pageSize: number; total: number };
}
