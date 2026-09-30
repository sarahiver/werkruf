/**
 * Öffnungszeiten-Editor.
 *
 * Bildet ab, was die Business Information API vorsieht: reguläre
 * Zeiten mit mehreren Fenstern pro Tag, geschlossene Tage,
 * Sonderöffnungszeiten und kategorieabhängige moreHours.
 *
 * Drei Dinge, die er von der Profilverwaltung übernimmt:
 *
 *   1. Nur tatsächlich Geändertes wird übertragen — und zwar
 *      blockweise. Wer die regulären Zeiten ändert, schickt
 *      specialHours gar nicht erst mit; bestehende Sonderzeiten können
 *      dabei also nicht verlorengehen.
 *
 *   2. Die Rückmeldung unterscheidet Übermittlung von
 *      Veröffentlichung. Eine erfolgreiche PATCH-Antwort heisst
 *      angenommen, nicht sichtbar.
 *
 *   3. Gesperrte Felder sind sichtbar gesperrt und nennen den Grund.
 *      Die Sperren kommen aus dem Feldmodell; verbindlich prüft die
 *      Edge Function.
 *
 * Die Validierung liegt in src/utils/gbpHours.js — derselben Datei,
 * die auch serverseitig geprüft wird.
 */
import React from 'react';
import styled from 'styled-components';
import { Plus, X, Send, Lock, AlertTriangle, Calendar } from 'lucide-react';

import { istBearbeitbar } from '../../utils/gbpFieldModel';
import {
  TAGE, alsText, alsZeit, alsDatum, alsDatumstext,
  istDurchgehend, ueberMitternacht,
  pruefeAlles, hatFehler, baueZeitAenderungen,
} from '../../utils/gbpHours';
import { GhostBtn, Spinner } from './gb/GbUi';

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

const Block = styled.section`
  & + & { margin-top: 26px; padding-top: 22px; border-top: 1px solid var(--color-border); }
  > h4 { font-family: var(--font-display); font-size: .95rem;
         color: var(--color-primary); margin: 0 0 3px;
         display: flex; align-items: center; gap: 7px; }
  > p  { font-family: var(--font-body); font-size: .79rem; line-height: 1.55;
         color: var(--color-text-muted); margin: 0 0 12px; }
`;

const TagZeile = styled.div`
  display: grid; grid-template-columns: 62px 1fr; gap: 10px;
  align-items: start; padding: 9px 0;
  border-top: 1px solid var(--color-border);
  &:first-of-type { border-top: 0; }
`;

const TagName = styled.div`
  font-family: var(--font-body); font-size: .84rem; font-weight: 600;
  color: var(--color-primary); padding-top: 7px;
`;

const FensterZeile = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin-bottom: 5px;
`;

const Zeitfeld = styled.input`
  font-family: var(--font-body); font-size: .82rem;
  border: 1px solid var(--color-border); border-radius: 5px;
  padding: 6px 8px; width: 88px; background: #fff;
  &:disabled { background: #F4F5F7; color: var(--color-text-muted); cursor: not-allowed; }
  &[data-fehler='ja'] { border-color: #D93025; background: #FDECEA; }
`;

const Datumsfeld = styled(Zeitfeld)`  width: 140px; `;

const KleinBtn = styled.button`
  font-family: var(--font-body); font-size: .76rem;
  background: none; border: 1px solid var(--color-border); border-radius: 5px;
  padding: 5px 9px; cursor: pointer; color: var(--color-text-muted);
  display: inline-flex; align-items: center; gap: 4px;
  &:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-primary); }
  &:disabled { opacity: .4; cursor: not-allowed; }
`;

const Marke = styled.span`
  font-family: var(--font-body); font-size: .74rem;
  color: var(--color-text-muted); padding: 6px 2px;
`;

const SondertagBlock = styled.div`
  padding: 10px 0; border-top: 1px solid var(--color-border);
  &:first-of-type { border-top: 0; }
`;

const Fehlertext = styled.p`
  font-family: var(--font-body); font-size: .75rem; line-height: 1.5;
  color: #8B1A12; margin: 2px 0 0; display: flex; gap: 5px; align-items: flex-start;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

const Hinweis = styled.div`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.55;
  border-radius: 6px; padding: 10px 13px; margin: 14px 0 0;
  border-left: 3px solid ${(p) => (p.$art === 'ok' ? '#1E7E34' : p.$art === 'fehler' ? '#D93025' : '#8A9199')};
  background: ${(p) => (p.$art === 'ok' ? '#E8F5E9' : p.$art === 'fehler' ? '#FDECEA' : '#F4F5F7')};
  color: ${(p) => (p.$art === 'ok' ? '#1B5E20' : p.$art === 'fehler' ? '#8B1A12' : '#5F6875')};
`;

/*
 * Die Aktionsleiste bleibt am unteren Rand stehen.
 *
 * Vorher stand der Speicherknopf ganz unten, nach sieben Wochentagen
 * und der Sondertagsliste — bei einem gefüllten Profil weit ausserhalb
 * des Sichtbereichs. Wer oben eine Zeit änderte, sah nicht, dass es
 * überhaupt etwas zu speichern gibt.
 */
const AktionsLeiste = styled.div`
  position: sticky; bottom: 0; z-index: 5;
  margin: 22px -4px -4px; padding: 12px 4px;
  background: linear-gradient(to top, var(--color-bg, #fff) 72%, transparent);
  border-top: 1px solid var(--color-border);
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
`;

const Stand = styled.span`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted);
`;

const Sperrgrund = styled.p`
  font-family: var(--font-body); font-size: .76rem; line-height: 1.5;
  color: var(--color-text-muted); margin: 0 0 12px;
  display: flex; gap: 6px; align-items: flex-start;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

/* ─────────────────────────────────────────────
   HILFSFUNKTIONEN
───────────────────────────────────────────── */

/** Zeitfenster nach Wochentag gruppieren, für die Darstellung. */
function nachTagen(periods) {
  const karte = Object.fromEntries(TAGE.map((t) => [t.key, []]));
  (periods ?? []).forEach((f) => {
    if (karte[f?.openDay]) karte[f.openDay].push(f);
  });
  return karte;
}

/** Aus den gruppierten Fenstern wieder eine flache Liste bauen. */
function alsListe(karte) {
  return TAGE.flatMap((t) => karte[t.key] ?? []);
}

/* ─────────────────────────────────────────────
   REGULÄRE ÖFFNUNGSZEITEN
───────────────────────────────────────────── */

function RegulaereZeiten({ karte, setKarte, gesperrt, fehler }) {
  const aendere = (tagKey, index, feld, wert) => {
    const kopie = { ...karte, [tagKey]: [...karte[tagKey]] };
    const fenster = { ...kopie[tagKey][index] };

    if (feld === 'auf') fenster.openTime = alsZeit(wert) ?? { hours: 0, minutes: 0 };
    if (feld === 'zu')  fenster.closeTime = alsZeit(wert) ?? { hours: 0, minutes: 0 };

    /* Reicht das Fenster über Mitternacht, muss der Schließtag der
       Folgetag sein. Das dem Kunden zu überlassen wäre eine
       Fehlerquelle, die er nicht durchschauen kann. */
    const tagIndex = TAGE.findIndex((t) => t.key === tagKey);
    fenster.closeDay = ueberMitternacht({ ...fenster, closeDay: tagKey })
      ? TAGE[(tagIndex + 1) % 7].key
      : tagKey;

    kopie[tagKey][index] = fenster;
    setKarte(kopie);
  };

  const ergaenze = (tagKey) => setKarte({
    ...karte,
    [tagKey]: [...karte[tagKey], {
      openDay: tagKey, closeDay: tagKey,
      openTime: alsZeit('08:00'), closeTime: alsZeit('17:00'),
    }],
  });

  const entferne = (tagKey, index) => setKarte({
    ...karte,
    [tagKey]: karte[tagKey].filter((_, i) => i !== index),
  });

  /* Von „durchgehend" zurueck auf feste Zeiten. */
  const aufZeiten = (tagKey) => setKarte({
    ...karte,
    [tagKey]: [{
      openDay: tagKey, closeDay: tagKey,
      openTime: alsZeit('08:00'), closeTime: alsZeit('17:00'),
    }],
  });

  const ganztags = (tagKey) => setKarte({
    ...karte,
    [tagKey]: [{
      openDay: tagKey, closeDay: tagKey,
      openTime: alsZeit('00:00'), closeTime: alsZeit('00:00'),
    }],
  });

  /* Fehler dem jeweiligen Fenster zuordnen. pruefeRegulaer arbeitet
     auf der flachen Liste, die Anzeige auf Tagen. */
  const flach = alsListe(karte);
  const fehlerZu = new Map();
  (fehler ?? []).forEach((f) => {
    const fenster = flach[f.index];
    if (fenster) fehlerZu.set(fenster, f.meldung);
  });

  return (
    <div>
      {TAGE.map((t) => {
        const fenster = karte[t.key] ?? [];
        return (
          <TagZeile key={t.key}>
            <TagName>{t.kurz}</TagName>
            <div>
              {fenster.length === 0 && (
                <FensterZeile>
                  <Marke>Geschlossen</Marke>
                  <KleinBtn onClick={() => ergaenze(t.key)} disabled={gesperrt}>
                    <Plus size={11} /> Zeiten
                  </KleinBtn>
                </FensterZeile>
              )}

              {fenster.map((f, i) => (
                <div key={i}>
                  <FensterZeile>
                    {istDurchgehend(f) ? (
                      <>
                        <Marke>Durchgehend geöffnet</Marke>
                        {/* Ohne diesen Knopf war der Tag eine Sackgasse:
                            keine Eingabefelder, kein Weg zurück, nur ein
                            X, das wie „löschen" aussieht. */}
                        <KleinBtn onClick={() => aufZeiten(t.key)} disabled={gesperrt}
                          aria-label={`${t.lang} auf feste Zeiten umstellen`}>
                          Feste Zeiten
                        </KleinBtn>
                      </>
                    ) : (
                      <>
                        <Zeitfeld
                          aria-label={`${t.lang} Öffnung ${i + 1}`}
                          value={alsText(f.openTime)} disabled={gesperrt}
                          data-fehler={fehlerZu.has(f) ? 'ja' : 'nein'}
                          onChange={(e) => aendere(t.key, i, 'auf', e.target.value)}
                          placeholder="08:00"
                        />
                        <span>–</span>
                        <Zeitfeld
                          aria-label={`${t.lang} Schließung ${i + 1}`}
                          value={alsText(f.closeTime)} disabled={gesperrt}
                          data-fehler={fehlerZu.has(f) ? 'ja' : 'nein'}
                          onChange={(e) => aendere(t.key, i, 'zu', e.target.value)}
                          placeholder="17:00"
                        />
                        {f.closeDay !== f.openDay && <Marke>bis Folgetag</Marke>}
                      </>
                    )}

                    <KleinBtn onClick={() => entferne(t.key, i)} disabled={gesperrt}
                      aria-label={istDurchgehend(f)
                        ? `${t.lang} schließen`
                        : `${t.lang} Zeitfenster ${i + 1} entfernen`}>
                      <X size={11} />
                      {istDurchgehend(f) && ' Geschlossen'}
                    </KleinBtn>

                    {i === fenster.length - 1 && !istDurchgehend(f) && (
                      <>
                        <KleinBtn onClick={() => ergaenze(t.key)} disabled={gesperrt}>
                          <Plus size={11} /> Fenster
                        </KleinBtn>
                        <KleinBtn onClick={() => ganztags(t.key)} disabled={gesperrt}>
                          24 h
                        </KleinBtn>
                      </>
                    )}
                  </FensterZeile>

                  {fehlerZu.has(f) && (
                    <Fehlertext role="alert">
                      <AlertTriangle size={11} /> {fehlerZu.get(f)}
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
   SONDERÖFFNUNGSZEITEN
───────────────────────────────────────────── */

/**
 * Sonder- und Feiertagszeiten.
 *
 * Gruppiert nach Datum, weil Google mehrere Zeitfenster am selben Tag
 * erlaubt: „To add multiple sets of hours for the date" — etwa
 * 10:00–16:00 und 17:00–18:00 am 26. Dezember.
 *
 * Eine frühere Fassung zeigte jeden SpecialHourPeriod als eigene
 * Zeile mit eigenem Datumsfeld. Das war nah an der API, aber fern von
 * der Frage, die der Kunde hat: „Wie habe ich an Heiligabend
 * geöffnet?"
 */
function Sonderzeiten({ perioden, setPerioden, gesperrt, fehler }) {
  /* Nach Datum gruppieren, Reihenfolge der Tage beibehalten. */
  const tage = [];
  perioden.forEach((p, index) => {
    const key = alsDatumstext(p.startDate) || `__ohne_datum_${index}`;
    let gruppe = tage.find((t) => t.key === key);
    if (!gruppe) { gruppe = { key, datum: p.startDate, eintraege: [] }; tage.push(gruppe); }
    gruppe.eintraege.push({ p, index });
  });

  const ersetze = (index, teil) => setPerioden(
    perioden.map((p, i) => (i === index ? { ...p, ...teil } : p)));

  const datumAendern = (gruppe, wert) => {
    const neu = alsDatum(wert);
    setPerioden(perioden.map((p, i) =>
      (gruppe.eintraege.some((e) => e.index === i) ? { ...p, startDate: neu } : p)));
  };

  const aufGeschlossen = (gruppe) => {
    /* Alle Fenster dieses Tages durch EINEN geschlossenen Eintrag
       ersetzen. Google lehnt geschlossen neben Zeiten am selben Tag
       ab — sie nur auszublenden reichte nicht. */
    const behalten = perioden.filter((_, i) => !gruppe.eintraege.some((e) => e.index === i));
    setPerioden([...behalten, { startDate: gruppe.datum, closed: true }]);
  };

  const aufZeiten = (gruppe) => {
    const behalten = perioden.filter((_, i) => !gruppe.eintraege.some((e) => e.index === i));
    setPerioden([...behalten, {
      startDate: gruppe.datum,
      openTime: alsZeit('08:00'), closeTime: alsZeit('12:00'),
    }]);
  };

  const fensterErgaenzen = (gruppe) => setPerioden([...perioden, {
    startDate: gruppe.datum,
    openTime: alsZeit('13:00'), closeTime: alsZeit('17:00'),
  }]);

  const tagEntfernen = (gruppe) => setPerioden(
    perioden.filter((_, i) => !gruppe.eintraege.some((e) => e.index === i)));

  const fehlerZu = new Map((fehler ?? []).map((f) => [f.index, f.meldung]));

  return (
    <div>
      {tage.length === 0 && (
        <Marke>Noch keine Sonder- oder Feiertagszeiten hinterlegt.</Marke>
      )}

      {tage.map((gruppe, nr) => {
        const geschlossen = gruppe.eintraege.every((e) => e.p.closed === true);
        return (
          <SondertagBlock key={gruppe.key}>
            <FensterZeile>
              <Datumsfeld
                type="date" aria-label={`Sondertag ${nr + 1} Datum`}
                value={alsDatumstext(gruppe.datum)} disabled={gesperrt}
                onChange={(e) => datumAendern(gruppe, e.target.value)}
              />
              <KleinBtn
                onClick={() => (geschlossen ? aufZeiten(gruppe) : aufGeschlossen(gruppe))}
                disabled={gesperrt}
              >
                {geschlossen ? 'Zeiten eintragen' : 'Geschlossen'}
              </KleinBtn>
              <KleinBtn onClick={() => tagEntfernen(gruppe)} disabled={gesperrt}
                aria-label={`Sondertag ${nr + 1} entfernen`}>
                <X size={11} />
              </KleinBtn>
            </FensterZeile>

            {geschlossen ? (
              <Marke>Ganztägig geschlossen</Marke>
            ) : (
              gruppe.eintraege.map((e, j) => (
                <div key={e.index}>
                  <FensterZeile>
                    <Zeitfeld
                      aria-label={`Sondertag ${nr + 1} Öffnung ${j + 1}`}
                      value={alsText(e.p.openTime)} disabled={gesperrt}
                      data-fehler={fehlerZu.has(e.index) ? 'ja' : 'nein'}
                      onChange={(ev) => ersetze(e.index, { openTime: alsZeit(ev.target.value) })}
                      placeholder="08:00"
                    />
                    <span>–</span>
                    <Zeitfeld
                      aria-label={`Sondertag ${nr + 1} Schließung ${j + 1}`}
                      value={alsText(e.p.closeTime)} disabled={gesperrt}
                      data-fehler={fehlerZu.has(e.index) ? 'ja' : 'nein'}
                      onChange={(ev) => ersetze(e.index, { closeTime: alsZeit(ev.target.value) })}
                      placeholder="12:00"
                    />
                    {gruppe.eintraege.length > 1 && (
                      <KleinBtn
                        onClick={() => setPerioden(perioden.filter((_, i) => i !== e.index))}
                        disabled={gesperrt}
                        aria-label={`Sondertag ${nr + 1} Zeitfenster ${j + 1} entfernen`}>
                        <X size={11} />
                      </KleinBtn>
                    )}
                    {j === gruppe.eintraege.length - 1 && (
                      <KleinBtn onClick={() => fensterErgaenzen(gruppe)} disabled={gesperrt}
                        aria-label={`Sondertag ${nr + 1} Zeitfenster hinzufügen`}>
                        <Plus size={11} /> Fenster
                      </KleinBtn>
                    )}
                  </FensterZeile>

                  {fehlerZu.has(e.index) && (
                    <Fehlertext role="alert">
                      <AlertTriangle size={11} /> {fehlerZu.get(e.index)}
                    </Fehlertext>
                  )}
                </div>
              ))
            )}
          </SondertagBlock>
        );
      })}

      <KleinBtn
        onClick={() => setPerioden([...perioden, { startDate: null, closed: true }])}
        disabled={gesperrt} style={{ marginTop: 10 }}
      >
        <Plus size={11} /> Sondertag
      </KleinBtn>
    </div>
  );
}

/** Feldnamen, wie sie im Dashboard heissen. */
const nenneBlock = (feld) => ({
  regularHours: 'Reguläre Öffnungszeiten',
  specialHours: 'Sonder- & Feiertagszeiten',
  moreHours: 'Weitere Zeiten',
}[feld] ?? feld);

/* ─────────────────────────────────────────────
   RAHMEN
───────────────────────────────────────────── */

export default function OeffnungszeitenEditor({ location, onSave, erlaubteZeitarten = null }) {
  const vorher = location?.google_profile ?? {};

  const sperre = {
    regulaer: istBearbeitbar('regularHours', location),
    sonder:   istBearbeitbar('specialHours', location),
    weitere:  istBearbeitbar('moreHours', location),
  };

  const [karte, setKarte] = React.useState(() => nachTagen(vorher.regularHours?.periods));
  const [sonder, setSonder] = React.useState(() => vorher.specialHours?.specialHourPeriods ?? []);

  const [busy, setBusy] = React.useState(false);
  const [erfolg, setErfolg] = React.useState(null);
  const [fehler, setFehler] = React.useState(null);

  /* Nach erfolgreichem Speichern liefert der Server den bestätigten
     Stand; die Ausgangswerte wandern nach. Ohne das gälte alles
     weiterhin als geändert. */
  React.useEffect(() => {
    setKarte(nachTagen(vorher.regularHours?.periods));
    setSonder(vorher.specialHours?.specialHourPeriods ?? []);
  }, [vorher.regularHours, vorher.specialHours]);

  const regulaer = alsListe(karte);
  /*
   * Geprueft wird NUR, was der Editor auch bearbeiten kann.
   *
   * moreHours stand hier zunaechst mit drin — mit der Folge, dass ein
   * unvollstaendiger Eintrag aus dem Google-Profil das Speichern der
   * regulaeren Zeiten sperrte, ohne dass die Oberflaeche den Fehler
   * haette anzeigen koennen: Fuer "Weitere Zeiten" gibt es bis Paket C
   * gar keine Eingabemaske. Der Knopf blieb aus, und niemand konnte
   * etwas dagegen tun.
   *
   * Ein Bereich, der als "folgt" gekennzeichnet ist, darf das Speichern
   * anderer Bereiche nicht blockieren. Sobald die Maske existiert,
   * kommt moreHours hier wieder dazu.
   */
  const befund = pruefeAlles({ regulaer, sonder });
  const ungueltig = hatFehler(befund);

  const aenderungen = baueZeitAenderungen({ vorher, regulaer, sonder });
  const etwasGeaendert = Object.keys(aenderungen).length > 0;

  const speichern = async () => {
    setBusy(true); setErfolg(null); setFehler(null);
    try {
      const antwort = await onSave(location.id, aenderungen);
      if (antwort?.confirmed) {
        setErfolg({ felder: Object.keys(aenderungen) });
      } else {
        setFehler('Google hat die Änderung nicht bestätigt. Bitte versuche es erneut.');
      }
    } catch (error) {
      setFehler(error.message || 'Die Öffnungszeiten konnten nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Block>
        <h4>Reguläre Öffnungszeiten</h4>
        <p>
          Mehrere Zeitfenster pro Tag sind möglich — etwa vormittags und nachmittags
          mit Mittagspause. Reicht ein Fenster über Mitternacht, wird der Folgetag
          automatisch gesetzt.
        </p>
        {!sperre.regulaer.erlaubt && (
          <Sperrgrund><Lock size={12} /> {sperre.regulaer.grund}</Sperrgrund>
        )}
        <RegulaereZeiten
          karte={karte} setKarte={setKarte}
          gesperrt={!sperre.regulaer.erlaubt} fehler={befund.regulaer}
        />
      </Block>

      <Block>
        <h4><Calendar size={14} /> Sonder- &amp; Feiertagszeiten</h4>
        <p>
          Hier kannst du für Feiertage, Betriebsferien oder einzelne Tage
          abweichende Öffnungszeiten hinterlegen. Ein Tag ist entweder
          geschlossen oder hat Uhrzeiten — mehrere Zeitfenster pro Tag sind
          möglich.
        </p>
        {!sperre.sonder.erlaubt && (
          <Sperrgrund><Lock size={12} /> {sperre.sonder.grund}</Sperrgrund>
        )}
        <Sonderzeiten
          perioden={sonder} setPerioden={setSonder}
          gesperrt={!sperre.sonder.erlaubt} fehler={befund.sonder}
        />
      </Block>

      <AktionsLeiste>
        <GhostBtn onClick={speichern} disabled={busy || !etwasGeaendert || ungueltig}>
          {busy ? <Spinner size={14} /> : <Send size={14} />}
          {busy ? 'Wird übermittelt…' : 'Bei Google speichern'}
        </GhostBtn>

        {/* Warum der Knopf gesperrt ist, gehoert daneben. Ein
            ausgegrauter Knopf ohne Begruendung ist eine Sackgasse. */}
        <Stand>
          {ungueltig
            ? 'Bitte zuerst die markierten Angaben korrigieren — Google würde sie ablehnen.'
            : !etwasGeaendert
              ? 'Keine Änderungen.'
              : `Zu übermitteln: ${Object.keys(aenderungen).map(nenneBlock).join(', ')}`}
        </Stand>
      </AktionsLeiste>

      {erfolg && (
        <Hinweis $art="ok">
          <strong>An Google übermittelt.</strong>{' '}
          Google kann die Veröffentlichung noch überprüfen — bis dahin sind im
          Unternehmensprofil weiterhin die bisherigen Zeiten sichtbar.
          <br />
          <small>Übermittelt: {erfolg.felder.map(nenneBlock).join(', ')}</small>
        </Hinweis>
      )}

      {fehler && (
        <Hinweis $art="fehler" role="alert">
          <strong>Nicht gespeichert.</strong> {fehler}
        </Hinweis>
      )}
    </div>
  );
}
