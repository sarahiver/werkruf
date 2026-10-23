/**
 * Layout: Betriebskontext in Sidebar und Kopfzeile (WP3 T2, T8)
 *
 * Die Sidebar ist mobil eingeklappt; die Kopfzeile bleibt. Deshalb
 * stehen Karte UND Zeile im Layout — beide aus derselben Quelle.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockFrom = jest.fn();
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { from: (...a) => mockFrom(...a), auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));
jest.mock('../../context/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'u1', email: 'x@y.de' }, profile: { plan: 'pro', full_name: 'Iver' }, signOut: jest.fn(), refreshProfile: jest.fn() }),
}));
jest.mock('../../context/IndustryContext', () => ({ useIndustry: () => ({ brand: { name: 'WERKRUF', logo: 'WERKRUF' } }) }));

import DashboardLayout from './DashboardLayout';

const SI = { id: 'si', title: 'S&I', locality: 'Hamburg', place_id: 'p1', selected_at: '2026-10-23T08:00:00Z' };
const WR = { id: 'wr', title: 'WERKRUF', locality: 'Harburg', place_id: 'p2', selected_at: null };

beforeEach(() => {
  mockFrom.mockImplementation(() => ({
    select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: [SI, WR], error: null }) }) }) }),
  }));
});

it('T2/T8 — Sidebar-Karte und Kopfzeile zeigen den ausgewaehlten Betrieb; Menuepunkt heisst „Dein Google-Profil“', async () => {
  render(
    <MemoryRouter initialEntries={['/dashboard/fotos']}>
      <Routes><Route path="/dashboard" element={<DashboardLayout />}><Route path="fotos" element={<div>Inhalt</div>} /></Route></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId('betriebs-kontext')).toHaveTextContent('S&I · Hamburg');
  expect(await screen.findByTestId('betriebs-kopf')).toHaveTextContent('S&I · Hamburg');
  expect(screen.getByRole('link', { name: 'Betrieb wechseln (2 Betriebe)' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Dein Google-Profil' })).toHaveAttribute('href', '/dashboard/google');
  /* Kein alter Name mehr im Menue */
  expect(screen.queryByRole('link', { name: 'Dein Profil' })).not.toBeInTheDocument();
});
