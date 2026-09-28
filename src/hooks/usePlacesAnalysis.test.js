import { act, renderHook } from '@testing-library/react';
import supabase from '../supabaseClient';
import { buildAlerts, saveLeadToSupabase, usePlacesAnalysis } from './usePlacesAnalysis';

jest.mock('../supabaseClient', () => ({ from: jest.fn() }));

describe('usePlacesAnalysis public flow', () => {
  it('returns a non-empty, explicitly unavailable result for a business without Google data', () => {
    const { result } = renderHook(() => usePlacesAnalysis());
    act(() => result.current.runManualAnalysis('Manueller Betrieb'));
    expect(result.current.phase).toBe('result');
    expect(result.current.result).toEqual(expect.objectContaining({ name: 'Manueller Betrieb', dataSource: 'manual', score: null }));
    expect(buildAlerts(result.current.result)[0].title).toMatch(/Kein Google-Eintrag/);
  });

  it('never estimates unanswered reviews and defers the answer-rate check', () => {
    const alerts = buildAlerts({ dataSource: 'google', websiteAvailable: true, hasWebsite: true,
      reviewCountAvailable: true, reviewCount: 30, ratingAvailable: true, rating: 4.8 });
    expect(alerts.some(a => /Geschätzt|unbeantwortet/i.test(a.title))).toBe(false);
    expect(alerts[0].title).toMatch(/Antwortquote/);
  });

  it('surfaces a lead storage failure to the caller', async () => {
    supabase.from.mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: new Error('offline') }) });
    await expect(saveLeadToSupabase({
      email: 'moin@example.de', industryKey: 'handwerk',
      result: { name: 'Test', city: '', placeId: 'p1', rating: 4, reviewCount: 2, score: 50 },
    })).rejects.toThrow('offline');
  });

  it('lets only the latest of multiple fast selections publish a result', async () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => usePlacesAnalysis());
    let first;
    let second;
    act(() => {
      first = result.current.runAnalysis({ placeId: 'one', name: 'Erster', rating: 4,
        ratingAvailable: true, reviewCount: 2, reviewCountAvailable: true,
        hasWebsite: false, websiteAvailable: true });
      second = result.current.runAnalysis({ placeId: 'two', name: 'Zweiter', rating: 4.8,
        ratingAvailable: true, reviewCount: 20, reviewCountAvailable: true,
        hasWebsite: true, website: 'https://two.test', websiteAvailable: true });
    });
    await act(async () => { jest.advanceTimersByTime(600); await Promise.all([first, second]); });
    expect(result.current.result).toEqual(expect.objectContaining({ placeId: 'two', name: 'Zweiter' }));
    jest.useRealTimers();
  });

  it('reset invalidates an analysis that is still animating', async () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => usePlacesAnalysis());
    let pending;
    act(() => { pending = result.current.runAnalysis({ placeId: 'one', name: 'Erster',
      reviewCount: 0, reviewCountAvailable: true, ratingAvailable: false, websiteAvailable: false }); });
    act(() => result.current.reset());
    await act(async () => { jest.advanceTimersByTime(600); await pending; });
    expect(result.current.phase).toBe('idle');
    expect(result.current.result).toBeNull();
    jest.useRealTimers();
  });
});
