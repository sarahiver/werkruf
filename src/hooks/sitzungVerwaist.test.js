/**
 * Verwaiste Sitzung — Token gueltig, Nutzer geloescht
 *
 * ═══════════════════════════════════════════════════════════════
 * ANLASS
 * ═══════════════════════════════════════════════════════════════
 *
 * 21.10.2026: Nutzer in Supabase geloescht, Browser hielt weiter ein
 * gueltiges Access-Token. Die App hielt ihn fuer angemeldet, das
 * Dashboard mountete, jede Abfrage lief ins Leere. Kein Testartefakt:
 * Nach einer Kontoloeschung hat jeder zweite offene Tab denselben
 * Zustand, bis das Token ablaeuft.
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS HIER GEPRUEFT WIRD — UND DIE GEGENPROBEN
 * ═══════════════════════════════════════════════════════════════
 *
 * Die gefaehrliche Richtung ist nicht "erkennt zu wenig", sondern
 * "meldet zu viel ab": Wer ein allgemeines 401 oder einen Netzfehler
 * als "Nutzer weg" liest, wirft Kunden bei jedem Wackler aus der
 * Sitzung. Die Gegenproben hier sind deshalb die tragenden.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuth, istNutzerVerschwunden, VERWAIST_MARKER } from './useAuth';
import supabase from '../supabaseClient';

let mockAuthListener;

jest.mock('../supabaseClient', () => ({
  __esModule: true,
  default: {
    auth: {
      onAuthStateChange: jest.fn(),
      getUser: jest.fn(),
      signOut: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const profilAntwort = () => ({
  select: jest.fn(() => ({
    eq: jest.fn(() => ({
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'u1' }, error: null }),
    })),
  })),
});

beforeEach(() => {
  window.sessionStorage.clear();
  jest.clearAllMocks();
  mockAuthListener = undefined;
  supabase.auth.onAuthStateChange.mockImplementation((cb) => {
    mockAuthListener = cb;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  supabase.auth.signOut.mockResolvedValue({ error: null });
  supabase.from.mockImplementation(profilAntwort);
  supabase.rpc.mockResolvedValue({ error: null });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 1 — die Entscheidung, mit echten Fehlerformen
   ───────────────────────────────────────────────────────────── */

describe('istNutzerVerschwunden — nur das eine Signal', () => {
  it('erkennt den Code user_not_found', () => {
    expect(istNutzerVerschwunden({ code: 'user_not_found', status: 403, message: 'User not found' })).toBe(true);
  });

  it('erkennt die aeltere Meldung ohne Code', () => {
    expect(istNutzerVerschwunden({
      status: 403, message: 'User from sub claim in JWT does not exist',
    })).toBe(true);
  });

  /* ── GEGENPROBEN ── */
  it('haelt ein allgemeines 401 NICHT fuer einen verschwundenen Nutzer', () => {
    /* Ein abgelaufenes Token, das der Client gleich erneuert. Wer
       hier abmeldet, wirft Kunden bei jedem Wackler raus. */
    expect(istNutzerVerschwunden({ status: 401, message: 'Invalid JWT' })).toBe(false);
    expect(istNutzerVerschwunden({ status: 401, code: 'bad_jwt', message: 'invalid claim: missing sub claim' })).toBe(false);
  });

  it('haelt ein allgemeines 403 NICHT fuer einen verschwundenen Nutzer', () => {
    expect(istNutzerVerschwunden({ status: 403, message: 'Forbidden' })).toBe(false);
  });

  it('haelt keine Antwort NICHT fuer einen Befund', () => {
    expect(istNutzerVerschwunden(null)).toBe(false);
    expect(istNutzerVerschwunden(undefined)).toBe(false);
  });

  it('haelt einen Netzfehler NICHT fuer einen Befund', () => {
    expect(istNutzerVerschwunden({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 })).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 2 — der Hook handelt
   ───────────────────────────────────────────────────────────── */

describe('useAuth — verwaiste Sitzung', () => {
  it('meldet ab und hinterlaesst den Grund, wenn der Nutzer nicht mehr existiert', async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'user_not_found', status: 403, message: 'User not found' },
    });

    const { result } = renderHook(() => useAuth());
    act(() => mockAuthListener('SIGNED_IN', { user: { id: 'u1', email: 'x@example.invalid' } }));

    await waitFor(() => expect(supabase.auth.signOut).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(VERWAIST_MARKER)).toBe('true');
    expect(result.current.isAuthenticated).toBe(false);
  });

  /* ── GEGENPROBE: die gefaehrliche Richtung ── */
  it('meldet bei einem allgemeinen Fehler NICHT ab', async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401, message: 'Invalid JWT' },
    });

    const { result } = renderHook(() => useAuth());
    act(() => mockAuthListener('SIGNED_IN', { user: { id: 'u1' } }));

    await waitFor(() => expect(supabase.auth.getUser).toHaveBeenCalledTimes(1));
    /* Kurz warten, damit ein faelschliches signOut Zeit haette. */
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(VERWAIST_MARKER)).toBeNull();
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('meldet bei einem Netzfehler NICHT ab', async () => {
    supabase.auth.getUser.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useAuth());
    act(() => mockAuthListener('SIGNED_IN', { user: { id: 'u1' } }));

    await waitFor(() => expect(supabase.auth.getUser).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('prueft je Nutzer nur einmal, nicht bei jedem Rendern', async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });

    const { result, rerender } = renderHook(() => useAuth());
    act(() => mockAuthListener('SIGNED_IN', { user: { id: 'u1' } }));
    await waitFor(() => expect(supabase.auth.getUser).toHaveBeenCalledTimes(1));

    rerender(); rerender();
    act(() => mockAuthListener('TOKEN_REFRESHED', { user: { id: 'u1' } }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
    expect(result.current.isAuthenticated).toBe(true);
  });
});
