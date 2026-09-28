import { renderHook, waitFor } from '@testing-library/react';
import supabase from '../supabaseClient';
import { useReviews } from './useReviews';

jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: { from: jest.fn() },
}));

function reviewQuery() {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    or: jest.fn(() => builder),
    order: jest.fn(() => builder),
    range: jest.fn(async () => ({ data: [], error: null, count: 0 })),
  };
  return builder;
}

describe('selected-business review list', () => {
  beforeEach(() => jest.clearAllMocks());

  it('always filters the review page by the persisted selection', async () => {
    const query = reviewQuery();
    supabase.from.mockReturnValue(query);

    const { result } = renderHook(() => useReviews({ locationId: 'location-1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(query.eq).toHaveBeenCalledWith('location_id', 'location-1');
  });

  it('fails closed while no business has been selected', async () => {
    const query = reviewQuery();
    supabase.from.mockReturnValue(query);

    const { result } = renderHook(() => useReviews({ locationId: '__no_selected_location__' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(query.eq).toHaveBeenCalledWith('location_id', '__no_selected_location__');
  });
});
