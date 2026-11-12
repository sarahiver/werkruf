import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { KpiReihe, Flaeche, FlaecheKopf, Knopf, Leer, ResponsiveTabelle, Chip } from './adminUi';
import { ZEITRAEUME, STANDARD_ZEITRAUM } from '../../utils/analyseBericht';

/*
 * Admin · Analyse (Paket B)
 *
 *   Produkt-Funnel (eigene Datenbank, vollstaendig)
 *   Website (GA4, nur Besucher mit Einwilligung)
 *   Google-Suche (Search Console)
 *
 * Jede Quelle zeigt ihren Zustand ehrlich: nicht eingerichtet (mit den
 * fehlenden Secret-NAMEN), Fehler (mit Code), Daten. Keine Werte werden
 * geschaetzt oder aufgefuellt.
 *
 * Diagramme: je ein Datenreihe, eine Farbe, kein Legendenkasten (der
 * Titel nennt die Reihe), Hover-Wert je Tag, Tabelle als Alternative.
 */

const fmt = new Intl.NumberFormat('de-DE');
const fmt1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
function formatiere(wert, format) {
  if (wert == null || Number.isNaN(wert)) return '—';
  if (format === 'prozent') return `${fmt1.format(wert * 100)} %`;
  if (format === 'anteil') return `${fmt1.format(wert * 100)} %`;
  if (format === 'position') return fmt1.format(wert);
  return fmt.format(Math.round(wert));
}
function tag(iso) {
  const [, m, d] = String(iso).split('-');
  return `${d}.${m}.`;
}

/* ── Zeitraum ── */
const Leiste = styled.div`display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 0 0 16px;`;
const Wahl = styled.button`
  font-family: var(--font-body); font-size: .8rem; font-weight: 700; cursor: pointer;
  padding: 7px 12px; border-radius: 999px; border: 1px solid var(--color-border, #d9dee5);
  background: ${({ $aktiv }) => ($aktiv ? 'var(--color-primary)' : 'var(--color-white)')};
  color: ${({ $aktiv }) => ($aktiv ? '#fff' : 'var(--color-text)')};
  &:focus-visible { outline: 3px solid rgba(242,140,40,.55); outline-offset: 2px; }
`;
const Hinweis = styled.p`font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted); margin: 0 0 14px;`;

/* ── KPI mit Veraenderung (Text in Tinte, Richtung als Pfeil + Wort) ── */
const Karte = styled.div`
  background: var(--color-white); border-radius: 10px; padding: 12px 14px;
  box-shadow: 0 0 0 1px rgba(11, 37, 69, .07);
`;
const Wert = styled.p`font-family: var(--font-display); font-weight: 800; font-size: 1.45rem; line-height: 1.1; margin: 0; color: var(--color-primary);`;
const Label = styled.p`font-family: var(--font-body); font-size: .72rem; color: var(--color-text-muted); margin: 3px 0 0;`;
const Delta = styled.p`font-family: var(--font-body); font-size: .72rem; margin: 4px 0 0; color: var(--color-text);`;

function KpiKarte({ kpi }) {
  const v = kpi.veraenderung;
  let richtung = null;
  if (v != null && v !== 0) {
    const besser = kpi.kleinerIstBesser ? v < 0 : v > 0;
    richtung = `${v > 0 ? '▲' : '▼'} ${fmt1.format(Math.abs(v))} % ${besser ? 'besser' : 'schlechter'}`;
  }
  return (
    <Karte data-testid="analyse-kpi" title={`Vorperiode: ${formatiere(kpi.vorher, kpi.format)}`}>
      <Wert>{formatiere(kpi.wert, kpi.format)}</Wert>
      <Label>{kpi.label}</Label>
      <Delta>{richtung ?? (v === 0 ? 'unverändert' : 'kein Vergleich')}</Delta>
    </Karte>
  );
}

/* ── Verlauf: eine Reihe, Hover-Wert ── */
const DiagrammHuelle = styled.div`padding: 14px 18px 8px; position: relative;`;
const Tip = styled.div`
  position: absolute; pointer-events: none; transform: translate(-50%, -100%);
  background: var(--color-primary); color: #fff; border-radius: 6px; padding: 4px 8px;
  font-family: var(--font-body); font-size: .72rem; white-space: nowrap;
`;

export function Verlauf({ punkte, feld, titel, testid }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  if (!punkte?.length) return <Leer>Keine Daten im Zeitraum.</Leer>;
  const B = 640; const H = 140; const R = 0;
  const max = Math.max(1, ...punkte.map((p) => p[feld]));
  const x = (i) => (punkte.length === 1 ? B / 2 : R + (i * (B - 2 * R)) / (punkte.length - 1));
  const y = (v) => H - 4 - (v / max) * (H - 10);
  const linie = punkte.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[feld]).toFixed(1)}`).join(' ');
  const flaeche = `${linie} L${x(punkte.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const bewege = (e) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const rel = ((e.clientX - box.left) / box.width) * B;
    let best = 0;
    punkte.forEach((_, i) => { if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i; });
    setHover(best);
  };
  return (
    <DiagrammHuelle data-testid={testid}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7785', fontFamily: 'var(--font-body)' }}>
        <span>max. {fmt.format(max)} {titel}</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${B} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={`${titel} je Tag`}
        onMouseMove={bewege} onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1="0" x2={B} y1={y(max * t)} y2={y(max * t)} stroke="rgba(11,37,69,.08)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={flaeche} fill="rgba(11,37,69,.06)" />
        <path d={linie} fill="none" stroke="var(--color-primary, #0b2545)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="rgba(11,37,69,.45)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7785', fontFamily: 'var(--font-body)' }}>
        <span>{tag(punkte[0].datum)}</span><span>{tag(punkte[punkte.length - 1].datum)}</span>
      </div>
      {hover != null && (
        <Tip style={{ left: `calc(18px + (100% - 36px) * ${(x(hover) / B).toFixed(4)})`, top: 34 }}>
          {tag(punkte[hover].datum)} · {fmt.format(punkte[hover][feld])} {titel}
        </Tip>
      )}
    </DiagrammHuelle>
  );
}

/* ── Balken fuer Funnel (eine Farbe, Text in Tinte) ── */
const Stufe = styled.div`
  display: grid; grid-template-columns: minmax(150px, 220px) 1fr 70px; gap: 10px; align-items: center;
  padding: 7px 18px; font-family: var(--font-body); font-size: .84rem;
  @media (max-width: 600px) {
    grid-template-columns: 1fr auto; grid-template-areas: 'label wert' 'balken balken'; row-gap: 4px;
    .label { grid-area: label; } .balken { grid-area: balken; } .wert { grid-area: wert; }
  }
`;
const Spur = styled.div`height: 10px; border-radius: 4px; background: rgba(11,37,69,.06); overflow: hidden;`;
const Balken = styled.div`height: 100%; border-radius: 4px; background: var(--color-primary, #0b2545);`;

function Funnel({ stufen, testid }) {
  const max = Math.max(1, ...stufen.map((s) => s.anzahl));
  return (
    <div data-testid={testid} style={{ padding: '8px 0 12px' }}>
      {stufen.map((s, i) => {
        const vorher = i > 0 ? stufen[i - 1].anzahl : null;
        const quote = vorher ? Math.round((s.anzahl / vorher) * 100) : null;
        return (
          <Stufe key={s.label}>
            <span className="label">{s.label}</span>
            <Spur className="balken" aria-hidden="true"><Balken style={{ width: `${(s.anzahl / max) * 100}%` }} /></Spur>
            <span className="wert" style={{ textAlign: 'right', fontWeight: 700 }} title={quote != null ? `${quote} % der vorherigen Stufe` : undefined}>
              {fmt.format(s.anzahl)}{quote != null && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}> · {quote} %</span>}
            </span>
          </Stufe>
        );
      })}
    </div>
  );
}

function Zustand({ quelle, name }) {
  if (quelle?.status === 'nicht_konfiguriert') {
    return (
      <Leer data-testid={`analyse-${name}-nicht-eingerichtet`}>
        Noch nicht eingerichtet. Fehlende Secrets in Supabase: {quelle.fehlt.map((f) => <code key={f} style={{ marginRight: 6 }}>{f}</code>)}
      </Leer>
    );
  }
  if (quelle?.status === 'fehler') {
    return <Leer data-testid={`analyse-${name}-fehler`}>Konnte nicht geladen werden (Code {quelle.code}). Zugriffsrechte des Service Accounts prüfen.</Leer>;
  }
  return null;
}

const Spalten = styled.div`
  display: grid; gap: 18px; grid-template-columns: 1fr 1fr;
  @media (max-width: 1099px) { grid-template-columns: 1fr; }
  > * { margin: 0; min-width: 0; }
`;

function Rangliste({ zeilen, spalten, testid, leer = 'Keine Daten im Zeitraum.' }) {
  if (!zeilen?.length) return <Leer>{leer}</Leer>;
  return (
    <ResponsiveTabelle data-testid={testid}>
      <thead><tr>{spalten.map((s) => <th key={s.label} style={s.rechts ? { textAlign: 'right' } : undefined}>{s.label}</th>)}</tr></thead>
      <tbody>
        {zeilen.map((z, i) => (
          <tr key={i}>
            {spalten.map((s) => (
              <td key={s.label} data-label={s.label} style={s.rechts ? { textAlign: 'right', whiteSpace: 'nowrap' } : { wordBreak: 'break-word' }}>
                {s.wert(z)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </ResponsiveTabelle>
  );
}

export default function Analyse({ rufeAdminOps }) {
  const [zeitraum, setZeitraum] = useState(STANDARD_ZEITRAUM);
  const [daten, setDaten] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');

  const lade = useCallback(async (z) => {
    setLaeuft(true); setFehler('');
    try { setDaten(await rufeAdminOps('analytics_overview', { zeitraum: z })); }
    catch (err) { setFehler(err.message || 'Analyse konnte nicht geladen werden.'); }
    finally { setLaeuft(false); }
  }, [rufeAdminOps]);

  useEffect(() => { lade(zeitraum); }, [lade, zeitraum]);

  const ga = daten?.ga4?.status === 'ok' ? daten.ga4.daten : null;
  const gsc = daten?.gsc?.status === 'ok' ? daten.gsc.daten : null;
  const produkt = daten?.produkt?.status === 'ok' ? daten.produkt.daten : null;
  const z = daten?.zeitraum;

  return (
    <div data-testid="analyse">
      <Leiste role="group" aria-label="Zeitraum">
        {ZEITRAEUME.map((t) => (
          <Wahl key={t} type="button" $aktiv={t === zeitraum} aria-pressed={t === zeitraum} onClick={() => setZeitraum(t)} data-testid={`analyse-zeitraum-${t}`}>
            {t} Tage
          </Wahl>
        ))}
        <Knopf className="ghost" type="button" onClick={() => lade(zeitraum)} disabled={laeuft}>{laeuft ? 'Lädt …' : 'Aktualisieren'}</Knopf>
      </Leiste>
      {z && (
        <Hinweis>
          Website: {tag(z.aktuell.start)}–{tag(z.aktuell.end)} (volle Tage bis gestern) · Google-Suche: {tag(z.gsc.start)}–{tag(z.gsc.end)} (Search Console liefert die letzten 3 Tage unvollständig) · Vergleich mit dem gleich langen Zeitraum davor.
        </Hinweis>
      )}
      {fehler && <Leer data-testid="analyse-fehler">{fehler}</Leer>}

      {/* 1 — Produkt-Funnel: vollstaendig, unabhaengig von Einwilligung */}
      <Flaeche data-testid="analyse-produkt">
        <FlaecheKopf>
          <h2>Produkt-Funnel</h2>
          <Chip $ton="info" title="Aus der eigenen Datenbank — vollständig, unabhängig von der Cookie-Einwilligung">Datenbank · vollständig</Chip>
        </FlaecheKopf>
        <Zustand quelle={daten?.produkt} name="produkt" />
        {produkt && (
          <>
            <Hinweis style={{ padding: '10px 18px 0', margin: 0 }}>Konten, die im Zeitraum angelegt wurden — und wie weit sie heute sind.</Hinweis>
            <Funnel stufen={produkt} testid="analyse-produkt-funnel" />
          </>
        )}
      </Flaeche>

      {/* 2 — Website (GA4) */}
      <Flaeche data-testid="analyse-ga4">
        <FlaecheKopf>
          <h2>Website</h2>
          <Chip $ton="warn" title="Nur Besucher, die der Messung zugestimmt haben">GA4 · nur mit Einwilligung</Chip>
        </FlaecheKopf>
        <Zustand quelle={daten?.ga4} name="ga4" />
        {ga && (
          <>
            <div style={{ padding: '14px 18px 0' }}>
              <KpiReihe>{ga.kpis.map((k) => <KpiKarte key={k.label} kpi={k} />)}</KpiReihe>
            </div>
            <Verlauf punkte={ga.verlauf} feld="nutzer" titel="Nutzer" testid="analyse-ga4-verlauf" />
            <Hinweis style={{ padding: '0 18px', margin: '8px 0 0' }}>Funnel (Ereignisse aus GA4 · Anzahl · Anteil der vorherigen Stufe)</Hinweis>
            <Funnel stufen={ga.funnel.map((f) => ({ label: f.label, anzahl: f.anzahl }))} testid="analyse-ga4-funnel" />
            <Spalten style={{ padding: '0 0 6px' }}>
              <Rangliste testid="analyse-ga4-seiten" zeilen={ga.seiten} spalten={[
                { label: 'Seite', wert: (r) => r.pfad },
                { label: 'Aufrufe', rechts: true, wert: (r) => fmt.format(r.aufrufe) },
                { label: 'Nutzer', rechts: true, wert: (r) => fmt.format(r.nutzer) },
              ]} />
              <Rangliste testid="analyse-ga4-kanaele" zeilen={ga.kanaele} spalten={[
                { label: 'Herkunft', wert: (r) => r.kanal },
                { label: 'Sitzungen', rechts: true, wert: (r) => fmt.format(r.sitzungen) },
                { label: 'Nutzer', rechts: true, wert: (r) => fmt.format(r.nutzer) },
              ]} />
            </Spalten>
            {ga.geraete?.length > 0 && (
              <Hinweis style={{ padding: '6px 18px 14px', margin: 0 }} data-testid="analyse-ga4-geraete">
                Geräte: {ga.geraete.map((g) => `${g.geraet} ${fmt.format(g.nutzer)}`).join(' · ')}
              </Hinweis>
            )}
          </>
        )}
      </Flaeche>

      {/* 3 — Google-Suche (GSC) */}
      <Flaeche data-testid="analyse-gsc">
        <FlaecheKopf>
          <h2>Google-Suche</h2>
          <Chip $ton="neutral">Search Console</Chip>
        </FlaecheKopf>
        <Zustand quelle={daten?.gsc} name="gsc" />
        {gsc && (
          <>
            <div style={{ padding: '14px 18px 0' }}>
              <KpiReihe>{gsc.kpis.map((k) => <KpiKarte key={k.label} kpi={k} />)}</KpiReihe>
            </div>
            <Verlauf punkte={gsc.verlauf} feld="klicks" titel="Klicks" testid="analyse-gsc-verlauf" />
            <Spalten style={{ padding: '0 0 6px' }}>
              <Rangliste testid="analyse-gsc-anfragen" zeilen={gsc.anfragen} spalten={[
                { label: 'Suchanfrage', wert: (r) => r.anfrage },
                { label: 'Klicks', rechts: true, wert: (r) => fmt.format(r.klicks) },
                { label: 'Impr.', rechts: true, wert: (r) => fmt.format(r.impressionen) },
                { label: 'Pos.', rechts: true, wert: (r) => fmt1.format(r.position) },
              ]} />
              <Rangliste testid="analyse-gsc-seiten" zeilen={gsc.seiten} spalten={[
                { label: 'Seite', wert: (r) => r.seite },
                { label: 'Klicks', rechts: true, wert: (r) => fmt.format(r.klicks) },
                { label: 'Impr.', rechts: true, wert: (r) => fmt.format(r.impressionen) },
                { label: 'Pos.', rechts: true, wert: (r) => fmt1.format(r.position) },
              ]} />
            </Spalten>
          </>
        )}
      </Flaeche>
    </div>
  );
}
