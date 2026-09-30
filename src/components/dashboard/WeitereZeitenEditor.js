/**
 * Weitere Öffnungszeiten (`moreHours`).
 *
 * Welche Arten es gibt, bestimmt allein Google — je Hauptkategorie,
 * über `categories.batchGet?view=FULL`. Keine fest einprogrammierte
 * Liste: Bei einem Klempner sind andere Arten möglich als bei einem
 * Restaurant, und Google ändert das ohne API-Änderung.
 *
 * Drei Zustände, die unterschieden werden müssen:
 *
 *   Typen vorhanden      Auswahl anzeigen.
 *   Google kennt keine   „Für diese Unternehmenskategorie bietet
 *                        Google keine weiteren Öffnungszeiten an."
 *   Abruf gescheitert    NICHT als „keine Optionen" darstellen — das
 *                        wäre eine Falschaussage über Google.
 *
 * Die Zeitvalidierung ist dieselbe wie bei den regulären
 * Öffnungszeiten: `pruefeRegulaer` aus Paket B, samt Behandlung über
 * Mitternacht und Überschneidungen über die Wochenkante.
 */
import React from 'react';
import styled from 'styled-components';
import { Plus, X, Send, Lock, AlertTriangle, Info } from 'lucide-react';

import { istBearbeitbar } from '../../utils/gbpFieldModel';
import { useKategorieMetadaten } from '../../hooks/useGoogleCategories';
import {
  TAGE, alsText, alsZeit, istDurchgehend, ueberMitternacht,
  pruefeWeitereZeiten, weitereZeitenGeaendert,
} from '../../utils/gbpHours';
import { GhostBtn, Spinner } from './gb/GbUi';

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const ArtBlock = styled.section`
  border: 1px solid var(--color-border); border-radius: 8px;
  padding: 14px 16px; margin: 0 0 12px;
  background: ${(p) => (p.$aktiv ? '#fff' : '#FAFBFC')};
`;

const ArtKopf = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: ${(p) => (p.$aktiv ? '12px' : '0')};
  label { font-family: var(--font-body); font-size: .88rem; font-weight: 600;
          color: var(--color-primary); display: flex; align-items: center;
          gap: 8px; cursor: pointer; }
  small { display: block; font-weight: 400; font-size: .72rem;
          color: var(--color-text-muted); margin-top: 2px; }
`;

const TagZeile = styled.div`
  display: grid; grid-template-columns: 52px 1fr; gap: 10px;
  align-items: start; padding: 7px 0;
  border-top: 1px solid var(--color-border);
  &:first-of-type { border-top: 0; }
`;

const TagName = styled.div`
  font-family: var(--font-body); font-size: .82rem; font-weight: 600;
  color: var(--color-primary); padding-top: 6px;
`;

const FensterZeile = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin-bottom: 4px;
`;

const Zeitfeld = styled.input`
  font-family: var(--font-body); font-size: .8rem;
  border: 1px solid var(--color-border); border-radius: 5px;
  padding: 5px 8px; width: 84px; background: #fff;
  &:disabled { background: #F4F5F7; color: var(--color-text-muted); cursor: not-allowed; }
  &[data-fehler='ja'] { border-color: #D93025; background: #FDECEA; }
`;

const KleinBtn = styled.button`
  font-family: var(--font-body); font-size: .74rem;
  background: none; border: 1px solid var(--color-border); border-radius: 5px;
  padding: 4px 8px; cursor: pointer; color: var(--color-text-muted);
  display: inline-flex; align-items: center; gap: 4px;
  &:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-primary); }
  &:disabled { opacity: .4; cursor: not-allowed; }
`;

const Marke = styled.span`
  font-family: var(--font-body); font-size: .74rem;
  color: var(--color-text-muted); padding: 5px 2px;
`;

const Fehlertext = styled.p`
  font-family: var(--font-body); font-size: .74rem; line-height: 1.5;
  color: #8B1A12; margin: 2px 0 0; display: flex; gap: 5px; align-items: flex-start;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

const Hinweis = styled.div`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.55;
  border-radius: 6px; padding: 11px 14px; margin: 0 0 14px;
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
  margin: 20px -4px -4px; padding: 12px 4px;
  background: linear-gradient(to top, var(--color-bg, #fff) 72%, transparent);
  border-top: 1px solid var(--color-border);
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
`;

const Stand = styled.span`
  font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted);
`;

/**
 * Anzeigename einer Zeitart.
 *
 * MoreHoursType hat ZWEI Namensfelder: `displayName` ist der
 * englische, `localizedDisplayName` der übersetzte. Eine frühere
 * Fassung las den englischen zuerst — dadurch standen im deutschen
 * Dashboard „Breakfast", „Drive through" und „Senior hours".
 */
function anzeigename(typ) {
  return typ?.localizedDisplayName || typ?.displayName || typ?.hoursTypeId || '—';
}

/**
 * Was eine Zeitart bedeutet — in eigenen Worten.
 *
 * Googles Anzeigenamen sind knapp und für Handwerksbetriebe nicht
 * immer selbsterklärend: „Access" heisst nicht „Zugang zum Laden",
 * sondern wann das Gelände betretbar ist. Diese Erläuterungen stammen
 * von WERKRUF, nicht von Google — deshalb stehen sie getrennt vom
 * Namen und nicht an dessen Stelle.
 *
 * Fehlt eine Erläuterung, wird nur Googles Name gezeigt. Nichts wird
 * erfunden.
 */
const ERLAEUTERUNG = {
  ACCESS: 'Wann das Gelände oder Gebäude zugänglich ist — auch außerhalb der Öffnungszeiten.',
  DELIVERY: 'Wann du lieferst.',
  PICKUP: 'Wann Kunden bestellte Ware abholen können.',
  TAKEOUT: 'Wann Ware zum Mitnehmen bereitsteht.',
  DRIVE_THROUGH: 'Wann die Durchfahrt bedient ist.',
  ONLINE_SERVICE_HOURS: 'Wann du telefonisch oder online erreichbar bist — auch wenn der Betrieb geschlossen hat.',
  SENIOR_HOURS: 'Zeiten, die du besonders für ältere Kundschaft reservierst.',
  HAPPY_HOUR: 'Zeiten mit besonderen Angeboten.',
  KITCHEN: 'Wann die Küche geöffnet ist.',
  BREAKFAST: 'Frühstückszeiten.',
  BRUNCH: 'Brunchzeiten.',
  LUNCH: 'Mittagszeiten.',
  DINNER: 'Abendzeiten.',
};

/* ─────────────────────────────────────────────
   ZEITEN EINER ART
───────────────────────────────────────────── */

function ZeitenFuerArt({ periods, setPeriods, gesperrt, fehler, artName }) {
  const nachTag = Object.fromEntries(TAGE.map((t) => [t.key, []]));
  (periods ?? []).forEach((f) => { if (nachTag[f?.openDay]) nachTag[f.openDay].push(f); });

  const alsListe = (karte) => TAGE.flatMap((t) => karte[t.key] ?? []);

  const aendere = (tagKey, i, feld, wert) => {
    const karte = { ...nachTag, [tagKey]: [...nachTag[tagKey]] };
    const fenster = { ...karte[tagKey][i] };

    if (feld === 'auf') fenster.openTime = alsZeit(wert) ?? { hours: 0, minutes: 0 };
    if (feld === 'zu') fenster.closeTime = alsZeit(wert) ?? { hours: 0, minutes: 0 };

    /* Wie bei den regulären Zeiten: über Mitternacht setzt den
       Folgetag automatisch. */
    const idx = TAGE.findIndex((t) => t.key === tagKey);
    fenster.closeDay = ueberMitternacht({ ...fenster, closeDay: tagKey })
      ? TAGE[(idx + 1) % 7].key : tagKey;

    karte[tagKey][i] = fenster;
    setPeriods(alsListe(karte));
  };

  const ergaenze = (tagKey) => setPeriods([...(periods ?? []), {
    openDay: tagKey, closeDay: tagKey,
    openTime: alsZeit('09:00'), closeTime: alsZeit('17:00'),
  }]);

  const entferne = (fenster) => setPeriods((periods ?? []).filter((f) => f !== fenster));

  const fehlerZu = new Map();
  (fehler ?? []).forEach((f) => {
    const alle = periods ?? [];
    if (alle[f.index]) fehlerZu.set(alle[f.index], f.meldung);
  });

  return (
    <div>
      {TAGE.map((t) => {
        const fenster = nachTag[t.key] ?? [];
        return (
          <TagZeile key={t.key}>
            <TagName>{t.kurz}</TagName>
            <div>
              {fenster.length === 0 && (
                <FensterZeile>
                  <Marke>—</Marke>
                  <KleinBtn onClick={() => ergaenze(t.key)} disabled={gesperrt}
                    aria-label={`${artName} ${t.lang} Zeiten hinzufügen`}>
                    <Plus size={10} /> Zeiten
                  </KleinBtn>
                </FensterZeile>
              )}

              {fenster.map((f, i) => (
                <div key={i}>
                  <FensterZeile>
                    {istDurchgehend(f) ? (
                      <Marke>Durchgehend</Marke>
                    ) : (
                      <>
                        <Zeitfeld
                          aria-label={`${artName} ${t.lang} Öffnung ${i + 1}`}
                          value={alsText(f.openTime)} disabled={gesperrt}
                          data-fehler={fehlerZu.has(f) ? 'ja' : 'nein'}
                          onChange={(e) => aendere(t.key, i, 'auf', e.target.value)}
                        />
                        <span>–</span>
                        <Zeitfeld
                          aria-label={`${artName} ${t.lang} Schließung ${i + 1}`}
                          value={alsText(f.closeTime)} disabled={gesperrt}
                          data-fehler={fehlerZu.has(f) ? 'ja' : 'nein'}
                          onChange={(e) => aendere(t.key, i, 'zu', e.target.value)}
                        />
                        {f.closeDay !== f.openDay && <Marke>bis Folgetag</Marke>}
                      </>
                    )}
                    <KleinBtn onClick={() => entferne(f)} disabled={gesperrt}
                      aria-label={`${artName} ${t.lang} Zeitfenster ${i + 1} entfernen`}>
                      <X size={10} />
                    </KleinBtn>
                    {i === fenster.length - 1 && (
                      <KleinBtn onClick={() => ergaenze(t.key)} disabled={gesperrt}
                        aria-label={`${artName} ${t.lang} Fenster hinzufügen`}>
                        <Plus size={10} /> Fenster
                      </KleinBtn>
                    )}
                  </FensterZeile>

                  {fehlerZu.has(f) && (
                    <Fehlertext role="alert">
                      <AlertTriangle size={10} /> {fehlerZu.get(f)}
                    </Fehlertext>
                  )}
                </div>
              ))}
            </div>
          </TagZeile>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   RAHMEN
───────────────────────────────────────────── */

export default function WeitereZeitenEditor({ location, onSave }) {
  const vorher = location?.google_profile ?? {};
  const hauptkategorie = vorher.categories?.primaryCategory?.name ?? null;

  const { moreHoursTypes, laeuft, abrufGescheitert } =
    useKategorieMetadaten(hauptkategorie, location?.id);

  const sperre = istBearbeitbar('moreHours', location,
    abrufGescheitert ? { abrufErfolgreich: false } : { moreHoursTypes: moreHoursTypes ?? [] });

  const [eintraege, setEintraege] = React.useState(() => vorher.moreHours ?? []);
  const [busy, setBusy] = React.useState(false);
  const [erfolg, setErfolg] = React.useState(null);
  const [fehler, setFehler] = React.useState(null);

  React.useEffect(() => { setEintraege(vorher.moreHours ?? []); }, [vorher.moreHours]);

  /* Nur Arten, die Google für diese Kategorie liefert. */
  const erlaubteIds = (moreHoursTypes ?? []).map((t) => t.hoursTypeId);

  /*
   * Einträge, die Google für diese Kategorie nicht mehr anbietet.
   *
   * Sie kommen vor: Das Profil kann unter einer anderen Kategorie
   * angelegt worden sein, oder Google hat eine Art zurückgezogen. Sie
   * stehen im Profil, tauchen in der Auswahlliste aber nicht auf.
   *
   * Vorher erzeugten sie einen Fehler, der NIRGENDS sichtbar war: Die
   * Leiste meldete „Bitte zuerst die markierten Angaben korrigieren",
   * während nichts markiert war und nichts markiert werden konnte.
   * Jetzt bekommen sie einen eigenen Block — sichtbar und entfernbar.
   */
  const unbekannte = eintraege.filter(
    (e) => e?.hoursTypeKey && !erlaubteIds.includes(e.hoursTypeKey));

  /* Geprüft wird nur, was die Oberfläche auch zeigt. */
  const sichtbare = eintraege.filter(
    (e) => e?.hoursTypeKey && erlaubteIds.includes(e.hoursTypeKey));
  const befund = pruefeWeitereZeiten(sichtbare, erlaubteIds.length > 0 ? erlaubteIds : null);
  const ungueltig = befund.length > 0;

  const etwasGeaendert = weitereZeitenGeaendert(vorher.moreHours ?? [], eintraege);

  const umschalten = (typ) => {
    const vorhanden = eintraege.find((e) => e.hoursTypeKey === typ.hoursTypeId);
    if (vorhanden) {
      setEintraege(eintraege.filter((e) => e.hoursTypeKey !== typ.hoursTypeId));
    } else {
      setEintraege([...eintraege, { hoursTypeKey: typ.hoursTypeId, periods: [] }]);
    }
  };

  const setzePeriods = (typId, periods) => setEintraege(
    eintraege.map((e) => (e.hoursTypeKey === typId ? { ...e, periods } : e)));

  const speichern = async () => {
    setBusy(true); setErfolg(null); setFehler(null);
    try {
      /* Nur moreHours — reguläre und Sonderzeiten stehen in anderen
         Feldern und werden nicht mitgeschickt. */
      const antwort = await onSave(location.id, { moreHours: eintraege });
      if (antwort?.status === 'not_submitted') {
        setFehler('Google hat die Änderung nicht übernommen.');
      } else if (antwort?.confirmed) {
        setErfolg({ status: antwort.status ?? 'submitted_no_pending' });
      } else {
        setFehler('Google hat die Änderung nicht bestätigt. Bitte versuche es erneut.');
      }
    } catch (error) {
      setFehler(error.message || 'Die Zeiten konnten nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  /* ── Drei Zustände, bevor überhaupt etwas angezeigt wird ── */

  if (laeuft) return <Stand>Verfügbare Zeitarten werden von Google geladen…</Stand>;

  if (abrufGescheitert) {
    return (
      <Hinweis $art="warnung" role="status">
        <AlertTriangle size={14} />
        <span>
          <strong>Die für deine Kategorie verfügbaren Zeitarten konnten gerade nicht
          von Google geladen werden.</strong>{' '}
          Das heißt nicht, dass es keine gibt — versuche es in ein paar Minuten erneut.
        </span>
      </Hinweis>
    );
  }

  if (!hauptkategorie) {
    return (
      <Hinweis>
        <Info size={14} />
        Setze zuerst eine Hauptkategorie. Welche weiteren Zeiten möglich sind,
        hängt davon ab.
      </Hinweis>
    );
  }

  if ((moreHoursTypes ?? []).length === 0) {
    return (
      <Hinweis>
        <Info size={14} />
        Für diese Unternehmenskategorie bietet Google keine weiteren
        Öffnungszeiten an.
      </Hinweis>
    );
  }

  return (
    <div>
      {!sperre.erlaubt && (
        <Hinweis><Lock size={14} /> {sperre.grund}</Hinweis>
      )}

      {moreHoursTypes.map((typ) => {
        const eintrag = eintraege.find((e) => e.hoursTypeKey === typ.hoursTypeId);
        const aktiv = Boolean(eintrag);
        const index = sichtbare.findIndex((e) => e.hoursTypeKey === typ.hoursTypeId);
        const meineFehler = befund.filter((f) => f.index === index);
        const anzeige = anzeigename(typ);

        return (
          <ArtBlock key={typ.hoursTypeId} $aktiv={aktiv}>
            <ArtKopf $aktiv={aktiv}>
              <label>
                <input
                  type="checkbox" checked={aktiv}
                  disabled={!sperre.erlaubt}
                  onChange={() => umschalten(typ)}
                  aria-label={`${anzeige} aktivieren`}
                />
                <span>
                  {anzeige}
                  {ERLAEUTERUNG[typ.hoursTypeId] && (
                    <small>{ERLAEUTERUNG[typ.hoursTypeId]}</small>
                  )}
                </span>
              </label>
            </ArtKopf>

            {aktiv && (
              <ZeitenFuerArt
                artName={anzeige}
                periods={eintrag.periods ?? []}
                setPeriods={(p) => setzePeriods(typ.hoursTypeId, p)}
                gesperrt={!sperre.erlaubt}
                fehler={meineFehler}
              />
            )}
          </ArtBlock>
        );
      })}

      {unbekannte.length > 0 && (
        <Hinweis $art="warnung" role="status" style={{ marginTop: 14 }}>
          <AlertTriangle size={14} />
          <span>
            <strong>
              {unbekannte.length === 1 ? 'Eine hinterlegte Zeitart passt' : `${unbekannte.length} hinterlegte Zeitarten passen`}
              {' '}nicht zu deiner Unternehmenskategorie.
            </strong>
            {' '}Google bietet sie hier nicht mehr an — vermutlich stammen sie aus
            einer früheren Kategorie.
            <br />
            {unbekannte.map((e) => (
              <span key={e.hoursTypeKey} style={{ display: 'inline-block', marginTop: 6, marginRight: 10 }}>
                <code>{e.hoursTypeKey}</code>{' '}
                <KleinBtn
                  onClick={() => setEintraege(
                    eintraege.filter((x) => x.hoursTypeKey !== e.hoursTypeKey))}
                  disabled={!sperre.erlaubt}
                  aria-label={`${e.hoursTypeKey} entfernen`}
                >
                  <X size={10} /> entfernen
                </KleinBtn>
              </span>
            ))}
          </span>
        </Hinweis>
      )}

      <AktionsLeiste>
        <GhostBtn onClick={speichern}
          disabled={busy || !etwasGeaendert || ungueltig || !sperre.erlaubt}>
          {busy ? <Spinner size={14} /> : <Send size={14} />}
          {busy ? 'Wird übermittelt…' : 'Bei Google speichern'}
        </GhostBtn>

        <Stand>
          {!sperre.erlaubt ? sperre.grund
            : ungueltig ? 'Bitte zuerst die markierten Angaben korrigieren — Google würde sie ablehnen.'
              : !etwasGeaendert ? 'Keine Änderungen.'
                : 'Zu übermitteln: Weitere Zeiten'}
        </Stand>
      </AktionsLeiste>

      {erfolg && (
        <Hinweis $art="ok" style={{ margin: '12px 0 0' }}>
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
        <Hinweis $art="fehler" role="alert" style={{ margin: '12px 0 0' }}>
          <AlertTriangle size={14} />
          <span><strong>Nicht gespeichert.</strong> {fehler}</span>
        </Hinweis>
      )}
    </div>
  );
}
