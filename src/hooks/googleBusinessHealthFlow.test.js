import { renderHook, waitFor } from '@testing-library/react';
import supabase from '../supabaseClient';
import { useGoogleBusinessData } from './useGoogleBusinessData';
import { useHealthScore } from './useHealthScore';

jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: { from: jest.fn() },
}));

const completeLocation = {
  id: 'location-1',
  title: 'Werkstatt',
  locality: 'Berlin',
  primary_phone: '+49 30 123456',
  website_uri: 'https://example.com',
  primary_category: 'Autowerkstatt',
  place_id: 'place-1',
  review_count: 1,
  average_rating: 5,
  last_synced_at: '2026-09-22T00:00:00Z',
  is_primary: true,
};

function query(result) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    is: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

function mockDashboardQueries(location = completeLocation) {
  const builders = [
    query({ data: [location], error: null }),
    query({ data: [{ star_rating: 5, is_answered: true }], error: null }),
    query({ data: [], error: null }),
    query({ data: [], error: null }),
    query({ data: [{ google_created_at: new Date().toISOString() }], error: null }),
    query({ count: 5, error: null }),
  ];
  supabase.from.mockImplementation(() => builders.shift());
  return builders;
}

describe('Google location health-score flow', () => {
  beforeEach(() => jest.clearAllMocks());

  it('selects and forwards all four profile-completeness fields', async () => {
    mockDashboardQueries();

    const { result } = renderHook(() => {
      const data = useGoogleBusinessData();
      const health = useHealthScore(data);
      return { data, health };
    });

    await waitFor(() => expect(result.current.data.loading).toBe(false));

    const locationSelect = supabase.from.mock.results[0].value.select;
    expect(locationSelect).toHaveBeenCalledWith(expect.stringContaining('primary_phone'));
    expect(locationSelect).toHaveBeenCalledWith(expect.stringContaining('website_uri'));
    expect(locationSelect).toHaveBeenCalledWith(expect.stringContaining('locality'));
    expect(locationSelect).toHaveBeenCalledWith(expect.stringContaining('primary_category'));
    expect(result.current.data.locations[0]).toMatchObject(completeLocation);
    expect(result.current.health.factors.find((factor) => factor.id === 'completeness')).toMatchObject({
      points: 15,
      action: null,
    });
  });

  it('keeps missing optional Google fields nullable and scores only present fields', async () => {
    mockDashboardQueries({
      ...completeLocation,
      primary_phone: null,
      website_uri: null,
      primary_category: null,
    });

    const { result } = renderHook(() => {
      const data = useGoogleBusinessData();
      return { data, health: useHealthScore(data) };
    });

    await waitFor(() => expect(result.current.data.loading).toBe(false));
    expect(result.current.health.factors.find((factor) => factor.id === 'completeness')).toMatchObject({
      points: 4,
      action: 'Angaben ergänzen',
    });
  });
});
