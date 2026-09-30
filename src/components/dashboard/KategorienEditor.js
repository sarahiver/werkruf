/**
 * Kategorien.
 *
 * Haupt- und Zusatzkategorien, dynamisch über categories.list gesucht.
 * Keine fest einprogrammierten Listen: Google ändert das Angebot
 * laufend, und die Anzeigenamen hängen an Sprache und Region.
 *
 * Gespeichert wird die stabile ID (`gcid:…`), nicht der Anzeigename.
 *
 * Drei Dinge, die diesen Editor von einem einfachen Auswahlfeld
 * unterscheiden:
 *
 *   1. Google nimmt `categories` nur als GANZES. Ein Wechsel der
 *      Hauptkategorie darf die Zusatzkategorien nicht mitnehmen —
 *      deshalb wird immer beides gesendet.
 *
 *   2. Eine andere Hauptkategorie ändert, welche Attribute, Leistungen
 *      und weiteren Zeiten Google überhaupt anbietet. Der Kunde
 *      erfährt das vorher, nicht hinterher.
 *
 *   3. Was unter der neuen Kategorie wegfällt, wird benannt — nicht
 *      stillschweigend gelöscht.
 */
import React from 'react';
import styled from 'styled-components';
import { Search, X, Plus, Send, AlertTriangle, Lock, Info } from 'lucide-react';

import { istBearbeitbar } from '../../utils/gbpFieldModel';
import {
  useKategorieSuche, useKategorieMetadaten,
  kategorienGeaendert, baueKategorien,
} from '../../hooks/useGoogleCategories';
import { GhostBtn, Spinner } from './gb/GbUi';

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const Block = styled.section`
  & + & { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--color-border); }
  > h4 { font-family: var(--font-display); font-size: .95rem;
         color: var(--color-primary); margin: 0 0 3px; }
  > p  { font-family: var(--font-body); font-size: .79rem; line-height: 1.55;
         color: var(--color-text-muted); margin: 0 0 12px; }
`;

const Suchfeld = styled.div`
  position: relative;
  input {
    font-family: var(--font-body); font-size: .85rem;
    width: 100%; box-sizing: border-box;
    border: 1px solid var(--color-border); border-radius: 6px;
    padding: 9px 12px 9px 34px; background: #fff;
    &:disabled { background: #F4F5F7; cursor: not-allowed; }
  }
  svg { position: absolute; left: 11px; top: 11px; color: var(--color-text-muted); }
`;

const Trefferliste = styled.ul`
  list-style: none; margin: 6px 0 0; padding: 0;
  max-height: 240px; overflow-y: auto;
  border: 1px solid var(--color-border); border-radius: 6px;
`;

const Treffer = styled.li`
  font-family: var(--font-body); font-size: .84rem;
  padding: 8px 12px; cursor: pointer;
  border-top: 1px solid var(--color-border);
  &:first-child { border-top: 0; }
  &:hover { background: #F4F5F7; }
  small { display: block; font-size: .7rem; color: var(--color-text-muted); margin-top: 2px; }
`;

const Gewaehlt = styled.div`
  display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--font-body); font-size: .85rem; font-weight: 600;
  background: #EEF3F8; color: var(--color-primary);
  border-radius: 6px; padding: 7px 11px; margin: 0 6px 6px 0;
  button { background: none; border: 0; cursor: pointer; padding: 0;
           color: var(--color-text-muted); display: flex;
           &:hover { color: #D93025; } }
`;

const Hinweis = styled.div`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.55;
  border-radius: 6px; padding: 11px 14px; margin: 12px 0 0;
  border-left: 3px solid ${(p) => (p.$art === 'warnung' ? '#D48A00'
    : p.$art === 'ok' ? '#1E7E34' : p.$art === 'fehler' ? '#D93025' : '#8A9199')};
  background: ${(p) => (p.$art === 'warnung' ? '#FFF8E8'
    : p.$art === 'ok' ? '#E8F5E9' : p.$art === 'fehler' ? '#FDECEA' : '#F4F5F7')};
  color: ${(p) => (p.$art === 'warnung' ? '#7A5200'
    : p.$art === 'ok' ? '#1B5E20' : p.$art === 'fehler' ? '#8B1A12' : '#5F6875')};
  display: flex; gap: 9px; align-items: flex-start;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

const AktionsLeiste = styled.div`
  position: sticky; bottom: 0; z-index: 5;
  margin: 22px -4px -4px; padding: 12px 4px;
  background: linear-gradient(to top, var(--color-bg, #fff) 72%, transparent);
  border-top: 1px solid var(--color-border);
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
`;

const Stand = styled.span`
  font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted);
`;

/* ─────────────────────────────────────────────
   KATEGORIEAUSWAHL
───────────────────────────────────────────── */

function Kategoriewahl({ locationId, gesperrt, beschriftung, onWahl }) {
  const suche = useKategorieSuche(locationId);

  return (
    <div>
      <Suchfeld>
        <Search size={15} />
        <input
          type="text" aria-label={beschriftung}
          value={suche.begriff} disabled={gesperrt}
          onChange={(e) => suche.setBegriff(e.target.value)}
          placeholder="Kategorie suchen, z. B. Klempner…"
        />
      </Suchfeld>

      {suche.zuKurz && <Stand>Mindestens zwei Zeichen eingeben.</Stand>}
      {suche.laeuft && <Stand>Wird gesucht…</Stand>}

      {suche.fehler && (
        <Hinweis $art="fehler" role="alert">
          <AlertTriangle size={14} /> {suche.fehler}
        </Hinweis>
      )}

      {!suche.laeuft && !suche.fehler && suche.begriff.trim().length >= 2
        && suche.treffer.length === 0 && (
        <Stand>Keine passende Kategorie gefunden.</Stand>
      )}

      {suche.treffer.length > 0 && (
        <Trefferliste>
          {suche.treffer.map((k) => (
            <Treffer
              key={k.name} role="button"
              onClick={() => { onWahl(k); suche.setBegriff(''); }}
            >
              {k.displayName}
              <small>{k.name}</small>
            </Treffer>
          ))}
          {suche.hatWeitere && (
            <Treffer onClick={suche.mehrLaden} role="button">
              <strong>Weitere anzeigen…</strong>
            </Treffer>
          )}
        </Trefferliste>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   RAHMEN
───────────────────────────────────────────── */

export default function KategorienEditor({ location, onSave }) {
  const vorher = location?.google_profile?.categories ?? {};

  const sperre = istBearbeitbar('categories', location);

  const [haupt, setHaupt] = React.useState(() => vorher.primaryCategory ?? null);
  const [zusatz, setZusatz] = React.useState(() => vorher.additionalCategories ?? []);
  const [zusatzOffen, setZusatzOffen] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [erfolg, setErfolg] = React.useState(null);
  const [fehler, setFehler] = React.useState(null);
  const [bestaetigt, setBestaetigt] = React.useState(false);

  React.useEffect(() => {
    setHaupt(vorher.primaryCategory ?? null);
    setZusatz(vorher.additionalCategories ?? []);
    setBestaetigt(false);
  }, [vorher.primaryCategory, vorher.additionalCategories]);

  /* Metadaten der ALTEN und der NEUEN Hauptkategorie. Der Vergleich
     der beiden zeigt, was unter der neuen Kategorie wegfällt. */
  const altMeta = useKategorieMetadaten(vorher.primaryCategory?.name, location?.id);
  const neuMeta = useKategorieMetadaten(haupt?.name, location?.id);

  const neuesObjekt = baueKategorien({ hauptkategorie: haupt, zusatzkategorien: zusatz });
  const etwasGeaendert = kategorienGeaendert(vorher, neuesObjekt);
  const hauptGewechselt = (vorher.primaryCategory?.name ?? null) !== (haupt?.name ?? null)
    && Boolean(vorher.primaryCategory);

  /*
   * Was fällt unter der neuen Kategorie weg?
   *
   * Nur benennen, was sich belegen lässt: Beide Metadatensätze müssen
   * erfolgreich geladen sein. Bei einem gescheiterten Abruf wird
   * nichts behauptet.
   */
  const entfallend = React.useMemo(() => {
    if (!hauptGewechselt) return null;
    if (!altMeta.moreHoursTypes || !neuMeta.moreHoursTypes) return null;

    const neueIds = new Set(neuMeta.moreHoursTypes.map((t) => t.hoursTypeId));
    const gesetzt = (location?.google_profile?.moreHours ?? []).map((m) => m.hoursTypeKey);
    const verliert = gesetzt.filter((k) => !neueIds.has(k));

    const neueLeistungen = new Set((neuMeta.serviceTypes ?? []).map((t) => t.serviceTypeId));
    const gesetzteLeistungen = (location?.google_profile?.serviceItems ?? [])
      .map((s) => s?.structuredServiceItem?.serviceTypeId)
      .filter(Boolean);
    const verliertLeistungen = gesetzteLeistungen.filter((id) => !neueLeistungen.has(id));

    return { zeiten: verliert, leistungen: verliertLeistungen };
  }, [hauptGewechselt, altMeta.moreHoursTypes, neuMeta.moreHoursTypes,
      neuMeta.serviceTypes, location]);

  const verliertEtwas = Boolean(
    entfallend && (entfallend.zeiten.length > 0 || entfallend.leistungen.length > 0));

  /* Ein Wechsel der Hauptkategorie braucht eine Bestätigung. Ein
     Wechsel, der belegbar Daten kostet, erst recht. */
  const brauchtBestaetigung = hauptGewechselt;
  const darfSpeichern = etwasGeaendert && (!brauchtBestaetigung || bestaetigt);

  const speichern = async () => {
    setBusy(true); setErfolg(null); setFehler(null);
    try {
      const antwort = await onSave(location.id, { categories: neuesObjekt });
      if (antwort?.status === 'not_submitted') {
        setFehler('Google hat die Änderung nicht übernommen.');
      } else if (antwort?.confirmed) {
        setErfolg({ status: antwort.status ?? 'submitted_no_pending' });
        setBestaetigt(false);
      } else {
        setFehler('Google hat die Änderung nicht bestätigt. Bitte versuche es erneut.');
      }
    } catch (error) {
      setFehler(error.message || 'Die Kategorien konnten nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Block>
        <h4>Hauptkategorie</h4>
        <p>
          Wie Google dein Unternehmen einordnet. Sie bestimmt, wonach Kunden dich
          finden — und welche weiteren Angaben Google überhaupt anbietet.
        </p>

        {!sperre.erlaubt && (
          <Hinweis><Lock size={14} /> {sperre.grund}</Hinweis>
        )}

        {haupt ? (
          <Gewaehlt>
            {haupt.displayName ?? haupt.name}
            <button onClick={() => setHaupt(null)} disabled={!sperre.erlaubt}
              aria-label="Hauptkategorie entfernen"><X size={13} /></button>
          </Gewaehlt>
        ) : (
          <Stand>Keine Hauptkategorie gesetzt.</Stand>
        )}

        <Kategoriewahl
          locationId={location?.id} gesperrt={!sperre.erlaubt}
          beschriftung="Hauptkategorie suchen"
          onWahl={(k) => { setHaupt(k); setBestaetigt(false); }}
        />

        {hauptGewechselt && (
          <Hinweis $art="warnung" role="status">
            <AlertTriangle size={14} />
            <span>
              <strong>Durch eine andere Hauptkategorie können sich verfügbare
              Leistungen, Attribute und weitere Öffnungszeiten ändern.</strong>
              {neuMeta.laeuft && <><br />Google-Angaben zur neuen Kategorie werden geladen…</>}
              {verliertEtwas && (
                <>
                  <br /><br />
                  Unter „{haupt?.displayName ?? haupt?.name}" bietet Google Folgendes
                  nicht mehr an:
                  {entfallend.zeiten.length > 0 && (
                    <><br />· Weitere Zeiten: {entfallend.zeiten.join(', ')}</>
                  )}
                  {entfallend.leistungen.length > 0 && (
                    <><br />· {entfallend.leistungen.length} hinterlegte Leistung(en)</>
                  )}
                  <br />Diese Angaben gehen beim Speichern verloren.
                </>
              )}
              {hauptGewechselt && (altMeta.abrufGescheitert || neuMeta.abrufGescheitert) && (
                <><br /><br />Was sich konkret ändert, konnte gerade nicht bei Google
                abgefragt werden.</>
              )}
              <br /><br />
              <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={bestaetigt}
                  onChange={(e) => setBestaetigt(e.target.checked)}
                  aria-label="Kategoriewechsel bestätigen"
                />
                <span>Ich möchte die Hauptkategorie ändern.</span>
              </label>
            </span>
          </Hinweis>
        )}
      </Block>

      <Block>
        <h4>Zusätzliche Kategorien</h4>
        <p>
          Weitere Bereiche, in denen dein Betrieb tätig ist. Sie ergänzen die
          Hauptkategorie, ersetzen sie aber nicht.
        </p>

        {zusatz.length === 0 && <Stand>Keine zusätzlichen Kategorien.</Stand>}

        <div>
          {zusatz.map((k) => (
            <Gewaehlt key={k.name}>
              {k.displayName ?? k.name}
              <button
                onClick={() => setZusatz(zusatz.filter((z) => z.name !== k.name))}
                disabled={!sperre.erlaubt}
                aria-label={`${k.displayName ?? k.name} entfernen`}
              ><X size={13} /></button>
            </Gewaehlt>
          ))}
        </div>

        {zusatzOffen ? (
          <Kategoriewahl
            locationId={location?.id} gesperrt={!sperre.erlaubt}
            beschriftung="Zusätzliche Kategorie suchen"
            onWahl={(k) => {
              if (!zusatz.some((z) => z.name === k.name) && k.name !== haupt?.name) {
                setZusatz([...zusatz, k]);
              }
              setZusatzOffen(false);
            }}
          />
        ) : (
          <GhostBtn onClick={() => setZusatzOffen(true)} disabled={!sperre.erlaubt}>
            <Plus size={13} /> Kategorie hinzufügen
          </GhostBtn>
        )}
      </Block>

      <AktionsLeiste>
        <GhostBtn onClick={speichern} disabled={busy || !darfSpeichern || !sperre.erlaubt}>
          {busy ? <Spinner size={14} /> : <Send size={14} />}
          {busy ? 'Wird übermittelt…' : 'Bei Google speichern'}
        </GhostBtn>

        <Stand>
          {!sperre.erlaubt ? sperre.grund
            : !etwasGeaendert ? 'Keine Änderungen.'
              : brauchtBestaetigung && !bestaetigt
                ? 'Bitte den Kategoriewechsel oben bestätigen.'
                : 'Zu übermitteln: Kategorien'}
        </Stand>
      </AktionsLeiste>

      {erfolg && (
        <Hinweis $art="ok">
          <Info size={14} />
          <span>
            <strong>An Google übermittelt.</strong>{' '}
            {erfolg.status === 'submitted_pending'
              ? 'Google prüft die Änderung.'
              : 'Google kann die Veröffentlichung noch überprüfen.'}
          </span>
        </Hinweis>
      )}

      {fehler && (
        <Hinweis $art="fehler" role="alert">
          <AlertTriangle size={14} />
          <span><strong>Nicht gespeichert.</strong> {fehler}</span>
        </Hinweis>
      )}
    </div>
  );
}
