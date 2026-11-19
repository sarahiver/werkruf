/**
 * Mobil-Check 19.11.2026 — was am Handy hakte, als Wirkung geprueft.
 */
import { aboStatusText, brancheText } from './pages/dashboard/DashboardSettings';
import { ordneEin } from './components/dashboard/WerkrufScore';

jest.mock('./supabaseClient', () => ({ __esModule: true, default: { from: jest.fn(), auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } }));

describe('Einstellungen zeigen keine Rohwerte', () => {
  it('übersetzt Stripe-Status ins Deutsche', () => {
    expect(aboStatusText('active')).toBe('aktiv');
    expect(aboStatusText('trialing')).toBe('Testphase');
    expect(aboStatusText('past_due')).toBe('Zahlung offen');
  });
  it('zeigt die Branche als Wort, nicht als Schlüssel', () => {
    expect(brancheText('handwerk')).toBe('Handwerk');
    expect(brancheText(null)).toBe('—');
  });
});

describe('Score-Sätze widersprechen sich nicht', () => {
  it('nennt „noch ganz offen" und „meiste Punkte" mit unterschiedlicher Bedeutung', () => {
    const f = [
      { id: 'responseRate', points: 8 }, { id: 'rating', points: 25 }, { id: 'recency', points: 20 },
      { id: 'completeness', points: 15 }, { id: 'photos', points: 0 },
    ];
    const { satz, schwaeche } = ordneEin(f, 12);
    expect(satz).toMatch(/Noch ohne Punkte: Fotos/);
    expect(schwaeche).toMatch(/Die meisten Punkte holst du derzeit bei Antworten auf Bewertungen/);
    expect(`${satz} ${schwaeche}`).not.toMatch(/vor allem/);
  });
});
