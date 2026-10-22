/**
 * Support-Menüpunkt und -Seite — nur für Founding Partner
 *
 * 22.10.2026: Die Karte „Direkter Draht" lag auf der Übersicht und
 * wurde nicht gefunden. Jetzt ein Menüpunkt. Die Gegenprobe ist die
 * tragende: Ein normaler Kunde sieht ihn NICHT.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { sichtbareNavItems } from './DashboardLayout';

jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { from: jest.fn(), auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));
const mockAuth = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuthContext: () => mockAuth(),
}));
jest.mock('../../context/IndustryContext', () => ({
  useIndustry: () => ({ brand: { name: 'WERKRUF', logo: 'WERKRUF' } }),
}));
jest.mock('../../components/dashboard/DirekterDraht', () => ({
  __esModule: true,
  default: () => <div data-testid="direkter-draht" />,
}));

import DashboardSupport from './DashboardSupport';

describe('sichtbareNavItems', () => {
  const items = [
    { to: '/a', label: 'A' },
    { to: '/s', label: 'Support', nurFoundingPartner: true },
    { to: '/b', label: 'B' },
  ];

  it('zeigt Founding Partnern den Support-Punkt', () => {
    expect(sichtbareNavItems({ plan: 'founding_partner' }, items).map((i) => i.label))
      .toEqual(['A', 'Support', 'B']);
  });

  /* ── GEGENPROBE ── */
  it('zeigt anderen Kunden den Support-Punkt NICHT — Reihenfolge der übrigen bleibt', () => {
    for (const profil of [{ plan: 'pro' }, { plan: 'free' }, { plan: 'starter' }, null, undefined]) {
      expect(sichtbareNavItems(profil, items).map((i) => i.label)).toEqual(['A', 'B']);
    }
  });

  it('hat den Support-Punkt in der echten Navigation, und nur ihn als FP-exklusiv', () => {
    const alle = sichtbareNavItems({ plan: 'founding_partner' });
    const normal = sichtbareNavItems({ plan: 'pro' });
    const nurFp = alle.filter((i) => !normal.includes(i)).map((i) => i.label);
    expect(nurFp).toEqual(['Support']);
    expect(alle.find((i) => i.label === 'Support').to).toBe('/dashboard/support');
  });
});

describe('DashboardSupport', () => {
  it('zeigt Founding Partnern den Direkten Draht', () => {
    mockAuth.mockReturnValue({ profile: { plan: 'founding_partner' } });
    render(<MemoryRouter><DashboardSupport /></MemoryRouter>);
    expect(screen.getByTestId('direkter-draht')).toBeInTheDocument();
    expect(screen.queryByTestId('support-kein-fp')).not.toBeInTheDocument();
  });

  it('zeigt anderen einen ruhigen Hinweis — keine Umleitung, kein Direkter Draht', () => {
    mockAuth.mockReturnValue({ profile: { plan: 'pro' } });
    render(<MemoryRouter><DashboardSupport /></MemoryRouter>);
    expect(screen.getByTestId('support-kein-fp')).toBeInTheDocument();
    expect(screen.queryByTestId('direkter-draht')).not.toBeInTheDocument();
    expect(screen.getByText(/info@werkruf\.com/)).toBeInTheDocument();
  });

  it('wirft einen Founding Partner beim ersten Rendern (Profil noch null) nicht hinaus', () => {
    /* Die Rennbedingung des ersten Entwurfs: profile === null heisst
       "noch nicht geladen", nicht "kein Partner". Eine Umleitung hier
       haette echte Partner kurz auf die Uebersicht geworfen. Es darf
       keine Navigate-Komponente geben — die Seite bleibt stehen. */
    mockAuth.mockReturnValue({ profile: null });
    const { container } = render(<MemoryRouter initialEntries={['/dashboard/support']}><DashboardSupport /></MemoryRouter>);
    expect(container.textContent).toMatch(/Support/);
  });
});
