/**
 * Eigenschaften deines Betriebs (`attributes`).
 *
 * Welche Attribute es gibt, bestimmt Google je Standort — abgefragt mit
 * `parent`, nicht mit Kategorie und Region. Das Schema sagt
 * ausdrücklich, dass verfügbare Attribute ohne API-Änderung hinzukommen
 * und wegfallen können; eine gepflegte Liste wäre von vornherein
 * falsch.
 *
 * Gespeichert wird über den EIGENEN Endpunkt `updateAttributes` mit
 * `attributeMask` — nicht über `locations.patch`. Ohne Maske ersetzt
 * Google die gesamte Attributliste.
 *
 * Unbekannte Datentypen werden schreibgeschützt angezeigt und
 * protokolliert, nicht verschluckt. Google kann jederzeit neue
 * einführen.
 */
import React from 'react';
import styled from 'styled-components';
import { Send, Lock, AlertTriangle, Info, ExternalLink } from 'lucide-react';

import { istBearbeitbar } from '../../utils/gbpFieldModel';
import {
  useGoogleAttributes, nachGruppen, WERTTYP,
  istBekannterTyp, wertVon, baueAttribut, wertGleich,
} from '../../hooks/useGoogleAttributes';
import { GhostBtn, Spinner } from './gb/GbUi';

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const Gruppe = styled.section`
  & + & { margin-top: 22px; }
  > h4 { font-family: var(--font-display); font-size: .92rem;
         color: var(--color-primary); margin: 0 0 8px; }
`;

const Zeile = styled.div`
  display: grid; grid-template-columns: 1fr auto; gap: 14px;
  align-items: start; padding: 10px 0;
  border-top: 1px solid var(--color-border);
  &:first-of-type { border-top: 0; }
`;

const Name = styled.div`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-primary);
  small { display: block; font-size: .73rem; color: var(--color-text-muted);
          margin-top: 2px; line-height: 1.5; }
`;

const Schalter = styled.label`
  display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--font-body); font-size: .8rem;
  color: var(--color-text-muted); cursor: pointer;
  input:disabled + span { opacity: .5; }
`;

const Auswahl = styled.select`
  font-family: var(--font-body); font-size: .82rem;
  border: 1px solid var(--color-border); border-radius: 5px;
  padding: 6px 9px; background: #fff; min-width: 160px;
  &:disabled { background: #F4F5F7; cursor: not-allowed; }
`;

const Textfeld = styled.input`
  font-family: var(--font-body); font-size: .82rem;
  border: 1px solid var(--color-border); border-radius: 5px;
  padding: 6px 9px; background: #fff; min-width: 240px;
  &:disabled { background: #F4F5F7; cursor: not-allowed; }
`;

const Mehrfach = styled.div`
  display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end;
  max-width: 340px;
  label { display: inline-flex; align-items: center; gap: 4px;
          font-family: var(--font-body); font-size: .76rem;
          border: 1px solid var(--color-border); border-radius: 5px;
          padding: 4px 8px; cursor: pointer;
          &:has(input:checked) { border-color: var(--color-accent);
                                 background: #EEF3F8; color: var(--color-primary); } }
`;

const Marke = styled.span`
  font-family: var(--font-body); font-size: .72rem; font-weight: 700;
  background: #EEF1F4; color: #5F6875;
  border-radius: 4px; padding: 3px 8px; white-space: nowrap;
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
  margin: 22px -4px -4px; padding: 12px 4px;
  background: linear-gradient(to top, var(--color-bg, #fff) 72%, transparent);
  border-top: 1px solid var(--color-border);
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
`;

const Stand = styled.span`
  font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted);
`;

/* ─────────────────────────────────────────────
   EIN ATTRIBUT
───────────────────────────────────────────── */

function AttributFeld({ meta, wert, setWert, gesperrt }) {
  switch (meta.valueType) {
    case WERTTYP.BOOL:
      return (
        <Schalter>
          <input
            type="checkbox" checked={wert === true} disabled={gesperrt}
            onChange={(e) => setWert(e.target.checked)}
            aria-label={meta.displayName}
          />
          <span>{wert === true ? 'Ja' : 'Nein'}</span>
        </Schalter>
      );

    case WERTTYP.ENUM:
      return (
        <Auswahl
          value={wert ?? ''} disabled={gesperrt}
          onChange={(e) => setWert(e.target.value || null)}
          aria-label={meta.displayName}
        >
          <option value="">— keine Angabe —</option>
          {(meta.valueMetadata ?? []).map((v) => (
            <option key={v.value} value={v.value}>{v.displayName ?? v.value}</option>
          ))}
        </Auswahl>
      );

    case WERTTYP.URL:
      return (
        <Textfeld
          type="url" value={wert ?? ''} disabled={gesperrt}
          onChange={(e) => setWert(e.target.value || null)}
          placeholder="https://…"
          aria-label={meta.displayName}
        />
      );

    case WERTTYP.REPEATED_ENUM: {
      const gewaehlt = Array.isArray(wert) ? wert : [];
      return (
        <Mehrfach role="group" aria-label={meta.displayName}>
          {(meta.valueMetadata ?? []).map((v) => (
            <label key={v.value}>
              <input
                type="checkbox" disabled={gesperrt}
                checked={gewaehlt.includes(v.value)}
                onChange={(e) => setWert(e.target.checked
                  ? [...gewaehlt, v.value]
                  : gewaehlt.filter((x) => x !== v.value))}
                aria-label={`${meta.displayName}: ${v.displayName ?? v.value}`}
              />
              {v.displayName ?? v.value}
            </label>
          ))}
        </Mehrfach>
      );
    }

    default:
      /* Unbekannter Typ. Nicht raten, nicht verschlucken — anzeigen,
         was da ist, und klar sagen, dass es hier nicht änderbar ist. */
      return <Marke title={`Datentyp ${meta.valueType}`}>nur lesbar</Marke>;
  }
}

/* ─────────────────────────────────────────────
   RAHMEN
───────────────────────────────────────────── */

export default function AttributeEditor({ location }) {
  const { metadaten, gesetzt, vollstaendig, laeuft, fehler: ladeFehler, speichern } =
    useGoogleAttributes(location?.id);

  const sperre = istBearbeitbar('attributes', location);

  /* Ausgangswerte aus dem bestätigten Stand. */
  const ausgangswerte = React.useMemo(() => {
    const karte = {};
    for (const a of gesetzt ?? []) karte[a.name] = wertVon(a);
    return karte;
  }, [gesetzt]);

  const [werte, setWerte] = React.useState({});
  React.useEffect(() => { setWerte({}); }, [ausgangswerte]);

  const [busy, setBusy] = React.useState(false);
  const [erfolg, setErfolg] = React.useState(null);
  const [fehler, setFehler] = React.useState(null);

  const wertFuer = (id) => (id in werte ? werte[id] : ausgangswerte[id] ?? null);
  const setzeWert = (id, w) => setWerte((bisher) => ({ ...bisher, [id]: w }));

  /* Unbekannte Typen protokollieren — einmal je Laden, damit das
     API-Monitoring beziehungsweise der Betrieb davon erfährt. */
  React.useEffect(() => {
    const unbekannt = (metadaten ?? []).filter((m) => !istBekannterTyp(m.valueType));
    if (unbekannt.length > 0) {
      console.warn(JSON.stringify({
        scope: 'AttributeEditor', event: 'unbekannter_attributtyp',
        typen: [...new Set(unbekannt.map((m) => m.valueType))],
        anzahl: unbekannt.length,
      }));
    }
  }, [metadaten]);

  /* Nur tatsächlich geänderte Attribute — und nur solche, deren Typ
     wir kennen. */
  const geaendert = (metadaten ?? []).filter((m) => {
    const id = m.parent ?? m.name;
    if (!istBekannterTyp(m.valueType)) return false;
    if (!(id in werte)) return false;
    return !wertGleich(werte[id], ausgangswerte[id] ?? null);
  });

  const speichernJetzt = async () => {
    setBusy(true); setErfolg(null); setFehler(null);
    try {
      const nutzlast = geaendert
        .map((m) => baueAttribut(m, wertFuer(m.parent ?? m.name)))
        .filter(Boolean);

      const antwort = await speichern(nutzlast);
      if (antwort?.confirmed) {
        setErfolg({ anzahl: nutzlast.length, hinweis: antwort.hinweis ?? null });
        setWerte({});
      } else {
        setFehler('Google hat die Änderung nicht bestätigt. Bitte versuche es erneut.');
      }
    } catch (error) {
      setFehler(error.message || 'Die Eigenschaften konnten nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  if (laeuft) return <Stand>Eigenschaften werden von Google geladen…</Stand>;

  if (ladeFehler) {
    return (
      <Hinweis $art="warnung" role="status">
        <AlertTriangle size={14} />
        <span>
          <strong>Die Eigenschaften konnten gerade nicht von Google geladen
          werden.</strong> {ladeFehler}
        </span>
      </Hinweis>
    );
  }

  if ((metadaten ?? []).length === 0) {
    return (
      <Hinweis>
        <Info size={14} />
        Für diesen Betrieb bietet Google derzeit keine Eigenschaften an.
        Welche verfügbar sind, hängt von Kategorie und Land ab.
      </Hinweis>
    );
  }

  const unbekannteTypen = (metadaten ?? []).filter((m) => !istBekannterTyp(m.valueType));

  return (
    <div>
      {!sperre.erlaubt && (
        <Hinweis><Lock size={14} /> {sperre.grund}</Hinweis>
      )}

      {!vollstaendig && (
        <Hinweis $art="warnung">
          <AlertTriangle size={14} />
          Google hat mehr Eigenschaften, als hier geladen werden konnten.
        </Hinweis>
      )}

      {unbekannteTypen.length > 0 && (
        <Hinweis>
          <Info size={14} />
          <span>
            {unbekannteTypen.length === 1
              ? 'Eine Eigenschaft hat einen Datentyp, den WERKRUF noch nicht kennt'
              : `${unbekannteTypen.length} Eigenschaften haben Datentypen, die WERKRUF noch nicht kennt`}
            {' '}({[...new Set(unbekannteTypen.map((m) => m.valueType))].join(', ')}).
            Sie werden angezeigt, aber nicht verändert — pflege sie vorerst
            direkt bei Google.
          </span>
        </Hinweis>
      )}

      {nachGruppen(metadaten).map((gruppe) => (
        <Gruppe key={gruppe.name}>
          <h4>{gruppe.name}</h4>
          {gruppe.eintraege.map((meta) => {
            const id = meta.parent ?? meta.name;
            const bekannt = istBekannterTyp(meta.valueType);
            return (
              <Zeile key={id}>
                <Name>
                  {meta.displayName ?? id}
                  {!bekannt && (
                    <small>
                      Datentyp <code>{meta.valueType}</code> — in WERKRUF noch nicht
                      bearbeitbar.
                    </small>
                  )}
                </Name>
                <AttributFeld
                  meta={meta}
                  wert={wertFuer(id)}
                  setWert={(w) => setzeWert(id, w)}
                  gesperrt={!sperre.erlaubt || !bekannt}
                />
              </Zeile>
            );
          })}
        </Gruppe>
      ))}

      <AktionsLeiste>
        <GhostBtn onClick={speichernJetzt}
          disabled={busy || geaendert.length === 0 || !sperre.erlaubt}>
          {busy ? <Spinner size={14} /> : <Send size={14} />}
          {busy ? 'Wird übermittelt…' : 'Bei Google speichern'}
        </GhostBtn>

        <Stand>
          {!sperre.erlaubt ? sperre.grund
            : geaendert.length === 0 ? 'Keine Änderungen.'
              : `Zu übermitteln: ${geaendert.length} Eigenschaft(en)`}
        </Stand>
      </AktionsLeiste>

      {erfolg && (
        <Hinweis $art="ok" style={{ margin: '12px 0 0' }}>
          <Info size={14} />
          <span>
            <strong>An Google übermittelt.</strong>{' '}
            {erfolg.anzahl} Eigenschaft(en). Google kann die Veröffentlichung noch
            überprüfen.
            {erfolg.hinweis && <><br /><small>{erfolg.hinweis}</small></>}
          </span>
        </Hinweis>
      )}

      {fehler && (
        <Hinweis $art="fehler" role="alert" style={{ margin: '12px 0 0' }}>
          <AlertTriangle size={14} />
          <span><strong>Nicht gespeichert.</strong> {fehler}</span>
        </Hinweis>
      )}

      <Stand style={{ display: 'block', marginTop: 14 }}>
        Nicht alles, was Google im Unternehmensprofil zeigt, lässt sich über die
        API pflegen.{' '}
        <a href="https://business.google.com/" target="_blank" rel="noreferrer noopener">
          Direkt bei Google öffnen <ExternalLink size={11} style={{ verticalAlign: -1 }} />
        </a>
      </Stand>
    </div>
  );
}
