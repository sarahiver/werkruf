import React, { useState } from 'react';
import styled from 'styled-components';
import { CalendarDays, Lock } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import { hasPaidAccess } from '../../utils/subscription';
import { alsText, alsZeit, pruefeSonderzeiten } from '../../utils/gbpHours';
import {
  ausIso, feiertagAm, bundeslandAusAdresse, hatSonderzeitFuer, wochentag, LAENDER,
} from '../../utils/feiertage';

/*
 * WP9 — Feiertags-Dialog auf /dashboard/google (?holiday=YYYY-MM-DD).
 *
 * Eine Frage, drei Antworten:
 *
 *   Geschlossen
 *   Reguläre Öffnungszeiten übernehmen   (der Server nimmt die Zeiten
 *                                         des Wochentags; ohne Zeiten →
 *                                         geschlossen)
 *   Andere Öffnungszeiten                (Zeitfenster, Vorpruefung mit
 *                                         gbpHours wie im Editor)
 *
 * Kein eigener Schreibweg: der Server (location/holiday-hours) prueft
 * Feiertag, Bundesland, Fenster und schreibt ueber denselben Weg wie
 * der Editor. Free sieht den Dialog, kann aber nicht schreiben.
 */

const Kasten = styled.section`
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-accent);
  border-radius: var(--radius-card);
  padding: 18px 20px; margin-bottom: 20px;
`;
const Kopf = styled.div`
  display: flex; align-items: center; gap: 10px; margin-bottom: 4px;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; color: var(--color-primary); text-transform: var(--text-transform);
  svg { color: var(--color-accent); }
`;
const Datum = styled.div`
  font-family: var(--font-body); font-size: .9rem; color: var(--color-text-muted); margin-bottom: 12px;
`;
const Frage = styled.p`
  margin: 0 0 10px; font-family: var(--font-body); font-weight: 700; font-size: .92rem; color: var(--color-text);
`;
const Optionen = styled.div` display: grid; gap: 8px; `;
const Option = styled.label`
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer;
  font-family: var(--font-body); font-size: .88rem; color: var(--color-text);
  &[data-aktiv="ja"] { border-color: var(--color-accent); background: #FFF7ED; }
`;
const Fenster = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0 0 30px;
  font-family: var(--font-body); font-size: .85rem;
`;
const Zeit = styled.input`
  width: 86px; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 6px;
  font-family: var(--font-body); font-size: .85rem;
  &[data-fehler="ja"] { border-color: #B3261E; }
`;
const Klein = styled.button`
  background: none; border: none; color: var(--color-accent); cursor: pointer;
  font-family: var(--font-body); font-size: .8rem; padding: 0;
`;
const Zeile = styled.div` display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; `;
const Knopf = styled.button`
  padding: 9px 16px; border-radius: var(--radius-button); cursor: pointer;
  background: var(--color-primary); color: white; border: 1px solid var(--color-primary);
  font-family: var(--font-body); font-size: .85rem; font-weight: 600;
  &:disabled { opacity: .55; cursor: not-allowed; }
`;
const Hinweis = styled.p` margin: 6px 0 0; font-family: var(--font-body); font-size: .8rem; color: var(--color-text-muted); `;
const Fehler = styled.p` margin: 6px 0 0; font-family: var(--font-body); font-size: .8rem; color: #B3261E; `;
const Erfolg = styled.p` margin: 6px 0 0; font-family: var(--font-body); font-size: .85rem; color: #1B7F3B; `;

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const TAG_LANG = { MONDAY: 'Montag', TUESDAY: 'Dienstag', WEDNESDAY: 'Mittwoch', THURSDAY: 'Donnerstag', FRIDAY: 'Freitag', SATURDAY: 'Samstag', SUNDAY: 'Sonntag' };

export default function FeiertagDialog({ location, iso, onSave, onDone }) {
  const { profile } = useAuthContext();
  const istPro = hasPaidAccess(profile);
  const [modus, setModus] = useState('geschlossen');
  const [fenster, setFenster] = useState([{ openTime: alsZeit('09:00'), closeTime: alsZeit('13:00') }]);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [erfolg, setErfolg] = useState(null);

  const datum = ausIso(iso);
  if (!datum || !location) return null;
  const adresse = location.google_profile?.storefrontAddress ?? null;
  const land = bundeslandAusAdresse(adresse);
  const feiertag = feiertagAm(iso, land.code);
  if (!feiertag) {
    return (
      <Kasten data-testid="feiertag-dialog" data-status="kein-feiertag">
        <Kopf><CalendarDays size={18} /> {iso}</Kopf>
        <Hinweis>
          {land.code
            ? `Der ${datum.day}. ${MONATE[datum.month - 1]} ist in ${LAENDER[land.code]} kein gesetzlicher Feiertag. Sonderzeiten für andere Tage legst du unten im Öffnungszeiten-Editor an.`
            : `Für diesen Standort ist das Bundesland nicht bekannt — nur bundesweite Feiertage werden erkannt. Sonderzeiten legst du unten im Öffnungszeiten-Editor an.`}
        </Hinweis>
      </Kasten>
    );
  }

  const bisherige = location.google_profile?.specialHours?.specialHourPeriods ?? [];
  const schonGesetzt = hatSonderzeitFuer(bisherige, iso);
  const regel = (location.google_profile?.regularHours?.periods ?? []).filter((p) => p?.openDay === wochentag(datum));
  const regelText = regel.length
    ? regel.map((p) => `${alsText(p.openTime)}–${alsText(p.closeTime)}`).join(', ')
    : 'regulär geschlossen';

  /* Vorpruefung wie im Editor — dieselbe Funktion, dieselben Meldungen. */
  const befund = modus === 'andere'
    ? pruefeSonderzeiten(fenster.map((f) => ({ startDate: datum, openTime: f.openTime, closeTime: f.closeTime })))
    : [];
  const fehlerhaft = new Set(befund.map((b) => b.index));

  const speichern = async () => {
    setBusy(true); setFehler(null); setErfolg(null);
    try {
      await onSave({ locationId: location.id, date: iso, mode: modus, hours: modus === 'andere' ? fenster : undefined });
      setErfolg(modus === 'geschlossen'
        ? `Für ${feiertag.name} ist jetzt „geschlossen" hinterlegt.`
        : `Sonderöffnungszeit für ${feiertag.name} hinterlegt.`);
      onDone?.();
    } catch (e) {
      setFehler(e.message || 'Google konnte die Sonderzeit nicht übernehmen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Kasten data-testid="feiertag-dialog" data-status={schonGesetzt ? 'gesetzt' : 'offen'} aria-label="Feiertag">
      <Kopf><CalendarDays size={18} /> {feiertag.name}</Kopf>
      <Datum data-testid="feiertag-datum">
        {TAG_LANG[wochentag(datum)]}, {datum.day}. {MONATE[datum.month - 1]} {datum.year}
        {land.code ? ` · ${LAENDER[land.code]}` : ' · bundesweit'}
      </Datum>
      {schonGesetzt && !erfolg && (
        <Hinweis data-testid="feiertag-gesetzt">Für diesen Tag ist bei Google bereits eine Sonderöffnungszeit hinterlegt. Du kannst sie hier ersetzen oder unten im Editor anpassen.</Hinweis>
      )}
      <Frage>Wie habt ihr an diesem Tag geöffnet?</Frage>
      <Optionen role="radiogroup">
        <Option data-aktiv={modus === 'geschlossen' ? 'ja' : 'nein'}>
          <input type="radio" name="feiertag-modus" value="geschlossen" checked={modus === 'geschlossen'} onChange={() => setModus('geschlossen')} disabled={!istPro} />
          Geschlossen
        </Option>
        <Option data-aktiv={modus === 'regulaer' ? 'ja' : 'nein'}>
          <input type="radio" name="feiertag-modus" value="regulaer" checked={modus === 'regulaer'} onChange={() => setModus('regulaer')} disabled={!istPro} />
          Reguläre Öffnungszeiten übernehmen <span style={{ color: 'var(--color-text-muted)' }}>({regelText})</span>
        </Option>
        <Option data-aktiv={modus === 'andere' ? 'ja' : 'nein'}>
          <input type="radio" name="feiertag-modus" value="andere" checked={modus === 'andere'} onChange={() => setModus('andere')} disabled={!istPro} />
          Andere Öffnungszeiten
        </Option>
      </Optionen>
      {modus === 'andere' && fenster.map((f, i) => (
        <Fenster key={i}>
          <Zeit aria-label={`Öffnung ${i + 1}`} value={alsText(f.openTime)} data-fehler={fehlerhaft.has(i) ? 'ja' : 'nein'}
            onChange={(e) => setFenster(fenster.map((x, j) => (j === i ? { ...x, openTime: alsZeit(e.target.value) ?? x.openTime } : x)))} placeholder="09:00" />
          <span>–</span>
          <Zeit aria-label={`Schließung ${i + 1}`} value={alsText(f.closeTime)} data-fehler={fehlerhaft.has(i) ? 'ja' : 'nein'}
            onChange={(e) => setFenster(fenster.map((x, j) => (j === i ? { ...x, closeTime: alsZeit(e.target.value) ?? x.closeTime } : x)))} placeholder="13:00" />
          {fenster.length > 1 && <Klein type="button" onClick={() => setFenster(fenster.filter((_, j) => j !== i))}>entfernen</Klein>}
          {i === fenster.length - 1 && <Klein type="button" onClick={() => setFenster([...fenster, { openTime: alsZeit('14:00'), closeTime: alsZeit('18:00') }])}>+ Zeitfenster</Klein>}
        </Fenster>
      ))}
      {modus === 'andere' && befund[0] && <Fehler role="alert">{befund[0].meldung}</Fehler>}
      <Zeile>
        {istPro ? (
          <Knopf type="button" onClick={speichern} disabled={busy || (modus === 'andere' && befund.length > 0)}>
            {busy ? 'Wird an Google gesendet…' : 'Öffnungszeiten festlegen'}
          </Knopf>
        ) : (
          <Hinweis data-testid="feiertag-free"><Lock size={12} style={{ verticalAlign: '-1px' }} /> Sonderöffnungszeiten festlegen gehört zu WERKRUF Pro.</Hinweis>
        )}
      </Zeile>
      {fehler && <Fehler role="alert">{fehler}</Fehler>}
      {erfolg && <Erfolg role="status">{erfolg} Google prüft die Änderung; sie erscheint in der Regel innerhalb weniger Minuten.</Erfolg>}
    </Kasten>
  );
}
