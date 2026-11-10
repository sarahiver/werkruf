import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { Upload, X, CheckCircle, AlertTriangle, Download } from 'lucide-react';
import {
  csvZuZeilen, neueImportId, IMPORT_REITER, IMPORT_STATUS_TEXT, zeilenFuerReiter, standardReiter,
  MAX_DATEI_BYTES, MAX_ZEILEN, CSV_VORLAGE_KOPF,
} from '../../utils/akquiseImport';
import { Flaeche, FlaecheKopf, Knopf, Chip } from './adminUi';

/* ─────────────────────────────────────────────────────────────────
   CSV-Import (WP16.1) — fokussierter Ablauf im Akquise-Bereich.

     1 Datei waehlen   → nur lesen + Kopfzeile pruefen (schreibt nichts)
     2 Vorschau        → Server (acquisition_import mode preview) dedupliziert
     3 Bestaetigen     → Server (mode commit, dieselbe Import-ID) legt NUR neue an
     4 Ergebnis        → „Neue Leads anzeigen" (Filter auf diesen Import)

   Kein Versandknopf. Moegliche Dubletten werden nicht angelegt — der
   Admin entscheidet einzeln ueber „Lead anlegen". Die Import-ID entsteht
   mit der Vorschau; ein zweiter Klick auf Importieren liefert dasselbe
   Ergebnis (Server-Idempotenz), keine Dubletten.
───────────────────────────────────────────────────────────────── */

const Rumpf = styled.div`padding: 16px 18px 18px; font-family: var(--font-body); font-size: .86rem; color: var(--color-text);`;
const Hinweis = styled.p`margin: 0 0 12px; color: var(--color-text-muted); font-size: .8rem; line-height: 1.5; code { font-size: .74rem; word-break: break-all; }`;
const Datei = styled.label`
  display: flex; align-items: center; justify-content: center; gap: 10px; padding: 22px 16px; cursor: pointer;
  border: 2px dashed rgba(11,37,69,.18); border-radius: 10px; background: #F7F8FA; color: var(--color-primary); font-weight: 700;
  input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  &:focus-within { outline: 3px solid rgba(242,140,40,.55); outline-offset: 2px; }
`;
const Summen = styled.div`display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px;`;
const Summe = styled.div`
  min-width: 96px; padding: 8px 12px; border-radius: 8px; background: #F7F8FA;
  strong { display: block; font-family: var(--font-display); font-size: 1.25rem; line-height: 1.1; color: ${({ $ton }) => ({ gut: '#1E6B34', warn: '#7A5A00', schlecht: '#B42318' }[$ton] || 'var(--color-primary)')}; }
  span { font-size: .72rem; color: var(--color-text-muted); }
`;
const Reiter = styled.div`
  display: flex; gap: 4px; overflow-x: auto; margin: 0 0 10px; border-bottom: 1px solid rgba(11,37,69,.08);
  button { background: none; border: 0; border-bottom: 3px solid transparent; padding: 8px 10px; cursor: pointer; white-space: nowrap;
           font-family: var(--font-body); font-size: .82rem; font-weight: 600; color: var(--color-text-muted); }
  button[aria-selected='true'] { color: var(--color-primary); font-weight: 800; border-bottom-color: var(--color-accent); }
`;
const Zeilen = styled.ol`
  list-style: none; margin: 0; padding: 0; max-height: 340px; overflow: auto;
  li { display: grid; grid-template-columns: 52px minmax(0, 1.3fr) minmax(0, 1.3fr) auto; gap: 8px 12px; align-items: baseline;
       padding: 7px 4px; border-bottom: 1px solid rgba(11,37,69,.06); font-size: .8rem; }
  li .grund { grid-column: 2 / -1; color: var(--color-text-muted); font-size: .76rem; }
  @media (max-width: 640px) { li { grid-template-columns: 44px minmax(0, 1fr) auto; } li .mail { grid-column: 2 / -1; } }
  .nr { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
  .name, .mail { overflow-wrap: anywhere; }
`;
const Fehler = styled.p`color: #B42318; font-weight: 600; margin: 10px 0 0;`;

/* File.text() fehlt in aelteren Browsern — FileReader als Rueckfall. */
function leseDatei(datei) {
  if (typeof datei.text === 'function') return datei.text();
  return new Promise((ok, nein) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result ?? ''));
    r.onerror = () => nein(r.error);
    r.readAsText(datei, 'utf-8');
  });
}

const TON = { new: 'gut', duplicate: 'neutral', duplicate_in_import: 'neutral', possible_duplicate: 'warn', invalid: 'schlecht' };
const MAX_ANZEIGE = 100;

/**
 * @param {object} props
 * @param {(action: string, params?: object) => Promise<any>} props.rufeAdminOps
 * @param {() => void} props.onSchliessen
 * @param {(importId: string) => void} props.onNeueAnzeigen
 */
export default function AkquiseImport({ rufeAdminOps, onSchliessen, onNeueAnzeigen }) {
  const [schritt, setSchritt] = useState('datei');     // datei | vorschau | ergebnis
  const [dateiname, setDateiname] = useState('');
  const [zeilen, setZeilen] = useState(null);          // geparste Rohzeilen (fuer commit erneut gesendet)
  const [unbekannt, setUnbekannt] = useState([]);
  const [importId, setImportId] = useState(null);
  const [vorschau, setVorschau] = useState(null);
  const [ergebnis, setErgebnis] = useState(null);
  const [reiter, setReiter] = useState('neu');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  /* Doppelklick-Schutz unabhaengig vom Render-Zeitpunkt; der Server ist
     ueber die Import-ID ohnehin idempotent. */
  const sperre = useRef(false);

  const vorlage = `data:text/csv;charset=utf-8,${encodeURIComponent(`${CSV_VORLAGE_KOPF}\r\n`)}`;

  const waehleDatei = async (e) => {
    const datei = e.target.files?.[0];
    e.target.value = '';
    if (!datei) return;
    setFehler(''); setDateiname(datei.name);
    if (datei.size > MAX_DATEI_BYTES) { setFehler(`Die Datei ist zu groß (höchstens ${Math.round(MAX_DATEI_BYTES / 1024 / 1024)} MB).`); return; }
    let text;
    try { text = await leseDatei(datei); } catch { setFehler('Die Datei konnte nicht gelesen werden.'); return; }
    const p = csvZuZeilen(text);
    if (!p.ok) { setFehler(p.fehler); return; }
    setZeilen(p.zeilen); setUnbekannt(p.unbekannteSpalten);
    const id = neueImportId();
    setImportId(id);
    setLaeuft(true);
    try {
      const r = await rufeAdminOps('acquisition_import', { mode: 'preview', importId: id, rows: p.zeilen });
      setVorschau(r); setReiter(standardReiter(r?.counts)); setSchritt('vorschau');
    } catch (err) { setFehler(err.message || 'Die Vorschau ist fehlgeschlagen.'); }
    finally { setLaeuft(false); }
  };

  const importiere = async () => {
    if (sperre.current || laeuft || !zeilen || !importId) return;
    sperre.current = true; setLaeuft(true); setFehler('');
    try {
      const r = await rufeAdminOps('acquisition_import', { mode: 'commit', importId, rows: zeilen });
      setErgebnis(r); setSchritt('ergebnis');
    } catch (err) { setFehler(err.message || 'Der Import ist fehlgeschlagen.'); }
    finally { sperre.current = false; setLaeuft(false); }
  };

  const c = vorschau?.counts || {};
  const dubletten = (c.duplicate ?? 0) + (c.duplicateInImport ?? 0);
  const sichtbar = zeilenFuerReiter(vorschau?.rows, reiter);
  const reiterZahl = (key) => (key === 'alle' ? c.rows : key === 'neu' ? c.new : key === 'dubletten' ? dubletten : key === 'pruefen' ? c.possibleDuplicate : c.invalid) ?? 0;

  return (
    <Flaeche data-testid="akquise-import">
      <FlaecheKopf>
        <h2><Upload size={14} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />CSV importieren{dateiname ? ` — ${dateiname}` : ''}</h2>
        <Knopf type="button" className="ghost" onClick={onSchliessen} aria-label="Import schließen" disabled={laeuft}><X size={13} /> Schließen</Knopf>
      </FlaecheKopf>
      <Rumpf>
        {schritt === 'datei' && (
          <>
            <Hinweis>
              Pflichtspalten <strong>company_name</strong> und <strong>email</strong>. Weitere: contact_person, phone, trade, city, website, google_profile_url, personalized_sentence, note, source.
              Die Spalten import_status, imported_at, werkruf_lead_id werden ignoriert. Komma oder Semikolon, UTF-8, höchstens {MAX_ZEILEN} Zeilen.
              Die Datei wird zuerst nur geprüft — angelegt wird erst nach deiner Bestätigung, und nur neue Leads. Es wird keine Mail verschickt.
            </Hinweis>
            <Datei>
              <input type="file" accept=".csv,text/csv" onChange={waehleDatei} disabled={laeuft} data-testid="import-datei" aria-label="CSV-Datei auswählen" />
              <Upload size={18} /> {laeuft ? 'Wird geprüft …' : 'CSV-Datei auswählen'}
            </Datei>
            <p style={{ margin: '10px 0 0', fontSize: '.78rem' }}>
              <a href={vorlage} download="werkruf-akquise-vorlage.csv"><Download size={12} style={{ verticalAlign: 'middle' }} /> Vorlage herunterladen</a>
            </p>
          </>
        )}

        {schritt === 'vorschau' && vorschau && (
          <div data-testid="import-vorschau">
            <Hinweis><strong>{c.rows}</strong> Zeilen erkannt. Noch ist nichts gespeichert.</Hinweis>
            <Summen data-testid="import-summen">
              <Summe $ton="gut"><strong>{c.new ?? 0}</strong><span>Neu</span></Summe>
              <Summe><strong>{dubletten}</strong><span>Dubletten</span></Summe>
              <Summe $ton="warn"><strong>{c.possibleDuplicate ?? 0}</strong><span>Prüfen</span></Summe>
              <Summe $ton="schlecht"><strong>{c.invalid ?? 0}</strong><span>Fehler</span></Summe>
            </Summen>
            {unbekannt.length > 0 && <Hinweis data-testid="import-unbekannt">Ignorierte Spalten: {unbekannt.join(', ')}</Hinweis>}
            <Reiter role="tablist" aria-label="Zeilen filtern">
              {IMPORT_REITER.map((r) => (
                <button key={r.key} type="button" role="tab" aria-selected={reiter === r.key} onClick={() => setReiter(r.key)} data-testid={`import-reiter-${r.key}`}>
                  {r.label} ({reiterZahl(r.key)})
                </button>
              ))}
            </Reiter>
            {sichtbar.length === 0 ? <Hinweis>Keine Zeilen in diesem Reiter.</Hinweis> : (
              <Zeilen data-testid="import-zeilen">
                {sichtbar.slice(0, MAX_ANZEIGE).map((z) => (
                  <li key={z.i}>
                    <span className="nr">Z. {z.i}</span>
                    <span className="name">{z.companyName || '—'}</span>
                    <span className="mail">{z.email || '—'}</span>
                    <Chip $ton={TON[z.status]}>{IMPORT_STATUS_TEXT[z.status] || z.status}</Chip>
                    {z.grund && <span className="grund">{z.grund}</span>}
                  </li>
                ))}
              </Zeilen>
            )}
            {sichtbar.length > MAX_ANZEIGE && <Hinweis style={{ marginTop: 8 }}>… und {sichtbar.length - MAX_ANZEIGE} weitere.</Hinweis>}
            {(c.possibleDuplicate ?? 0) > 0 && (
              <Hinweis style={{ marginTop: 10 }}><AlertTriangle size={12} style={{ verticalAlign: 'middle' }} /> Mögliche Dubletten (gleiche Website oder gleiches Google-Profil) werden nicht importiert. Bei Bedarf einzeln über „Lead anlegen" erfassen.</Hinweis>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <Knopf type="button" className="akzent" onClick={importiere} disabled={laeuft || !(c.new > 0)} data-testid="import-commit">
                {laeuft ? 'Wird importiert …' : `${c.new ?? 0} ${c.new === 1 ? 'Lead' : 'Leads'} importieren`}
              </Knopf>
              <Knopf type="button" className="ghost" onClick={onSchliessen} disabled={laeuft}>Abbrechen</Knopf>
            </div>
          </div>
        )}

        {schritt === 'ergebnis' && ergebnis && (
          <div data-testid="import-ergebnis">
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: 'var(--color-primary)', margin: '0 0 10px' }}>
              <CheckCircle size={18} color="#1E7E34" /> Import abgeschlossen
            </p>
            <ul style={{ margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.7 }}>
              <li><strong>{ergebnis.counts?.new ?? 0}</strong> Leads angelegt (Status „Neu")</li>
              <li><strong>{(ergebnis.counts?.duplicate ?? 0) + (ergebnis.counts?.duplicateInImport ?? 0)}</strong> Dubletten übersprungen</li>
              <li><strong>{ergebnis.counts?.possibleDuplicate ?? 0}</strong> mögliche Dubletten nicht importiert</li>
              <li><strong>{ergebnis.counts?.invalid ?? 0}</strong> fehlerhafte Zeilen</li>
            </ul>
            {ergebnis.reused && <Hinweis>Dieser Import war bereits abgeschlossen — es wurde nichts doppelt angelegt.</Hinweis>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ergebnis.importId && (ergebnis.counts?.new ?? 0) > 0 && (
                <Knopf type="button" onClick={() => onNeueAnzeigen(ergebnis.importId)} data-testid="import-neue-anzeigen">Neue Leads anzeigen</Knopf>
              )}
              <Knopf type="button" className="ghost" onClick={onSchliessen}>Schließen</Knopf>
            </div>
          </div>
        )}

        {fehler && <Fehler role="alert" data-testid="import-fehler">{fehler}</Fehler>}
      </Rumpf>
    </Flaeche>
  );
}
