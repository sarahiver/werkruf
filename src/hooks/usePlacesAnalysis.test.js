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

  it('labels unanswered reviews as an estimate rather than Google data', () => {
    const alerts = buildAlerts({ dataSource: 'google', unansweredEstimate: 7, hasWebsite: true, reviewCount: 30, rating: 4.8 });
    expect(alerts[0].title).toMatch(/Geschätzt/);
    expect(alerts[0].desc).toMatch(/nicht von Google geliefert/);
  });

  it('surfaces a lead storage failure to the caller', async () => {
    supabase.from.mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: new Error('offline') }) });
    await expect(saveLeadToSupabase({
      email: 'moin@example.de', industryKey: 'handwerk',
      result: { name: 'Test', city: '', placeId: 'p1', rating: 4, reviewCount: 2, score: 50 },
    })).rejects.toThrow('offline');
  });
});
