/**
 * Verbindungskarte — der Zustand nach oauth_denied (WP2 T7)
 *
 * Nach einem abgebrochenen Durchlauf zeigt die Karte einen eigenen
 * Zustand mit bewusstem Knopf. Erst der Klick startet erneut — die
 * Karte selbst ruft connect() nie von sich aus.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

jest.mock('../../context/IndustryContext', () => ({ useIndustry: () => ({ brand: { name: 'WERKRUF' } }) }));
import GoogleBusinessConnect from './GoogleBusinessConnect';

const basis = (u = {}) => ({
  activeConnection: null, brokenConnection: null, isConnected: false, needsReauth: false,
  loading: false, busy: false, error: null, notice: null, connect: jest.fn(), disconnect: jest.fn(), ...u,
});

it('T7 — nach oauth_denied: eigener Zustand, Knopf „Erneut verbinden“, kein Start von selbst', async () => {
  const gb = basis({ error: 'Du hast den Zugriff bei Google abgebrochen. Ohne Freigabe können wir dein Profil nicht verwalten.' });
  render(<GoogleBusinessConnect googleBusiness={gb} />);
  expect(screen.getByText('Google-Verbindung wurde nicht abgeschlossen')).toBeInTheDocument();
  expect(screen.getByText(/Zugriff bei Google abgebrochen/)).toBeInTheDocument();
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  expect(gb.connect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Erneut verbinden/ }));
  expect(gb.connect).toHaveBeenCalledTimes(1);
});

it('ohne Fehler ist es der Erstkontakt', () => {
  render(<GoogleBusinessConnect googleBusiness={basis()} />);
  expect(screen.getByText('Google-Profil verbinden')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Mit Google verbinden/ })).toBeInTheDocument();
});
