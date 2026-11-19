/**
 * Foto → Google-Beitrag (Vorschlag zum Freigeben) und „Per WhatsApp teilen".
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  bildUrlErlaubt, bildFuerBeitrag, pruefeNotiz, pruefeKiVorschlag, fotoBeitragSystem, fotoBeitragAnfrage,
  whatsappBewertungsText, whatsappLink, NOTIZ_MAX_ZEICHEN, UNKLAR, VORSCHLAEGE_PRO_TAG,
} from './utils/fotoBeitrag';
import FotoBeitragDialog from './components/dashboard/FotoBeitragDialog';

jest.mock('./supabaseClient', () => ({ __esModule: true, default: { auth: { getSession: jest.fn() } } }));

const lies = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CLOUD = 'https://res.cloudinary.com/werkruf/image/upload/v1/fotos/abc.jpg';

describe('Regeln (fotoBeitrag.js)', () => {
  it('F1 — nur eigene Cloudinary-Bilder; Groesse/Format fuer Modell und Google begrenzt', () => {
    expect(bildUrlErlaubt(CLOUD)).toBe(true);
    expect(bildUrlErlaubt('http://res.cloudinary.com/werkruf/image/upload/x.jpg')).toBe(false);
    expect(bildUrlErlaubt('https://evil.example/image/upload/x.jpg')).toBe(false);
    expect(bildUrlErlaubt('https://res.cloudinary.com.evil.example/image/upload/x.jpg')).toBe(false);
    expect(bildFuerBeitrag(CLOUD)).toBe('https://res.cloudinary.com/werkruf/image/upload/w_1600,h_1600,c_limit,f_jpg,q_auto/v1/fotos/abc.jpg');
    expect(bildFuerBeitrag('https://evil.example/x.jpg')).toBeNull();
  });
  it('F2 — Notiz optional, begrenzt, Leerraum normalisiert', () => {
    expect(pruefeNotiz(undefined)).toEqual({ ok: true, text: '' });
    expect(pruefeNotiz('  Neue   Wärmepumpe ')).toEqual({ ok: true, text: 'Neue Wärmepumpe' });
    expect(pruefeNotiz('x'.repeat(NOTIZ_MAX_ZEICHEN + 1)).ok).toBe(false);
  });
  it('F3 — KI-Vorschlag: UNKLAR, Links, Telefon, Preise, Hashtags, Emojis, Versprechen werden abgelehnt, nie „repariert"', () => {
    const gut = 'Heute haben wir in einem Einfamilienhaus eine neue Wärmepumpe angeschlossen. Sauber verlegt und geprüft. Sprechen Sie uns gern an.';
    expect(pruefeKiVorschlag(`„${gut}"`)).toEqual({ ok: true, text: gut });
    expect(pruefeKiVorschlag(UNKLAR).grund).toBe('unklar');
    expect(pruefeKiVorschlag(`${gut} Mehr auf www.beispiel.de`).grund).toBe('link');
    expect(pruefeKiVorschlag(`${gut} Tel. 040 123 45 67`).grund).toBe('telefon');
    expect(pruefeKiVorschlag(`${gut} Jetzt 10 % Rabatt.`).grund).toBe('preis');
    expect(pruefeKiVorschlag(`${gut} #handwerk`).grund).toBe('hashtag');
    expect(pruefeKiVorschlag(`${gut} 🔧`).grund).toBe('emoji');
    expect(pruefeKiVorschlag(`${gut} Mit Garantie.`).grund).toBe('versprechen');
    expect(pruefeKiVorschlag('').ok).toBe(false);
  });
  it('F4 — Anweisung: nur Foto + Notiz, nichts erfinden, keine Personen, Vorschlag statt Automatik', () => {
    const sys = fotoBeitragSystem();
    expect(sys).toMatch(/Erfinde nichts/);
    expect(sys).toMatch(/keine Personen|Beschreibe keine Personen/);
    expect(sys).toMatch(new RegExp(UNKLAR));
    expect(fotoBeitragAnfrage({ betrieb: 'Muster GmbH', gewerk: 'plumber', notiz: '' })).toMatch(/Keine Notiz/);
    expect(VORSCHLAEGE_PRO_TAG).toBe(20);
  });
  it('F5 — WhatsApp: Sie-Form, Link und Betrieb im Text, wa.me ohne Empfänger', () => {
    const t = whatsappBewertungsText({ betrieb: 'Muster GmbH', link: 'https://werkruf.com/b/abc' });
    expect(t).toMatch(/^Guten Tag,/);
    expect(t).toMatch(/Ihren Auftrag/);
    expect(t).toMatch(/https:\/\/werkruf\.com\/b\/abc/);
    expect(t).toMatch(/Muster GmbH$/);
    const l = whatsappLink(t);
    expect(l.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(l.slice('https://wa.me/?text='.length))).toBe(t);
  });
});

describe('Server (google-business, Quelltext)', () => {
  const gb = ohneKommentare(lies('../supabase/functions/google-business/index.ts'));
  const block = (name) => gb.slice(gb.indexOf(`async function ${name}(`), gb.indexOf('\n}\n', gb.indexOf(`async function ${name}(`)));
  it('S1 — Foto kommt aus business_photos DES Nutzers (photoId), nie als URL vom Client', () => {
    const f = block('ladeEigenesFoto');
    expect(f).toMatch(/\.from\('business_photos'\)\.select\('id, cloudinary_url'\)\s*\.eq\('id', photoId\)\.eq\('profile_id', userId\)/);
    expect(f).toMatch(/bildFuerBeitrag\(data\.cloudinary_url\)/);
    expect(block('handlePhotoPostPreview')).not.toMatch(/body\.(url|sourceUrl|bild)/);
    expect(block('handlePhotoPostPublish')).not.toMatch(/body\.(url|sourceUrl|bild)/);
  });
  it('S2 — beide Wege nur mit Pro/FP, eigener Standort; Vorschlag mit Tageslimit', () => {
    for (const n of ['handlePhotoPostPreview', 'handlePhotoPostPublish']) {
      expect(block(n)).toMatch(/await requirePaidAccess\(user\.id\);/);
      expect(block(n)).toMatch(/await loadOwnLocation\(body\.locationId, user\.id\)/);
    }
    expect(block('handlePhotoPostPreview')).toMatch(/enforceRateLimit\(`foto-beitrag:\$\{user\.id\}`, VORSCHLAEGE_PRO_TAG, '1 day'\)/);
  });
  it('S3 — Vorschlag veroeffentlicht nichts; Veroeffentlichen nur mit geprueftem Text und Sperre je Foto', () => {
    expect(block('handlePhotoPostPreview')).not.toMatch(/createLocalPost|photo_posts/);
    const p = block('handlePhotoPostPublish');
    expect(p).toMatch(/pruefeBeitragstext\(body\.summary\)/);
    expect(p).toMatch(/'23505'\) throw new GbpError\('bad_request', 'bereits'/);
    expect(p).toMatch(/createLocalPost\(location\.account_resource_name, location\.location_resource_name, summary, 'de', foto\.url\)/);
  });
  it('S4 — Logs/Audit ohne Text, Notiz oder Bild-URL', () => {
    const p = block('handlePhotoPostPreview') + block('handlePhotoPostPublish');
    for (const m of p.match(/console\.warn\([^;]*;/g) || []) expect(m).not.toMatch(/text|notiz|url|summary|vorschlag/i);
    for (const m of p.match(/metadata: \{[^}]*\}/g) || []) expect(m).not.toMatch(/summary[,:]|notiz:|url|vorschlag:/);
  });
  it('S5 — Routen registriert', () => {
    expect(gb).toMatch(/'photo-post-preview':\s*\{ method: 'POST', handler: handlePhotoPostPreview \}/);
    expect(gb).toMatch(/'photo-post':\s*\{ method: 'POST', handler: handlePhotoPostPublish \}/);
  });
});

describe('FotoBeitragDialog', () => {
  const FOTO = { id: '11111111-1111-4111-8111-111111111111', cloudinary_url: CLOUD };
  const ORT = { id: '22222222-2222-4222-8222-222222222222' };
  const VORSCHLAG = 'Heute haben wir eine neue Wärmepumpe angeschlossen. Sauber verlegt und geprüft.';

  it('D1 — Vorschlag füllt den Text; veröffentlicht wird erst per Klick, mit genau diesem Text', async () => {
    const rufe = jest.fn(async (pfad) => (pfad === 'photo-post-preview'
      ? { ok: true, vorschlag: VORSCHLAG }
      : { ok: true, status: 'published', googleState: 'PROCESSING' }));
    render(<FotoBeitragDialog foto={FOTO} location={ORT} onClose={() => {}} rufe={rufe} />);
    expect(screen.getByTestId('foto-veroeffentlichen')).toBeDisabled();
    fireEvent.change(screen.getByTestId('foto-notiz'), { target: { value: 'Wärmepumpe' } });
    await act(async () => { fireEvent.click(screen.getByTestId('foto-vorschlag')); });
    expect(rufe).toHaveBeenCalledWith('photo-post-preview', { locationId: ORT.id, photoId: FOTO.id, notiz: 'Wärmepumpe' });
    expect(screen.getByTestId('foto-text')).toHaveValue(VORSCHLAG);
    expect(rufe).toHaveBeenCalledTimes(1);                                   // Vorschlag ≠ Veröffentlichen
    fireEvent.change(screen.getByTestId('foto-text'), { target: { value: `${VORSCHLAG} Geändert.` } });
    await act(async () => { fireEvent.click(screen.getByTestId('foto-veroeffentlichen')); });
    expect(rufe).toHaveBeenLastCalledWith('photo-post', { locationId: ORT.id, photoId: FOTO.id, summary: `${VORSCHLAG} Geändert.`, vorschlagGenutzt: true });
    expect(screen.getByTestId('foto-status')).toHaveTextContent('an Google übermittelt');
  });
  it('D2 — kein Vorschlag (unklar/limit): Hinweis, Text bleibt leer, selbst schreiben geht', async () => {
    const rufe = jest.fn(async (pfad) => (pfad === 'photo-post-preview' ? { ok: false, reason: 'unklar' } : { ok: true, status: 'published', googleState: 'LIVE' }));
    render(<FotoBeitragDialog foto={FOTO} location={ORT} onClose={() => {}} rufe={rufe} />);
    await act(async () => { fireEvent.click(screen.getByTestId('foto-vorschlag')); });
    expect(screen.getByTestId('foto-hinweis')).toHaveTextContent('keine Arbeit klar erkennbar');
    expect(screen.getByTestId('foto-text')).toHaveValue('');
    fireEvent.change(screen.getByTestId('foto-text'), { target: { value: 'Neues Bad im Altbau fertig gefliest.' } });
    await act(async () => { fireEvent.click(screen.getByTestId('foto-veroeffentlichen')); });
    expect(rufe).toHaveBeenLastCalledWith('photo-post', expect.objectContaining({ vorschlagGenutzt: false }));
  });
});

describe('Einbau', () => {
  it('E1 — Fotos-Seite: „Beitrag daraus" je hochgeladenem Foto, Dialog mit ausgewähltem Betrieb', () => {
    const f = lies('pages/dashboard/DashboardFotos.js');
    expect(f).toMatch(/data-testid="foto-beitrag-oeffnen"/);
    expect(f).toMatch(/<FotoBeitragDialog foto=\{beitragFoto\} location=\{standort\}/);
  });
  it('E2 — Kunden gewinnen: „Per WhatsApp teilen" mit Bewertungslink, öffnet WhatsApp (kein Versand über WERKRUF)', () => {
    const k = lies('pages/dashboard/DashboardKundenGewinnung.js');
    expect(k).toMatch(/whatsappLink\(whatsappBewertungsText\(\{ betrieb: companyName, link: reviewUrl \}\)\)/);
    expect(k).toMatch(/Per WhatsApp teilen/);
  });
  it('E3 — Changelog, Hilfe und Datenschutz nennen beide Funktionen', () => {
    expect(lies('config/changelog.js')).toMatch(/Beitrag aus einem Foto[\s\S]*Bewertungslink per WhatsApp teilen/);
    const h = lies('config/hilfe.js');
    expect(h).toMatch(/Beitrag aus einem Foto/);
    expect(h).toMatch(/Per WhatsApp teilen/);
    expect(lies('pages/Datenschutz.js')).toMatch(/Text für einen Google-Beitrag zu einem\s+Foto/);
  });
});
