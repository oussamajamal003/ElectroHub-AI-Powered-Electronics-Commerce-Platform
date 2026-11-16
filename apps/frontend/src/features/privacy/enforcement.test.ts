import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveChoice } from './consent';
import { reportImageResultSelected } from '@/features/search/discovery/imageSearch';
import { sendRecommendationEvents } from '@/features/recommendations/api';

describe('analytics enforcement', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('blocks optional event requests before a choice and after rejection or withdrawal', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const send = () => { reportImageResultSelected('token', 'product'); sendRecommendationEvents('token', [{ productId: 'product', type: 'CLICK' }]); };
    send();
    expect(fetchMock).not.toHaveBeenCalled();
    saveChoice(true); send();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    saveChoice(false); send();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
