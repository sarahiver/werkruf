import React from 'react';
import styled from 'styled-components';
import { AlertTriangle, Loader, CreditCard, ExternalLink, Trash2 } from 'lucide-react';
import supabase from '../../supabaseClient';

/* ─────────────────────────────────────────────────────────────────
   Abo kündigen vs. Konto löschen — zwei Wege, klar getrennt (WP1)

   ═════════════════════════════════════════════════════════════
   WARUM ZWEI KARTEN
   ═════════════════════════════════════════════════════════════

   Bis zum 22.10.2026 gab es unter "Konto löschen" zwei native
   window.confirm-Fenster. Sie sagten "Abo wird sofort gekündigt",
   aber nicht "ohne Erstattung", und sie nannten die Alternative
   nicht: Wer nur nicht mehr zahlen will, kündigt das Abo und behält
   Konto, Daten und den bezahlten Restzeitraum.

   Jetzt steht die Alternative VOR dem Löschen, und der Löschdialog
   sagt alles, was passiert — bevor jemand bestätigt.

   ═════════════════════════════════════════════════════════════
   WAS DIE OBERFLAECHE NICHT ENTSCHEIDET
   ═════════════════════════════════════════════════════════════

   Ob gelöscht wird, entscheidet delete-account. Diese Komponente
   leitet nur dann auf die Startseite, wenn die Function
   deleted: true geantwortet hat. Jede andere Antwort — Stripe-
   Fehler, Datenbankfehler, Netz — lässt den Nutzer mit der
   Meldung des Servers stehen. Ein Nutzer, dessen Konto noch
   existiert, darf nicht "gelöscht" zu sehen bekommen.
───────────────────────────────────────────────────────────────── */

export const BESTAETIGUNGSWORT = 'LÖSCHEN';

/** Was beim Löschen passiert — als Liste, damit Dialog und Test
    dieselbe Quelle haben. Reine Funktion. */
export function loeschFolgen({ aboAktiv, foundingPartner }) {
  const folgen = [
    'Dein Konto und alle Daten bei WERKRUF werden sofort und endgültig gelöscht.',
    'Die Kopien deiner Fotos bei WERKRUF werden gelöscht.',
    'Die Berechtigung für dein Google-Konto wird zurückgegeben.',
    'Dein Google-Unternehmensprofil bleibt unverändert — es gehört dir, nicht uns.',
  ];
  if (aboAktiv && !foundingPartner) {
    folgen.splice(1, 0,
      'Dein laufendes Abo endet sofort. Der bereits bezahlte Restzeitraum wird nicht erstattet.');
  }
  folgen.push('Du bekommst eine Bestätigung per E-Mail. Danach schreiben wir dir nicht mehr.');
  return folgen;
}

const Karte = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card, 12px); padding: 22px 24px; margin-bottom: 16px;
`;
const Titel = styled.h3`
  font-family: var(--font-display); font-size: 1.05rem; color: var(--color-primary); margin: 0 0 4px;
`;
const Text = styled.p`
  font-family: var(--font-body); font-size: .86rem; line-height: 1.6;
  color: var(--color-text-muted); margin: 0 0 12px;
`;
const Knopf = styled.button`
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 16px; cursor: pointer;
  font-family: var(--font-body); font-weight: 700; font-size: .84rem;
  border-radius: var(--radius-button); border: 1px solid var(--color-border);
  background: var(--color-white); color: var(--color-primary);
  &:disabled { opacity: .55; cursor: default; }
  ${({ $gefahr }) => $gefahr && 'border-color:#D93025; color:#B42318;'}
  ${({ $gefahrVoll }) => $gefahrVoll && 'border-color:#D93025; background:#D93025; color:#fff;'}
`;
const Dialog = styled.div`
  margin-top: 14px; padding: 16px 18px;
  border: 1px solid #FFCDD2; border-left: 4px solid #D93025; border-radius: 10px;
  background: #FFF5F5;
`;
const Liste = styled.ul`
  font-family: var(--font-body); font-size: .86rem; line-height: 1.55;
  color: var(--color-text); margin: 8px 0 14px 18px; padding: 0;
  li { margin: 3px 0; }
`;
const Eingabe = styled.input`
  font-family: var(--font-body); font-size: .9rem; letter-spacing: .08em;
  padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-button);
  width: 180px; margin-right: 10px;
`;
const Fehler = styled.p`
  font-family: var(--font-body); font-size: .84rem; line-height: 1.55;
  color: #B3261E; background: #FDECEC; border-radius: 8px; padding: 10px 12px; margin: 12px 0 0;
`;

/* ── Karte 1: die Alternative ──
   Nur, wenn es ein laufendes, nicht schon gekündigtes Abo gibt. Bei
   Founding Partnern und Free gibt es nichts zu kündigen. */
export function AboKuendigenHinweis({ sichtbar, periodeEndet, onPortal, laeuft }) {
  if (!sichtbar) return null;
  return (
    <Karte data-testid="abo-kuendigen">
      <Titel>Nicht mehr zahlen, aber Daten behalten?</Titel>
      <Text>
        <strong>Abo kündigen.</strong> Du kannst WERKRUF bis zum Ende des bezahlten
        Zeitraums{periodeEndet ? ` (${periodeEndet})` : ''} weiter nutzen. Danach wird dein
        Zugang zum kostenlosen Plan: Übersicht, Score und dein Google-Profil bleiben;
        Bewertungen mit Antwortvorschlägen, Fotos, Bewertungslink und die Mails enden.
        Dein Konto und deine Daten bleiben erhalten — und Pro ist jederzeit wieder ein Klick.
      </Text>
      <Knopf type="button" onClick={onPortal} disabled={laeuft}>
        {laeuft
          ? <><Loader size={14} className="spin" /> Wird geöffnet…</>
          : <><CreditCard size={14} /> Abo kündigen <ExternalLink size={12} /></>}
      </Knopf>
      <Text style={{ fontSize: '.72rem', margin: '6px 0 0' }}>Öffnet das sichere Stripe-Portal.</Text>
    </Karte>
  );
}

/* ── Karte 2: Konto löschen ── */
export default function KontoLoeschen({ aboAktiv, foundingPartner, email }) {
  const [offen, setOffen]       = React.useState(false);
  const [wort, setWort]         = React.useState('');
  const [laeuft, setLaeuft]     = React.useState(false);
  const [fehler, setFehler]     = React.useState('');

  const folgen = loeschFolgen({ aboAktiv, foundingPartner });
  const bestaetigt = wort.trim() === BESTAETIGUNGSWORT;

  const loeschen = async () => {
    if (!bestaetigt || laeuft) return;
    setLaeuft(true);
    setFehler('');
    try {
      const { data, error } = await supabase.functions.invoke('delete-account');
      /* invoke() liefert bei Nicht-2xx error UND oft data mit der
         Servermeldung. Die Servermeldung ist die bessere. */
      const serverText = data?.error;
      if (error || !data?.deleted) {
        setFehler(serverText || error?.message || 'Das Konto konnte nicht gelöscht werden. Es wurde nichts verändert.');
        setLaeuft(false);
        return;
      }
      window.location.href = '/';
    } catch (e) {
      setFehler(e?.message || 'Das Konto konnte nicht gelöscht werden.');
      setLaeuft(false);
    }
  };

  return (
    <Karte data-testid="konto-loeschen" style={{ borderColor: '#FFCDD2' }}>
      <Titel style={{ color: '#D93025' }}>Konto löschen</Titel>
      <Text>
        Sofort und endgültig. Wenn du nur nicht mehr zahlen willst, kündige stattdessen
        das Abo — dann bleiben Konto und Daten erhalten.
      </Text>

      {!offen ? (
        <Knopf type="button" $gefahr onClick={() => setOffen(true)}>
          <Trash2 size={14} /> Konto löschen …
        </Knopf>
      ) : (
        <Dialog role="dialog" aria-labelledby="loeschen-titel">
          <p id="loeschen-titel" style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '.9rem', margin: 0, display: 'flex', gap: 8, alignItems: 'center', color: '#B42318' }}>
            <AlertTriangle size={16} /> Das passiert, wenn du bestätigst:
          </p>
          <Liste>
            {folgen.map((f) => <li key={f}>{f}</li>)}
          </Liste>
          <label htmlFor="loeschen-wort" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '.8rem', marginBottom: 6 }}>
            Zum Bestätigen <strong>{BESTAETIGUNGSWORT}</strong> eintippen{email ? ` (Konto ${email})` : ''}:
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Eingabe
              id="loeschen-wort"
              value={wort}
              onChange={(e) => setWort(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={laeuft}
            />
            <Knopf type="button" $gefahrVoll disabled={!bestaetigt || laeuft} onClick={loeschen}>
              {laeuft ? <><Loader size={14} className="spin" /> Wird gelöscht…</> : 'Endgültig löschen'}
            </Knopf>
            <Knopf type="button" disabled={laeuft} onClick={() => { setOffen(false); setWort(''); setFehler(''); }}>
              Abbrechen
            </Knopf>
          </div>
          {fehler && <Fehler role="alert">{fehler}</Fehler>}
        </Dialog>
      )}
    </Karte>
  );
}
