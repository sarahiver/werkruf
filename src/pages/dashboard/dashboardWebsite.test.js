/**
 * Dashboard „Deine Website": Speichern, Veroeffentlichen erst mit
 * vollstaendigem Impressum, KI-Vorschlag nur als Vorschlag.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../../supabaseClient', () => ({ __esModule: true, default: { from: jest.fn(), auth: { getSession: () => Promise.resolve({ data: { session: null } }), getUser: () => Promise.resolve({ data: { user: null } }) } } }));
jest.mock('../../components/dashboard/ProGate', () => ({ __esModule: true, default: ({ children }) => <>{children}</> }));

import DashboardWebsite, { oeffentlicheAdresse } from './DashboardWebsite';

const IMPRESSUM_OK = { firma: 'Elektro Krause', rechtsform: 'einzelunternehmen', inhaber: 'Jens Krause', strasse: 'Hauptstr. 1', plz: '20095', ort: 'Hamburg', telefon: '040 123456', email: 'info@krause.de', kammer: 'HWK Hamburg' };
const werte = (imp = {}) => ({ farbe: 'marine', slogan: '', ueber_text: 'Text', leistungen: [{ name: 'E-Check', text: '' }], kontakt_email: '', logo_url: null, titelbild_id: null, fotos_aus: [], bewertungen_zeigen: true, impressum: imp });

function aufbau(start, extra = {}) {
  const api = jest.fn(async (route, body) => {
    if (route === 'laden') return { ok: true, website: { werte: start, slug: null, status: 'entwurf', gespeichert: false }, fotos: [], vorschau: '<p>v</p>' };
    if (route === 'speichern') return { ok: true, slug: 'elektro-krause', status: 'entwurf', vorschau: '<p>neu</p>' };
    if (route === 'veroeffentlichen') return { ok: true, status: 'veroeffentlicht', slug: 'elektro-krause' };
    if (route === 'texte') return extra.texte ?? { ok: true, slogan: 'Ihr Elektriker.', ueber: 'Neu.', leistungen: [{ name: 'E-Check', text: 'Wir prüfen.' }] };
    return {};
  });
  render(<DashboardWebsite api={api} standortLaden={() => Promise.resolve({ id: 'loc' })} hochladen={jest.fn()} />);
  return api;
}

it('baut die öffentliche Adresse aus dem Slug', () => {
  expect(oeffentlicheAdresse('elektro-krause')).toBe('https://werkruf.com/seite/elektro-krause');
  expect(oeffentlicheAdresse(null)).toBeNull();
});

it('sperrt Veröffentlichen, solange das Impressum unvollständig ist', async () => {
  aufbau(werte({ firma: 'Elektro Krause' }));
  const knopf = await screen.findByTestId('website-veroeffentlichen');
  expect(knopf).toBeDisabled();
  expect(screen.getByTestId('impressum-fehlt')).toHaveTextContent(/Rechtsform/);
});

it('speichert genau die bearbeiteten Werte und zeigt die neue Vorschau', async () => {
  const api = aufbau(werte(IMPRESSUM_OK));
  fireEvent.change(await screen.findByLabelText(/Kurzer Satz/), { target: { value: 'Strom, der läuft.' } });
  fireEvent.click(screen.getByTestId('website-speichern'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('speichern', expect.objectContaining({ locationId: 'loc', werte: expect.objectContaining({ slogan: 'Strom, der läuft.' }) })));
  await waitFor(() => expect(screen.getByTestId('website-vorschau').getAttribute('srcdoc')).toBe('<p>neu</p>'));
});

it('veröffentlicht mit vollständigem Impressum und zeigt die Adresse', async () => {
  const api = aufbau(werte(IMPRESSUM_OK));
  fireEvent.click(await screen.findByTestId('website-veroeffentlichen'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('veroeffentlichen', { locationId: 'loc', an: true }));
  expect(await screen.findByText('https://werkruf.com/seite/elektro-krause', { exact: false })).toBeInTheDocument();
});

it('setzt den KI-Vorschlag nur in die Felder ein — gespeichert wird erst per Klick', async () => {
  const api = aufbau(werte(IMPRESSUM_OK));
  fireEvent.click(await screen.findByTestId('website-vorschlag'));
  expect(await screen.findByDisplayValue('Ihr Elektriker.')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Wir prüfen.')).toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith('speichern', expect.anything());
  expect(screen.getByTestId('website-speichern')).not.toBeDisabled();
});

it('zeigt einen abgelehnten Vorschlag als Hinweis statt Text', async () => {
  aufbau(werte(IMPRESSUM_OK), { texte: { ok: false, grund: 'limit' } });
  fireEvent.click(await screen.findByTestId('website-vorschlag'));
  expect(await screen.findByTestId('website-meldung')).toHaveTextContent(/keine weiteren Vorschläge/);
});

/* Gegenprobe zum leeren Bildschirm vom 19.11.: Laden scheitert → Fehler sichtbar, erneut versuchen moeglich. */
it('zeigt einen Ladefehler statt einer leeren Seite und lädt auf Wunsch neu', async () => {
  let mal = 0;
  const api = jest.fn(async () => {
    mal += 1;
    if (mal === 1) throw new Error('Die Website-Funktion ist gerade nicht erreichbar. Bitte versuch es gleich noch einmal.');
    return { ok: true, website: { werte: werte(IMPRESSUM_OK), slug: null, status: 'entwurf', gespeichert: false }, fotos: [], vorschau: '' };
  });
  render(<DashboardWebsite api={api} standortLaden={() => Promise.resolve({ id: 'loc' })} hochladen={jest.fn()} />);
  expect(await screen.findByTestId('website-ladefehler')).toHaveTextContent(/nicht erreichbar/);
  fireEvent.click(screen.getByText('Erneut versuchen'));
  expect(await screen.findByTestId('website-status')).toBeInTheDocument();
});
