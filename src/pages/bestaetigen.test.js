/**
 * /bestaetigen — der Bestätigungslink überlebt Mail-Scanner
 *
 * ═══════════════════════════════════════════════════════════════
 * ANLASS
 * ═══════════════════════════════════════════════════════════════
 *
 * 21.10.2026, Outlook: Der Link aus der Bestätigungsmail warf auf
 * /login. Microsoft Safe Links hatte den Einmal-Link vorab aufgerufen
 * und damit verbraucht (Supabase-Doku, "Email prefetching").
 *
 * ═══════════════════════════════════════════════════════════════
 * DIE TRAGENDEN PRÜFUNGEN SIND DIE GEGENPROBEN
 * ═══════════════════════════════════════════════════════════════
 *
 * Eine Seite, die auf einen Wert aus der Adresszeile verlinkt, ist
 * ein offener Redirect — mit WERKRUF-Logo, "Nur noch ein Klick" und
 * einem orangen Knopf, der irgendwohin führt. Dass fremde Ziele KEINEN
 * Knopf bekommen, ist wichtiger als dass echte einen bekommen.
 *
 * Und: KEIN automatisches Weiterleiten. Ein Scanner, der JavaScript
 * ausführt, würde einem Redirect folgen — dann wäre die ganze Seite
 * sinnlos.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Bestaetigen, { leseBestaetigungsLink } from './Bestaetigen';

const SUPABASE = 'https://kueoozsfkevmncucrdjd.supabase.co';
const ECHT = `${SUPABASE}/auth/v1/verify?token=abc123&type=signup&redirect_to=https://www.werkruf.com/onboarding`;

jest.mock('../context/IndustryContext', () => ({
  useIndustry: () => ({ brand: { name: 'WERKRUF' } }),
}));

/* ─────────────────────────────────────────────────────────────
   TEIL 1 — die reine Prüfung
   ───────────────────────────────────────────────────────────── */

describe('leseBestaetigungsLink — nimmt den echten Link an', () => {
  it('liest den Link UNKODIERT vollständig, inklusive type und redirect_to', () => {
    /* So kommt er an, wenn Supabase den Platzhalter roh einsetzt:
       Die Parameter des Einmal-Links werden zu Parametern unserer
       Adresse. URLSearchParams.get() verlöre alles ab dem ersten "&". */
    const r = leseBestaetigungsLink(`?confirmation_url=${ECHT}`, SUPABASE);
    expect(r.url).toBe(ECHT);
    expect(r.url).toContain('type=signup');
    expect(r.url).toContain('redirect_to=https://www.werkruf.com/onboarding');
  });

  it('liest den Link KODIERT und holt ihn zurück', () => {
    const r = leseBestaetigungsLink(`?confirmation_url=${encodeURIComponent(ECHT)}`, SUPABASE);
    expect(r.url).toBe(ECHT);
  });

  it('meldet einen fehlenden Parameter', () => {
    expect(leseBestaetigungsLink('', SUPABASE).fehler).toBe('fehlt');
    expect(leseBestaetigungsLink('?x=1', SUPABASE).fehler).toBe('fehlt');
    expect(leseBestaetigungsLink('?confirmation_url=', SUPABASE).fehler).toBe('fehlt');
  });
});

describe('leseBestaetigungsLink — GEGENPROBEN: kein offener Redirect', () => {
  const faelle = [
    ['fremder Host',                      'https://evil.example/auth/v1/verify?token=abc'],
    ['gleicher Host, fremder Pfad',       `${SUPABASE}/dashboard?token=abc`],
    ['gleicher Host, Pfad mit Anhang',    `${SUPABASE}/auth/v1/verify/../../evil`],
    ['http statt https',                  'http://kueoozsfkevmncucrdjd.supabase.co/auth/v1/verify?token=abc'],
    ['Lookalike-Host mit Suffix',         'https://kueoozsfkevmncucrdjd.supabase.co.evil.example/auth/v1/verify?token=abc'],
    ['Lookalike-Host als Subdomain',      'https://evil.kueoozsfkevmncucrdjd.supabase.co/auth/v1/verify?token=abc'],
    ['Host als Nutzername',               'https://kueoozsfkevmncucrdjd.supabase.co@evil.example/auth/v1/verify'],
    ['anderes Supabase-Projekt',          'https://anderesprojekt.supabase.co/auth/v1/verify?token=abc'],
    ['javascript:',                       'javascript:alert(1)'],
    ['data:',                             'data:text/html,<script>alert(1)</script>'],
    ['relativer Pfad',                    '/auth/v1/verify?token=abc'],
    ['Protokoll-relativ',                 '//evil.example/auth/v1/verify'],
  ];

  it.each(faelle)('weist ab: %s', (_, ziel) => {
    const r = leseBestaetigungsLink(`?confirmation_url=${ziel}`, SUPABASE);
    expect(r.url).toBeUndefined();
    expect(r.fehler).toBeDefined();
  });

  it('weist auch kodierte fremde Ziele ab', () => {
    const r = leseBestaetigungsLink(
      `?confirmation_url=${encodeURIComponent('https://evil.example/auth/v1/verify?token=abc')}`, SUPABASE,
    );
    expect(r.url).toBeUndefined();
  });

  it('gibt ohne Konfiguration nichts frei', () => {
    /* Fehlt REACT_APP_SUPABASE_URL, darf daraus nicht "alles erlaubt"
       werden. */
    expect(leseBestaetigungsLink(`?confirmation_url=${ECHT}`, undefined).url).toBeUndefined();
    expect(leseBestaetigungsLink(`?confirmation_url=${ECHT}`, '').url).toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────
   TEIL 2 — die Seite
   ───────────────────────────────────────────────────────────── */

const seite = (search) => render(
  <MemoryRouter initialEntries={[`/bestaetigen${search}`]}>
    <Bestaetigen />
  </MemoryRouter>,
);

let urlVorher;
beforeEach(() => {
  process.env.REACT_APP_SUPABASE_URL = SUPABASE;
  urlVorher = window.location.href;
});

describe('Bestaetigen — Seite', () => {
  it('zeigt bei echtem Link einen Knopf mit genau diesem Ziel', () => {
    seite(`?confirmation_url=${ECHT}`);
    const knopf = screen.getByTestId('bestaetigen-knopf');
    expect(knopf.tagName).toBe('A');
    expect(knopf).toHaveAttribute('href', ECHT);
    expect(screen.getByText(/Nur noch ein Klick/i)).toBeInTheDocument();
  });

  it('leitet NICHT automatisch weiter', () => {
    /* Der ganze Sinn der Seite. Ein Scanner, der JavaScript ausführt,
       würde einem Redirect folgen und den Link verbrauchen. */
    seite(`?confirmation_url=${ECHT}`);
    expect(window.location.href).toBe(urlVorher);
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });

  it('zeigt bei fremdem Ziel KEINEN Knopf', () => {
    seite('?confirmation_url=https://evil.example/auth/v1/verify?token=abc');
    expect(screen.queryByTestId('bestaetigen-knopf')).not.toBeInTheDocument();
    expect(screen.getByText(/unvollständig/i)).toBeInTheDocument();
    /* Das abgewiesene Ziel darf nirgends auf der Seite auftauchen —
       auch nicht als "wir konnten X nicht öffnen". */
    expect(document.body.textContent).not.toContain('evil.example');
  });

  it('zeigt ohne Parameter keinen Knopf', () => {
    seite('');
    expect(screen.queryByTestId('bestaetigen-knopf')).not.toBeInTheDocument();
    expect(screen.getByText(/unvollständig/i)).toBeInTheDocument();
  });
});
