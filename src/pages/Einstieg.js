/**
 * Übergabe nach der Anmeldung über einen Mail-Link.
 *
 * Supabase hat den Besucher hierher zurückgeschickt und dabei eine
 * Sitzung erzeugt. Diese Seite klärt, ob die Sitzung zu dem Link
 * passt, aus dem sie entstanden ist — und navigiert erst dann weiter.
 *
 * Der Fall, um den es geht:
 *
 *   Der Mail-Link gehört Nutzer A.
 *   Im Browser ist Nutzer B angemeldet.
 *
 * Ohne diese Prüfung bekäme B den Betrieb, die Empfehlung und das Ziel
 * von A zu sehen. Die Sitzung allein genügt nicht — sie muss die
 * richtige sein.
 *
 * Die Prüfung läuft serverseitig. Der Browser schickt nur den
 * Übergabezustand mit; wer er ist, sagt sein Sitzungstoken.
 */
import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { AlertTriangle, Check } from 'lucide-react';

import supabase from '../supabaseClient';

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const Seite = styled.main`
  min-height: 70vh; display: flex; align-items: center; justify-content: center;
  padding: 40px 20px;
`;

const Karte = styled.div`
  max-width: 460px; text-align: center;
  background: #fff; border: 1px solid var(--color-border);
  border-radius: 12px; padding: 36px 32px;
`;

const Titel = styled.h1`
  font-family: var(--font-display); font-size: 1.22rem;
  color: var(--color-primary); margin: 0 0 10px;
  display: flex; align-items: center; justify-content: center; gap: 9px;
`;

const Text = styled.p`
  font-family: var(--font-body); font-size: .92rem; line-height: 1.65;
  color: var(--color-text-muted); margin: 0 0 22px;
`;

const Knopf = styled.button`
  font-family: var(--font-body); font-size: .92rem; font-weight: 600;
  background: var(--color-primary); color: #fff; border: 0;
  border-radius: 7px; padding: 12px 22px; cursor: pointer;
  &:hover { opacity: .9; }
`;

const Punkte = styled.div`
  width: 34px; height: 34px; margin: 0 auto 18px;
  border: 3px solid #EEF1F4; border-top-color: var(--color-accent);
  border-radius: 50%; animation: dreh .8s linear infinite;
  @keyframes dreh { to { transform: rotate(360deg); } }
`;

/* ─────────────────────────────────────────────
   ABLAUF
───────────────────────────────────────────── */

const FUNCTIONS_BASE = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1`;

export default function Einstieg() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [zustand, setZustand] = React.useState('laedt');

  /* Nur einmal ausführen. Der Übergabezustand gilt einmalig; ein
     zweiter Versuch durch eine Neuzeichnung würde ihn verbrauchen und
     dann scheitern. */
  const gelaufen = React.useRef(false);

  React.useEffect(() => {
    if (gelaufen.current) return;
    gelaufen.current = true;

    const state = params.get('s');
    if (!state) { setZustand('ungueltig'); return; }

    (async () => {
      try {
        /*
         * Auf die Sitzung warten.
         *
         * Supabase verarbeitet den Anmeldelink asynchron; unmittelbar
         * nach dem Laden gibt es sie oft noch nicht. Ohne das Warten
         * käme die Anfrage ohne Sitzungstoken an und würde als
         * "nicht angemeldet" abgewiesen.
         */
        let sitzung = null;
        for (let i = 0; i < 20 && !sitzung; i++) {
          const { data } = await supabase.auth.getSession();
          sitzung = data?.session ?? null;
          if (!sitzung) await new Promise((r) => setTimeout(r, 250));
        }

        if (!sitzung) { setZustand('ungueltig'); return; }

        const antwort = await fetch(`${FUNCTIONS_BASE}/google-business/einstieg`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            /* Wer der Besucher ist, sagt dieses Token — nicht die
               Adresse. */
            Authorization: `Bearer ${sitzung.access_token}`,
          },
          body: JSON.stringify({ state }),
        });

        const ergebnis = await antwort.json();

        if (!ergebnis?.ok) {
          setZustand(ergebnis?.reason === 'user_mismatch' ? 'falschesKonto' : 'ungueltig');
          return;
        }

        /*
         * Weiter zum Ziel — mit replace.
         *
         * Der Übergabezustand steht in der Adresse. Ohne replace bliebe
         * er im Verlauf, und ein Zurück-Klick landete wieder hier, auf
         * einem inzwischen verbrauchten Zustand.
         */
        navigate(ergebnis.done ? '/dashboard' : (ergebnis.targetPath || '/dashboard'),
                 { replace: true });
      } catch {
        setZustand('ungueltig');
      }
    })();
  }, [params, navigate]);

  if (zustand === 'laedt') {
    return (
      <Seite>
        <Karte aria-busy="true">
          <Punkte />
          <Text>Einen Moment — WERKRUF bereitet deine Aufgabe vor.</Text>
        </Karte>
      </Seite>
    );
  }

  if (zustand === 'falschesKonto') {
    return (
      <Seite>
        <Karte role="alert">
          <Titel><AlertTriangle size={20} /> Anderes Konto</Titel>
          <Text>
            Dieser Link gehört zu einem anderen WERKRUF-Konto. Melde dich mit
            dem Konto an, an das die E-Mail ging.
          </Text>
          <Knopf type="button" onClick={() => navigate('/login', { replace: true })}>
            Zur Anmeldung
          </Knopf>
        </Karte>
      </Seite>
    );
  }

  return (
    <Seite>
      <Karte>
        <Titel><Check size={20} /> Link nicht mehr gültig</Titel>
        <Text>
          Melde dich im Dashboard an — deine Aufgaben liegen dort bereit.
        </Text>
        <Knopf type="button" onClick={() => navigate('/dashboard', { replace: true })}>
          Zum Dashboard
        </Knopf>
      </Karte>
    </Seite>
  );
}
