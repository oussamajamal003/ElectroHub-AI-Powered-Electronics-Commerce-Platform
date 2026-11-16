import { describe, expect, it, vi } from 'vitest';
import type { AiServiceClient } from '../integrations/ai/ai.client.js';
import type { AiImageSearchResult } from '../integrations/ai/ai.schemas.js';
import { fallbackByCategory, filterByCategory, ImageSearchService, rerankByCategory } from './image-search.service.js';
import type { SearchService } from './search.service.js';

vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// The service module constructs a SearchService (Prisma) at import; tests inject their own catalog instead.
vi.mock('./search.service.js', () => ({ SearchService: class {} }));

const MOUSE = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const SSD = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const CPU = '3e4d5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b';

type Product = Awaited<ReturnType<SearchService['productSummariesByIds']>>[number];
const product = (id: string, slug: string) => ({ id, name: id, category: { id: slug, name: slug, slug } }) as unknown as Product;
const match = (productId: string, score: number, rank: number) => ({ productId, score, rank });

const matches = [match(CPU, 0.62, 1), match(SSD, 0.58, 2), match(MOUSE, 0.55, 3)];
const items = [product(CPU, 'computer-components'), product(SSD, 'storage-ssds'), product(MOUSE, 'keyboards-mice')];

describe('rerankByCategory', () => {
  it('keeps the AI order when there are no hints', () => {
    expect(rerankByCategory(items, matches, []).map(item => item.id)).toEqual([CPU, SSD, MOUSE]);
  });

  it('lifts products whose database category the photo most likely shows', () => {
    const hints = [{ category: 'keyboards-mice', probability: 0.8 }];
    expect(rerankByCategory(items, matches, hints).map(item => item.id)).toEqual([MOUSE, CPU, SSD]);
  });

  it('ignores hint slugs the catalog does not use and keeps ties in AI order', () => {
    const hints = [{ category: 'not-a-catalog-category', probability: 0.9 }];
    expect(rerankByCategory(items, matches, hints).map(item => item.id)).toEqual([CPU, SSD, MOUSE]);
    const tied = [match(CPU, 0.5, 1), match(SSD, 0.5, 2)];
    expect(rerankByCategory(items.slice(0, 2), tied, [{ category: 'other', probability: 0.5 }]).map(item => item.id)).toEqual([CPU, SSD]);
  });

  it('a small hint does not overturn a large similarity gap', () => {
    const wide = [match(CPU, 0.9, 1), match(MOUSE, 0.4, 2)];
    const hints = [{ category: 'keyboards-mice', probability: 0.3 }];
    expect(rerankByCategory([items[0], items[2]], wide, hints).map(item => item.id)).toEqual([CPU, MOUSE]);
  });
});

describe('filterByCategory', () => {
  const hints = [{ category: 'keyboards-mice', probability: 0.8 }, { category: 'storage-ssds', probability: 0.05 }];
  it('keeps everything without a ratio or hints', () => {
    expect(filterByCategory(items, hints, undefined)).toHaveLength(3);
    expect(filterByCategory(items, hints, 0)).toHaveLength(3);
    expect(filterByCategory(items, [], 0.1)).toHaveLength(3);
  });
  it('drops categories below ratio x the strongest hint', () => {
    expect(filterByCategory(items, hints, 0.1).map(item => item.id)).toEqual([MOUSE]);
    expect(filterByCategory(items, hints, 0.05).map(item => item.id)).toEqual([SSD, MOUSE]);
  });
});

describe('fallbackByCategory', () => {
  const hints = [{ category: 'storage-ssds', probability: 0.9 }, { category: 'keyboards-mice', probability: 0.05 }];
  it('keeps only the top category within the gap of its best candidate', () => {
    const wide = [match(CPU, 0.5, 1), match(SSD, 0.2, 2), match(MOUSE, 0.1, 3)];
    expect(fallbackByCategory(items, wide, hints, 0.15, 12).map(item => item.id)).toEqual([SSD]);
  });
  it('returns nothing without hints or without a product of that category', () => {
    expect(fallbackByCategory(items, matches, [], 0.15, 12)).toEqual([]);
    expect(fallbackByCategory(items.slice(0, 1), matches, hints, 0.15, 12)).toEqual([]);
  });
});

describe('ImageSearchService with category hints', () => {
  const result = (categoryHints: AiImageSearchResult['categoryHints']): AiImageSearchResult => ({
    matches, categoryHints, modelVersion: 'm1', embeddingVersion: 'e1',
  });
  const build = (aiResult: AiImageSearchResult) => {
    const client = { imageSearch: vi.fn().mockResolvedValue(aiResult) } as unknown as AiServiceClient;
    const catalog = { productSummariesByIds: vi.fn(async (ids: string[]) => items.filter(item => ids.includes(item.id))) } as unknown as SearchService;
    return { service: new ImageSearchService(() => client, catalog), catalog };
  };
  const request = { image: Buffer.from('x'), contentType: 'image/jpeg' as const, limit: 12 };

  it('resolves the AI candidates from the catalog and orders them with the hints', async () => {
    const { service, catalog } = build(result([{ category: 'keyboards-mice', probability: 0.8 }]));
    const response = await service.search(request);
    expect(vi.mocked(catalog.productSummariesByIds)).toHaveBeenCalledWith([CPU, SSD, MOUSE]);
    expect(response.data.items.map(item => item.id)).toEqual([MOUSE, CPU, SSD]);
    expect(response.meta.count).toBe(3);
  });

  it('uses the rerank weight the AI service selected for its gate', async () => {
    const { service } = build({ ...result([{ category: 'keyboards-mice', probability: 0.8 }]), categoryWeight: 0 });
    const response = await service.search(request);
    expect(response.data.items.map(item => item.id)).toEqual([CPU, SSD, MOUSE]);
  });

  it('drops products below the category ratio the AI service selected, keeping order', async () => {
    const hints = [{ category: 'keyboards-mice', probability: 0.8 }, { category: 'storage-ssds', probability: 0.1 }];
    const { service } = build({ ...result(hints), categoryWeight: 0, categoryMinRatio: 0.1 });
    const response = await service.search(request);
    expect(response.data.items.map(item => item.id)).toEqual([SSD, MOUSE]);
  });

  it('answers from the strongest category among the fallback candidates when the regular list is empty', async () => {
    const hints = [{ category: 'keyboards-mice', probability: 0.95 }];
    const { service } = build({
      matches: [], categoryHints: hints, modelVersion: 'm1', embeddingVersion: 'e1',
      fallbackMatches: [match(CPU, 0.3, 1), match(MOUSE, 0.1, 2), match(SSD, 0.05, 3)], fallbackScoreGap: 0.15,
    });
    const response = await service.search(request);
    expect(response.data.items.map(item => item.id)).toEqual([MOUSE]);
  });

  it('ignores the fallback when the regular list already has products', async () => {
    const hints = [{ category: 'keyboards-mice', probability: 0.95 }];
    const { service } = build({ ...result(hints), categoryMinRatio: 0.1, fallbackMatches: [match(MOUSE, 0.1, 1)], fallbackScoreGap: 0.15 });
    const response = await service.search(request);
    expect(response.data.items.map(item => item.id)).toEqual([MOUSE]);
  });

  it('returns an empty successful result when the AI service accepted no product', async () => {
    const { service } = build({ matches: [], categoryHints: [], modelVersion: 'm1', embeddingVersion: 'e1' });
    const response = await service.search(request);
    expect(response.data.items).toEqual([]);
  });
});
