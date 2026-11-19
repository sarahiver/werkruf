/**
 * Website aus dem Google-Profil — Regeln, Vorlage, Pruefungen.
 * Geprueft wird die Wirkung (was auf der Seite steht / was abgewiesen wird).
 */
import {
  slugAus, slugGueltig, pruefeImpressum, pruefeWebsiteEingabe, baueModell, renderSeite, startWerte,
  pruefeWebsiteTexte, kurzName, oeffnungszeitenAus, eigenesBild, WEBSITE_FARBEN,
} from './utils/website';

const UID = '11111111-1111-4111-8111-111111111111';
const FREMD = '22222222-2222-4222-8222-222222222222';
const bild = (uid, n) => `https://res.cloudinary.com/demo/image/upload/v1/werkruf/profiles/${uid}/${n}.jpg`;
const FOTOS = [{ id: 'f1', url: bild(UID, 'a') }, { id: 'f2', url: bild(UID, 'b') }, { id: 'f3', url: bild(UID, 'c') }];

const IMPRESSUM_OK = {
  firma: 'Elektro Krause', rechtsform: 'einzelunternehmen', inhaber: 'Jens Krause',
  strasse: 'Hauptstr. 1', plz: '20095', ort: 'Hamburg', telefon: '040 123456', email: 'info@krause.de',
  kammer: 'Handwerkskammer Hamburg',
};
const LOCATION = {
  id: 'loc', title: 'Elektro Krause', primary_phone: '040 123456', locality: 'Hamburg', place_id: 'PID',
  primary_category: 'gcid:electrician', review_count: 12, average_rating: 4.8,
  google_profile: {
    categories: { primaryCategory: { displayName: 'Elektriker' } },
    profile: { description: 'Wir sind ein Elektrobetrieb in Hamburg.' },
    storefrontAddress: { addressLines: ['Hauptstr. 1'], postalCode: '20095', locality: 'Hamburg' },
    regularHours: { periods: [
      { openDay: 'MONDAY', openTime: { hours: 8 }, closeDay: 'MONDAY', closeTime: { hours: 17 } },
      { openDay: 'TUESDAY', openTime: { hours: 8, minutes: 30 }, closeDay: 'TUESDAY', closeTime: { hours: 12 } },
      { openDay: 'TUESDAY', openTime: { hours: 13 }, closeDay: 'TUESDAY', closeTime: { hours: 17 } },
    ] },
    serviceItems: [
      { freeFormServiceItem: { label: { displayName: 'E-Check', description: 'Prüfung nach DGUV V3' } } },
      { freeFormServiceItem: { label: { displayName: 'e-check' } } },
      { structuredServiceItem: { serviceTypeId: 'job_type_id:install_lighting' } },
    ],
    serviceArea: { places: { placeInfos: [{ placeName: 'Hamburg' }, { placeName: 'Norderstedt' }] } },
  },
};
const BEWERTUNGEN = [
  { reviewer_display_name: 'Anna Maria Schulz', star_rating: 5, comment: 'Super schnell da.' },
  { reviewer_display_name: 'Bernd', star_rating: 2, comment: 'Termin verschoben.' },
  { reviewer_display_name: 'X Y', reviewer_is_anonymous: true, star_rating: 4, comment: 'Gut.' },
];

describe('Adresse (Slug)', () => {
  it('macht aus dem Betriebsnamen eine gültige Adresse', () => {
    expect(slugAus('Elektro Krause GmbH & Co. KG')).toBe('elektro-krause-gmbh-und-co-kg');
    expect(slugAus('Müller Sanitär')).toBe('mueller-sanitaer');
    expect(slugGueltig(slugAus('Müller Sanitär'))).toBe(true);
  });
  it('weist reservierte, zu kurze und kaputte Adressen ab', () => {
    for (const s of ['admin', 'ab', 'a--b', '-abc', 'Abc', 'abc-', 'ab c', 'x'.repeat(51)]) expect(slugGueltig(s)).toBe(false);
    expect(slugAus('!!')).toBe('');
  });
});

describe('Impressum', () => {
  it('ist mit den Pflichtangaben eines Einzelunternehmens vollständig', () => {
    expect(pruefeImpressum(IMPRESSUM_OK).ok).toBe(true);
  });
  it('verlangt bei einer GmbH Vertretung und Register — nicht den Inhaber', () => {
    const r = pruefeImpressum({ ...IMPRESSUM_OK, rechtsform: 'gmbh', inhaber: '' });
    expect(r.ok).toBe(false);
    expect(r.fehlend).toEqual(expect.arrayContaining(['vertreten_durch', 'registergericht', 'registernummer']));
    expect(r.fehlend).not.toContain('inhaber');
  });
  it('erkennt fehlende Kammer, falsche PLZ, E-Mail und USt-ID', () => {
    const r = pruefeImpressum({ ...IMPRESSUM_OK, kammer: '', plz: '2009', email: 'kein-mail', ustid: 'DE12' });
    expect(r.fehlend).toContain('kammer');
    expect(r.fehler).toEqual(expect.arrayContaining(['plz', 'email', 'ustid']));
  });
});

describe('Eingaben aus dem Editor', () => {
  const opts = { userId: UID, fotoIds: ['f1', 'f2', 'f3'] };
  it('übernimmt gültige Werte und kürzt zu lange Texte', () => {
    const r = pruefeWebsiteEingabe({ farbe: 'petrol', slogan: 'x'.repeat(500), leistungen: [{ name: 'E-Check', text: 'Prüfung' }], titelbild_id: 'f2', fotos_aus: ['f1', 'f9'] }, opts);
    expect(r.ok).toBe(true);
    expect(r.werte.slogan).toHaveLength(140);
    expect(r.werte.titelbild_id).toBe('f2');
    expect(r.werte.fotos_aus).toEqual(['f1']);
  });
  it('ersetzt unbekannte Farben durch die Standardfarbe', () => {
    expect(pruefeWebsiteEingabe({ farbe: 'pink' }, opts).werte.farbe).toBe('marine');
  });
  it('weist ein Logo aus einem fremden Ordner ab', () => {
    expect(eigenesBild(bild(UID, 'logo'), UID)).toBe(true);
    const r = pruefeWebsiteEingabe({ logo_url: bild(FREMD, 'logo') }, opts);
    expect(r).toMatchObject({ ok: false, grund: 'bild' });
    expect(pruefeWebsiteEingabe({ logo_url: 'https://evil.example/logo.png' }, opts).ok).toBe(false);
  });
  it('ignoriert Titelbilder, die nicht dem Nutzer gehören', () => {
    expect(pruefeWebsiteEingabe({ titelbild_id: 'fremd' }, opts).werte.titelbild_id).toBeNull();
  });
  it('weist Links, Preise und Versprechen in Texten ab', () => {
    expect(pruefeWebsiteEingabe({ slogan: 'Jetzt 20 % Rabatt' }, opts)).toMatchObject({ ok: false, grund: 'preis' });
    expect(pruefeWebsiteEingabe({ ueber_text: 'Mehr auf www.krause.de' }, opts)).toMatchObject({ ok: false, grund: 'link' });
    expect(pruefeWebsiteEingabe({ leistungen: [{ name: 'Montage', text: 'mit Garantie' }] }, opts)).toMatchObject({ ok: false, grund: 'versprechen' });
  });
});

describe('Daten aus dem Google-Profil', () => {
  it('übernimmt freie Leistungen ohne Duplikate', () => {
    expect(startWerte({ location: LOCATION, profil: LOCATION.google_profile }).leistungen).toEqual([{ name: 'E-Check', text: 'Prüfung nach DGUV V3' }]);
  });
  it('setzt Firma, Telefon und Adresse ins Impressum vor', () => {
    expect(startWerte({ location: LOCATION, profil: LOCATION.google_profile }).impressum).toMatchObject({ firma: 'Elektro Krause', plz: '20095', ort: 'Hamburg' });
  });
  it('formatiert Öffnungszeiten je Tag, auch mit Mittagspause', () => {
    const z = oeffnungszeitenAus(LOCATION.google_profile);
    expect(z[0]).toEqual({ tag: 'Montag', zeiten: '08:00–17:00' });
    expect(z[1]).toEqual({ tag: 'Dienstag', zeiten: '08:30–12:00, 13:00–17:00' });
    expect(z[6]).toEqual({ tag: 'Sonntag', zeiten: 'geschlossen' });
  });
  it('zeigt nie den vollen Namen von Bewertenden', () => {
    expect(kurzName('Anna Maria Schulz')).toBe('Anna S.');
    expect(kurzName('X Y', true)).toBe('Google-Nutzer');
  });
});

describe('Vorlage', () => {
  const website = { farbe: 'waldgruen', slogan: 'Strom, der läuft.', ueber_text: 'Seit langem hier.', leistungen: [{ name: 'E-Check', text: 'Prüfung' }], titelbild_id: 'f2', fotos_aus: ['f3'], impressum: IMPRESSUM_OK, kontakt_email: 'anfrage@krause.de' };
  const modell = baueModell({ location: LOCATION, website, fotos: FOTOS, bewertungen: BEWERTUNGEN });
  const start = renderSeite(modell, '/', { basis: '/seite/elektro-krause', kanonischBasis: 'https://werkruf.com/seite/elektro-krause' });

  it('baut Startseite mit Name, Gewerk, Ort, Telefon und gewählter Farbe', () => {
    expect(start.status).toBe(200);
    expect(start.html).toContain('<h1>Elektro Krause – Elektriker in Hamburg</h1>');
    expect(start.html).toContain('href="tel:040123456"');
    expect(start.html).toContain(WEBSITE_FARBEN.waldgruen.primaer);
    expect(start.html).toContain('mailto:anfrage@krause.de');
    expect(start.html).toContain('<link rel="canonical" href="https://werkruf.com/seite/elektro-krause/">');
  });
  it('nutzt das gewählte Titelbild und lässt ausgeblendete Fotos weg', () => {
    expect(start.html).toContain('w_1600,c_limit,f_auto,q_auto/v1/werkruf/profiles/' + UID + '/b.jpg');
    expect(start.html).not.toContain('/c.jpg');
  });
  it('zeigt Bewertungen ungefiltert mit gekürzten Namen und Hinweis', () => {
    expect(start.html).toContain('Anna S.');
    expect(start.html).not.toContain('Anna Maria Schulz');
    expect(start.html).toContain('Termin verschoben.');
    expect(start.html).toContain('ungefiltert');
  });
  it('blendet Bewertungen aus, wenn der Betrieb das will', () => {
    const ohne = renderSeite(baueModell({ location: LOCATION, website: { ...website, bewertungen_zeigen: false }, fotos: FOTOS, bewertungen: BEWERTUNGEN }), '/');
    expect(ohne.html).not.toContain('Das sagen unsere Kunden');
  });
  it('lädt nichts von Dritten außer Bildern von Cloudinary', () => {
    for (const p of ['/', '/impressum', '/datenschutz']) {
      const { html } = renderSeite(modell, p);
      expect(html).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
      expect(html).not.toMatch(/fonts\.googleapis|maps\.googleapis|<iframe|google-analytics|googletagmanager/);
      const quellen = [...html.matchAll(/(?:src=|url\(')"?(https?:\/\/[^"')]+)/g)].map((m) => new URL(m[1]).hostname);
      expect(quellen.every((h) => h === 'res.cloudinary.com')).toBe(true);
    }
  });
  it('escaped Eingaben — kein HTML aus Texten oder Profil', () => {
    const boese = baueModell({ location: { ...LOCATION, title: '<img src=x onerror=alert(1)>' }, website: { ...website, slogan: '"><script>alert(1)</script>' }, fotos: FOTOS, bewertungen: [{ reviewer_display_name: 'A', star_rating: 5, comment: '<b>x</b>' }] });
    const { html } = renderSeite(boese, '/');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('rendert Impressum mit Pflichtangaben und Kammer', () => {
    const { html } = renderSeite(modell, '/impressum', { basis: '/seite/elektro-krause' });
    expect(html).toContain('Angaben gemäß § 5 DDG');
    expect(html).toContain('Inhaber/in: Jens Krause');
    expect(html).toContain('Handwerkskammer Hamburg');
    expect(html).toContain('href="/seite/elektro-krause/datenschutz"');
  });
  it('liefert 404 für unbekannte Pfade', () => {
    expect(renderSeite(modell, '/wp-admin').status).toBe(404);
  });
  it('markiert die Dashboard-Vorschau als noindex', () => {
    expect(renderSeite(modell, '/', { vorschau: true }).html).toContain('noindex,nofollow');
    expect(start.html).not.toContain('noindex');
  });
});

describe('KI-Textvorschlag', () => {
  it('übernimmt nur genannte Leistungen', () => {
    const r = pruefeWebsiteTexte(JSON.stringify({ slogan: 'Ihr Elektriker.', ueber: 'Wir arbeiten sorgfältig.', leistungen: [{ name: 'e-check', text: 'Wir prüfen.' }, { name: 'Solaranlagen', text: 'Erfunden.' }] }), ['E-Check']);
    expect(r.ok).toBe(true);
    expect(r.leistungen).toEqual([{ name: 'E-Check', text: 'Wir prüfen.' }]);
  });
  it('verwirft kaputtes JSON und Texte mit Preisen oder Links', () => {
    expect(pruefeWebsiteTexte('kein json', []).ok).toBe(false);
    expect(pruefeWebsiteTexte(JSON.stringify({ slogan: 'Ab 99 €', ueber: '', leistungen: [] }), []).ok).toBe(false);
    expect(pruefeWebsiteTexte('```json\n{"slogan":"Gut gemacht.","ueber":"","leistungen":[]}\n```', []).ok).toBe(true);
  });
});
