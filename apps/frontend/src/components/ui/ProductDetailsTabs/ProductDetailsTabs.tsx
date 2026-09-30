import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';

export function ProductDetailsTabs({ description, specifications, reviews, reviewCount, className, defaultValue = 'description' }: {
  description: ReactNode;
  specifications: ReactNode;
  reviews: ReactNode;
  reviewCount: number;
  className?: string;
  defaultValue?: 'description' | 'specifications' | 'reviews';
}) {
  return <Tabs key={defaultValue} defaultValue={defaultValue} className={className}>
    <TabsList aria-label="Product information">
      <TabsTrigger value="description">Description</TabsTrigger>
      <TabsTrigger value="specifications">Specifications</TabsTrigger>
      <TabsTrigger value="reviews">Reviews ({reviewCount})</TabsTrigger>
    </TabsList>
    <TabsContent value="description">{description}</TabsContent>
    <TabsContent value="specifications">{specifications}</TabsContent>
    <TabsContent value="reviews">{reviews}</TabsContent>
  </Tabs>;
}
