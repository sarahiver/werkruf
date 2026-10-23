/**
 * Konto löschen — Dialog und Alternative (WP1, 22.10.2026)
 *
 * Die tragenden Prüfungen sind die Gegenproben:
 *   • Ein Klick löscht NICHTS. Zwei Klicks auch nicht. Erst das
 *     getippte Wort schaltet den Knopf frei.
 *   • Antwortet der Server nicht mit deleted: true, bleibt der Nutzer
 *     auf der Seite und sieht die Servermeldung — keine Umleitung.
 *   • Die Folgenliste nennt „ohne Erstattung“ nur, wenn ein Abo läuft.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('../../supabaseClient', () => ({
  __esModule: true,
  default: { functions: { invoke: (...a) => mockInvoke(...a) } },
}));

import KontoLoeschen, { AboKuendigenHinweis, loeschFolgen, BESTAETIGUNGSWORT } from './KontoLoeschen';

const oeffneDialog = () => fireEvent.click(screen.getByRole('button', { name: /Konto löschen …/ }));
const tippe = (wort) => fireEvent.change(screen.getByLabelText(/Zum Bestätigen/), { target: { value: wort } });

beforeEach(() => {
  mockInvoke.mockReset();
  delete window.location;
  window.location = { href: '/dashboard/einstellungen' };
});

describe('loeschFolgen', () => {
  it('nennt „ohne Erstattung“ nur bei laufendem Abo — und nie bei Founding Partnern', () => {
    expect(loeschFolgen({ aboAktiv: true,  foundingPartner: false }).join(' ')).toMatch(/nicht erstattet/);
    expect(loeschFolgen({ aboAktiv: false, foundingPartner: false }).join(' ')).not.toMatch(/erstattet/);
    expect(loeschFolgen({ aboAktiv: true,  foundingPartner: true  }).join(' ')).not.toMatch(/erstattet/);
  });

  it('sagt immer: sofort, endgültig, Google-Profil bleibt, Berechtigung zurück, Mail', () => {
    const text = loeschFolgen({ aboAktiv: false, foundingPartner: false }).join(' ');
    expect(text).toMatch(/sofort und endgültig/);
    expect(text).toMatch(/Google-Unternehmensprofil bleibt unverändert/);
    expect(text).toMatch(/Berechtigung .* zurückgegeben/);
    expect(text).toMatch(/Bestätigung per E-Mail/);
  });
});

describe('KontoLoeschen — Dialog', () => {
  /* ── GEGENPROBE ── */
  it('löscht NICHT beim ersten Klick und nicht ohne das Wort', () => {
    render(<KontoLoeschen aboAktiv foundingPartner={false} email="x@y.de" />);
    oeffneDialog();
    expect(screen.getByRole('dialog')).toHaveTextContent(/nicht erstattet/);
    const knopf = screen.getByRole('button', { name: /Endgültig löschen/ });
    expect(knopf).toBeDisabled();
    fireEvent.click(knopf);
    tippe('löschen');            // Kleinschreibung reicht nicht
    expect(screen.getByRole('button', { name: /Endgültig löschen/ })).toBeDisabled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('ruft delete-account erst nach dem getippten Wort und leitet nur bei deleted: true um', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, deleted: true }, error: null });
    render(<KontoLoeschen aboAktiv={false} foundingPartner={false} email="x@y.de" />);
    oeffneDialog();
    tippe(BESTAETIGUNGSWORT);
    fireEvent.click(screen.getByRole('button', { name: /Endgültig löschen/ }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('delete-account'));
    await waitFor(() => expect(window.location.href).toBe('/'));
  });

  /* ── GEGENPROBE ── */
  it('bleibt bei einem Serverfehler auf der Seite und zeigt die Servermeldung', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'Dein Abo konnte bei unserem Zahlungsdienst nicht gekündigt werden. Dein Konto wurde NICHT gelöscht und nichts verändert.', deleted: false },
      error: { message: 'Edge Function returned a non-2xx status code' },
    });
    render(<KontoLoeschen aboAktiv foundingPartner={false} email="x@y.de" />);
    oeffneDialog();
    tippe(BESTAETIGUNGSWORT);
    fireEvent.click(screen.getByRole('button', { name: /Endgültig löschen/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/NICHT gelöscht/);
    expect(window.location.href).toBe('/dashboard/einstellungen');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  /* ── GEGENPROBE ── */
  it('leitet auch bei 2xx ohne deleted: true NICHT um', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    render(<KontoLoeschen aboAktiv={false} foundingPartner={false} />);
    oeffneDialog();
    tippe(BESTAETIGUNGSWORT);
    fireEvent.click(screen.getByRole('button', { name: /Endgültig löschen/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(window.location.href).toBe('/dashboard/einstellungen');
  });

  it('Abbrechen schliesst den Dialog, ohne etwas zu rufen', () => {
    render(<KontoLoeschen aboAktiv={false} foundingPartner={false} />);
    oeffneDialog();
    tippe(BESTAETIGUNGSWORT);
    fireEvent.click(screen.getByRole('button', { name: /Abbrechen/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('AboKuendigenHinweis', () => {
  it('zeigt die Alternative mit Periodenende und öffnet das Portal', () => {
    const onPortal = jest.fn();
    render(<AboKuendigenHinweis sichtbar periodeEndet="3. November 2026" onPortal={onPortal} laeuft={false} />);
    expect(screen.getByTestId('abo-kuendigen')).toHaveTextContent(/3\. November 2026/);
    expect(screen.getByTestId('abo-kuendigen')).toHaveTextContent(/Konto und deine Daten bleiben/);
    fireEvent.click(screen.getByRole('button', { name: /Abo kündigen/ }));
    expect(onPortal).toHaveBeenCalled();
  });

  it('zeigt nichts, wenn es nichts zu kündigen gibt', () => {
    const { container } = render(<AboKuendigenHinweis sichtbar={false} onPortal={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
