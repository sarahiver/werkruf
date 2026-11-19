import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Globe, Loader, Sparkles, Plus, Trash2, ExternalLink, Check, Upload, Smartphone, Monitor } from 'lucide-react';
import ProGate from '../../components/dashboard/ProGate';
import supabase from '../../supabaseClient';
import { bestimmeZielstandort, uploadToCloudinary } from './DashboardFotos';
import {
  WEBSITE_FARBEN, GRENZEN, RECHTSFORMEN, IMPRESSUM_FELDER, WEBSITE_GRUND_TEXT, pruefeImpressum,
} from '../../utils/website';

/*
 * Deine Website (Branch feat/website-aus-google-profil).
 *
 * Eine feste Vorlage. Der Betrieb waehlt Farbe, Logo, Titelbild, prueft
 * Texte und Leistungen, blendet Fotos aus und fuellt das Impressum.
 * Name, Telefon, Adresse, Oeffnungszeiten, Fotos und Bewertungen kommen
 * live aus dem Google-Profil. Gespeichert und gerendert wird ueber die
 * Edge Function `website`; die Vorschau ist dieselbe Vorlage wie die
 * oeffentliche Seite.
 */

const Seite = styled.div`max-width: 1180px;`;
const Kopf = styled.div`margin-bottom: 18px;`;
const H1 = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight); text-transform: var(--text-transform);
  color: var(--color-primary); font-size: clamp(1.4rem, 4vw, 1.8rem); margin: 0 0 6px;
  display: flex; align-items: center; gap: 10px; svg { color: var(--color-accent); }
`;
const Unter = styled.p`font-family: var(--font-body); color: var(--color-text-muted); margin: 0; font-size: .92rem; line-height: 1.5;`;
const Spalten = styled.div`
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 20px; align-items: start;
  @media (max-width: 1050px) { grid-template-columns: minmax(0, 1fr); }
`;
const Karte = styled.section`
  background: var(--color-white); border: 1px solid var(--color-border); border-radius: var(--radius-card);
  padding: 18px 18px 20px; margin-bottom: 16px; min-width: 0;
`;
const KTitel = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight); text-transform: var(--text-transform);
  font-size: 1rem; color: var(--color-primary); margin: 0 0 12px; display: flex; align-items: center; gap: 8px;
  span.n { display: inline-flex; width: 24px; height: 24px; border-radius: 50%; background: var(--color-accent); color: #fff; align-items: center; justify-content: center; font-size: .8rem; }
`;
const Label = styled.label`display: block; font-family: var(--font-body); font-size: .8rem; color: var(--color-text-muted); margin: 12px 0 4px;`;
const Eingabe = styled.input`
  width: 100%; padding: 11px 12px; border: 1px solid var(--color-border); border-radius: 10px; min-height: 44px;
  font-family: var(--font-body); font-size: 16px; color: var(--color-text); background: #fff;
  &[aria-invalid="true"] { border-color: #D93025; }
`;
const Auswahl = styled.select`
  width: 100%; padding: 11px 12px; border: 1px solid var(--color-border); border-radius: 10px; min-height: 44px;
  font-family: var(--font-body); font-size: 16px; background: #fff;
  &[aria-invalid="true"] { border-color: #D93025; }
`;
const Area = styled.textarea`
  width: 100%; min-height: 96px; padding: 11px 12px; border: 1px solid var(--color-border); border-radius: 10px;
  font-family: var(--font-body); font-size: 16px; line-height: 1.5; resize: vertical;
`;
const Knopf = styled.button`
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 16px;
  border-radius: var(--radius-button); cursor: pointer; font-family: var(--font-body); font-size: .9rem; font-weight: 700;
  background: var(--color-primary); color: #fff; border: 1px solid var(--color-primary);
  &:disabled { opacity: .55; cursor: default; }
  &.ghost { background: #fff; color: var(--color-primary); border-color: var(--color-border); }
  &.akzent { background: var(--color-accent); border-color: var(--color-accent); }
`;
const Zeile = styled.div`display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px;`;
const Farben = styled.div`display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px;`;
const FarbKnopf = styled.button`
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 6px; border-radius: 10px; cursor: pointer;
  background: #fff; border: 2px solid ${(p) => (p.$aktiv ? 'var(--color-accent)' : 'var(--color-border)')};
  font-family: var(--font-body); font-size: .78rem; color: var(--color-text);
  i { display: flex; width: 44px; height: 22px; border-radius: 6px; overflow: hidden; }
  i b { flex: 2; } i s { flex: 1; text-decoration: none; }
`;
const Fotos = styled.div`display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px;`;
const FotoKachel = styled.button`
  position: relative; padding: 0; border-radius: 10px; overflow: hidden; cursor: pointer; aspect-ratio: 1; background: #eee;
  border: 3px solid ${(p) => (p.$aktiv ? 'var(--color-accent)' : 'transparent')};
  opacity: ${(p) => (p.$aus ? 0.35 : 1)};
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  em { position: absolute; left: 4px; bottom: 4px; background: rgba(0,0,0,.65); color: #fff; font-style: normal; font-size: .68rem; padding: 2px 6px; border-radius: 4px; }
`;
const Leistung = styled.div`border: 1px solid var(--color-border); border-radius: 10px; padding: 10px; margin-top: 10px;`;
const Hinweis = styled.p`font-family: var(--font-body); font-size: .8rem; line-height: 1.5; color: var(--color-text-muted); margin: 8px 0 0;`;
const Meldung = styled.p`
  font-family: var(--font-body); font-size: .86rem; margin: 10px 0 0; padding: 10px 12px; border-radius: 10px;
  background: ${(p) => (p.$ok ? '#E8F5E9' : '#FDECEA')}; color: ${(p) => (p.$ok ? '#1E7E34' : '#B3261E')};
`;
const Status = styled(Karte)`
  display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
  border-left: 4px solid ${(p) => (p.$live ? '#1E7E34' : 'var(--color-accent)')};
  strong { font-family: var(--font-body); color: var(--color-primary); }
  a { font-family: var(--font-body); font-size: .88rem; word-break: break-all; }
`;
const VorschauKarte = styled(Karte)`
  position: sticky; top: 78px; padding: 12px;
  @media (max-width: 1050px) { position: static; }
`;
const Rahmen = styled.iframe`
  display: block; width: ${(p) => (p.$handy ? '390px' : '100%')}; max-width: 100%; margin: 0 auto;
  height: 720px; border: 1px solid var(--color-border); border-radius: 12px; background: #fff;
  @media (max-width: 600px) { height: 560px; }
`;
const Reiter = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;
  button { min-height: 38px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--color-border); background: #fff; cursor: pointer;
    font-family: var(--font-body); font-size: .82rem; display: inline-flex; align-items: center; gap: 5px; }
  button[aria-pressed="true"] { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
`;
const Leiste = styled.div`
  position: sticky; bottom: 0; z-index: 3; background: var(--color-bg, #f3f4f6); padding: 10px 0 12px;
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
`;

async function rufe(pfad, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Bitte melde dich neu an.');
  let r;
  try {
    r = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/website/${pfad}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* Kein Netz, Function nicht deployt oder CORS: der Browser liefert keine Antwort. */
    throw new Error('Die Website-Funktion ist gerade nicht erreichbar. Bitte versuch es gleich noch einmal.');
  }
  const d = await r.json().catch(() => null);
  if (r.status === 402 || d?.error?.code === 'kein_zugang') throw new Error(WEBSITE_GRUND_TEXT.kein_zugang);
  if (!r.ok && !(d && d.ok === false)) throw new Error('Das hat nicht geklappt. Bitte versuch es noch einmal.');
  return d;
}

export const oeffentlicheAdresse = (slug) => (slug ? `https://werkruf.com/seite/${slug}` : null);

export default function DashboardWebsite({ api = rufe, standortLaden = bestimmeZielstandort, hochladen = uploadToCloudinary }) {
  const [standort, setStandort] = useState(undefined);
  const [werte, setWerte] = useState(null);
  const [info, setInfo] = useState({ slug: null, status: 'entwurf', gespeichert: false });
  const [fotos, setFotos] = useState([]);
  const [html, setHtml] = useState('');
  const [pfad, setPfad] = useState('/');
  const [handy, setHandy] = useState(true);
  const [laeuft, setLaeuft] = useState('laden');
  const [meldung, setMeldung] = useState(null); // {ok, text}
  const [geaendert, setGeaendert] = useState(false);

  const impressum = useMemo(() => pruefeImpressum(werte?.impressum), [werte]);

  const lade = useCallback(async (ort, p = '/') => {
    setLaeuft('laden');
    try {
      const d = await api('laden', { locationId: ort.id, pfad: p });
      setWerte(d.website.werte); setInfo(d.website); setFotos(d.fotos || []); setHtml(d.vorschau || ''); setGeaendert(false);
    } catch (e) { setMeldung({ ok: false, text: e.message }); }
    finally { setLaeuft(null); }
  }, [api]);

  useEffect(() => {
    let aktiv = true;
    standortLaden().then((ort) => { if (!aktiv) return; setStandort(ort); if (ort) lade(ort); else setLaeuft(null); });
    return () => { aktiv = false; };
  }, [standortLaden, lade]);

  const setze = (feld, wert) => { setWerte((w) => ({ ...w, [feld]: wert })); setGeaendert(true); setMeldung(null); };
  const setzeImpressum = (feld, wert) => setze('impressum', { ...(werte.impressum || {}), [feld]: wert });
  const setzeLeistung = (i, feld, wert) => setze('leistungen', werte.leistungen.map((l, j) => (j === i ? { ...l, [feld]: wert } : l)));

  const speichern = async (p = pfad) => {
    setLaeuft('speichern'); setMeldung(null);
    try {
      const d = await api('speichern', { locationId: standort.id, werte, pfad: p });
      if (!d.ok) { setMeldung({ ok: false, text: WEBSITE_GRUND_TEXT[d.grund] || 'Bitte prüf deine Eingaben.' }); return false; }
      setHtml(d.vorschau); setInfo((i) => ({ ...i, slug: d.slug, status: d.status, gespeichert: true })); setGeaendert(false);
      setMeldung({ ok: true, text: d.status === 'veroeffentlicht' ? 'Gespeichert. Die Website zeigt die Änderung in wenigen Minuten.' : 'Gespeichert. Die Vorschau zeigt den neuen Stand.' });
      return true;
    } catch (e) { setMeldung({ ok: false, text: e.message }); return false; }
    finally { setLaeuft(null); }
  };

  const zeigeSeite = async (p) => {
    setPfad(p);
    if (geaendert) { await speichern(p); return; }
    setLaeuft('laden');
    try { const d = await api('laden', { locationId: standort.id, pfad: p }); setHtml(d.vorschau || ''); }
    catch (e) { setMeldung({ ok: false, text: e.message }); }
    finally { setLaeuft(null); }
  };

  const vorschlagen = async () => {
    setLaeuft('texte'); setMeldung(null);
    try {
      const d = await api('texte', { locationId: standort.id, leistungen: werte.leistungen.map((l) => ({ name: l.name })) });
      if (!d.ok) { setMeldung({ ok: false, text: WEBSITE_GRUND_TEXT[d.grund] || WEBSITE_GRUND_TEXT.ungeeignet }); return; }
      const neu = new Map(d.leistungen.map((l) => [l.name, l.text]));
      setWerte((w) => ({
        ...w,
        slogan: d.slogan || w.slogan,
        ueber_text: d.ueber || w.ueber_text,
        leistungen: w.leistungen.map((l) => (neu.has(l.name) ? { ...l, text: neu.get(l.name) } : l)),
      }));
      setGeaendert(true);
      setMeldung({ ok: true, text: 'Vorschlag eingesetzt. Bitte lies die Texte und ändere, was nicht stimmt — dann speichern.' });
    } catch (e) { setMeldung({ ok: false, text: e.message }); }
    finally { setLaeuft(null); }
  };

  const veroeffentlichen = async (an) => {
    if (an && geaendert && !(await speichern())) return;
    setLaeuft('veroeffentlichen'); setMeldung(null);
    try {
      const d = await api('veroeffentlichen', { locationId: standort.id, an });
      if (!d.ok) { setMeldung({ ok: false, text: WEBSITE_GRUND_TEXT[d.grund] || 'Bitte zuerst speichern.' }); return; }
      setInfo((i) => ({ ...i, status: d.status, slug: d.slug }));
      setMeldung({ ok: true, text: an ? 'Deine Website ist online.' : 'Die Website ist offline. Deine Einstellungen bleiben gespeichert.' });
    } catch (e) { setMeldung({ ok: false, text: e.message }); }
    finally { setLaeuft(null); }
  };

  const logoHochladen = async (datei) => {
    if (!datei) return;
    if (datei.size > 5 * 1024 * 1024) { setMeldung({ ok: false, text: 'Das Logo darf höchstens 5 MB groß sein.' }); return; }
    setLaeuft('logo');
    try { const r = await hochladen(datei, supabase); setze('logo_url', r.secure_url); }
    catch { setMeldung({ ok: false, text: 'Das Logo konnte nicht hochgeladen werden.' }); }
    finally { setLaeuft(null); }
  };

  const live = info.status === 'veroeffentlicht';
  const adresse = oeffentlicheAdresse(info.slug);
  const fehlt = new Set([...impressum.fehlend, ...impressum.fehler]);
  const rf = RECHTSFORMEN[werte?.impressum?.rechtsform];
  const sichtbar = (key) => {
    if (key === 'vertreten_durch') return Boolean(rf?.vertretung);
    if (key === 'inhaber') return !rf?.vertretung;
    if (key === 'registergericht' || key === 'registernummer') return Boolean(rf?.register);
    return true;
  };

  return (
    <ProGate feature="Website">
      <Seite data-testid="website-seite">
        <Kopf>
          <H1><Globe size={22} /> Deine Website</H1>
          <Unter>Eine fertige Website aus deinem Google-Profil. Name, Telefon, Adresse, Öffnungszeiten, Fotos und Bewertungen aktualisieren sich von selbst — du wählst nur Aussehen und Texte.</Unter>
        </Kopf>

        {standort === null && <Karte data-testid="website-kein-betrieb"><Unter>Wähle zuerst oben links einen Betrieb aus. Die Website gehört immer zu genau einem Betrieb.</Unter></Karte>}
        {laeuft === 'laden' && !werte && <Karte><Unter><Loader size={14} /> Wird geladen …</Unter></Karte>}
        {/* Ladefehler: vorher stand hier nichts — die Meldung lag im Block,
            der erst nach erfolgreichem Laden erscheint. */}
        {!werte && standort && laeuft !== 'laden' && (
          <Karte data-testid="website-ladefehler">
            <Meldung $ok={false} role="alert" style={{ marginTop: 0 }}>{meldung?.text || 'Die Website-Einstellungen konnten nicht geladen werden.'}</Meldung>
            <Zeile><Knopf type="button" className="ghost" onClick={() => { setMeldung(null); lade(standort); }}>Erneut versuchen</Knopf></Zeile>
          </Karte>
        )}

        {werte && (
          <>
            <Status $live={live} as="section" data-testid="website-status">
              <div>
                <strong>{live ? 'Online' : info.gespeichert ? 'Entwurf — noch nicht online' : 'Noch nicht gespeichert'}</strong>
                {adresse && <div>{live ? <a href={adresse} target="_blank" rel="noopener noreferrer">{adresse} <ExternalLink size={12} /></a> : <Hinweis style={{ margin: 0 }}>Adresse nach dem Veröffentlichen: {adresse}</Hinweis>}</div>}
              </div>
              <Zeile style={{ marginTop: 0 }}>
                {live
                  ? <Knopf type="button" className="ghost" onClick={() => veroeffentlichen(false)} disabled={Boolean(laeuft)} data-testid="website-offline">Offline nehmen</Knopf>
                  : <Knopf type="button" className="akzent" onClick={() => veroeffentlichen(true)} disabled={Boolean(laeuft) || !impressum.ok} data-testid="website-veroeffentlichen">{laeuft === 'veroeffentlichen' ? <Loader size={15} /> : <Check size={15} />} Veröffentlichen</Knopf>}
              </Zeile>
              {!impressum.ok && !live && <Hinweis style={{ flexBasis: '100%' }}>Zum Veröffentlichen fehlt noch das Impressum (Schritt 4).</Hinweis>}
            </Status>

            <Spalten>
              <div>
                <Karte>
                  <KTitel><span className="n">1</span> Aussehen</KTitel>
                  <Label as="div">Farbe</Label>
                  <Farben role="radiogroup" aria-label="Farbe">
                    {Object.entries(WEBSITE_FARBEN).map(([key, f]) => (
                      <FarbKnopf key={key} type="button" role="radio" aria-checked={werte.farbe === key} $aktiv={werte.farbe === key} onClick={() => setze('farbe', key)}>
                        <i><b style={{ background: f.primaer }} /><s style={{ background: f.akzent }} /></i>{f.label}
                      </FarbKnopf>
                    ))}
                  </Farben>
                  <Label as="div">Logo (optional)</Label>
                  <Zeile style={{ marginTop: 0 }}>
                    {werte.logo_url && <img src={werte.logo_url} alt="Dein Logo" style={{ height: 44, maxWidth: 160, objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 8, padding: 4, background: '#fff' }} />}
                    <Knopf as="label" className="ghost" style={{ cursor: 'pointer' }}>
                      {laeuft === 'logo' ? <Loader size={15} /> : <Upload size={15} />} {werte.logo_url ? 'Anderes Logo' : 'Logo hochladen'}
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => logoHochladen(e.target.files?.[0])} data-testid="website-logo" />
                    </Knopf>
                    {werte.logo_url && <Knopf type="button" className="ghost" onClick={() => setze('logo_url', null)}>Entfernen</Knopf>}
                  </Zeile>
                  <Label as="div">Titelbild — tippe auf ein Foto</Label>
                  {fotos.length === 0
                    ? <Hinweis>Noch keine Fotos. Lade unter „Fotos" ein paar Bilder deiner Arbeit hoch — sie erscheinen dann auch hier und auf der Website.</Hinweis>
                    : (
                      <Fotos>
                        {fotos.map((f) => (
                          <FotoKachel key={f.id} type="button" $aktiv={werte.titelbild_id === f.id} aria-pressed={werte.titelbild_id === f.id} onClick={() => setze('titelbild_id', f.id)} aria-label="Als Titelbild wählen">
                            <img src={`${f.url}?w=200`} alt="" loading="lazy" />{werte.titelbild_id === f.id && <em>Titelbild</em>}
                          </FotoKachel>
                        ))}
                      </Fotos>
                    )}
                </Karte>

                <Karte>
                  <KTitel><span className="n">2</span> Texte und Leistungen</KTitel>
                  <Knopf type="button" className="ghost" onClick={vorschlagen} disabled={Boolean(laeuft)} data-testid="website-vorschlag">
                    {laeuft === 'texte' ? <><Loader size={15} /> Texte werden geschrieben …</> : <><Sparkles size={15} /> Texte vorschlagen lassen</>}
                  </Knopf>
                  <Hinweis>Der Vorschlag nutzt nur, was in deinem Google-Profil steht. Prüf ihn trotzdem — veröffentlicht wird genau dein Text.</Hinweis>
                  <Label htmlFor="w-slogan">Kurzer Satz unter dem Namen</Label>
                  <Eingabe id="w-slogan" value={werte.slogan} maxLength={GRENZEN.slogan} onChange={(e) => setze('slogan', e.target.value)} placeholder="z. B. Ihr Elektriker für Hamburg-Nord" />
                  <Label htmlFor="w-ueber">Über uns</Label>
                  <Area id="w-ueber" value={werte.ueber_text} maxLength={GRENZEN.ueber} onChange={(e) => setze('ueber_text', e.target.value)} />
                  <Label as="div">Leistungen ({werte.leistungen.length}/{GRENZEN.leistungen})</Label>
                  {werte.leistungen.map((l, i) => (
                    <Leistung key={i}>
                      <Zeile style={{ marginTop: 0, flexWrap: 'nowrap' }}>
                        <Eingabe aria-label={`Leistung ${i + 1}`} value={l.name} maxLength={GRENZEN.leistungName} onChange={(e) => setzeLeistung(i, 'name', e.target.value)} />
                        <Knopf type="button" className="ghost" aria-label={`Leistung ${i + 1} entfernen`} onClick={() => setze('leistungen', werte.leistungen.filter((_, j) => j !== i))}><Trash2 size={15} /></Knopf>
                      </Zeile>
                      <Area aria-label={`Beschreibung Leistung ${i + 1}`} style={{ marginTop: 8, minHeight: 70 }} value={l.text} maxLength={GRENZEN.leistungText} onChange={(e) => setzeLeistung(i, 'text', e.target.value)} placeholder="Ein bis zwei Sätze, was Sie dabei für Kunden tun." />
                    </Leistung>
                  ))}
                  {werte.leistungen.length < GRENZEN.leistungen && (
                    <Zeile><Knopf type="button" className="ghost" onClick={() => setze('leistungen', [...werte.leistungen, { name: '', text: '' }])}><Plus size={15} /> Leistung hinzufügen</Knopf></Zeile>
                  )}
                </Karte>

                <Karte>
                  <KTitel><span className="n">3</span> Fotos und Bewertungen</KTitel>
                  {fotos.length > 0 && (
                    <>
                      <Hinweis style={{ marginTop: 0 }}>Tippe auf ein Foto, um es auf der Website aus- oder wieder einzublenden.</Hinweis>
                      <Fotos style={{ marginTop: 8 }}>
                        {fotos.map((f) => {
                          const aus = werte.fotos_aus.includes(f.id);
                          return (
                            <FotoKachel key={f.id} type="button" $aus={aus} aria-pressed={!aus} aria-label={aus ? 'Foto einblenden' : 'Foto ausblenden'}
                              onClick={() => setze('fotos_aus', aus ? werte.fotos_aus.filter((x) => x !== f.id) : [...werte.fotos_aus, f.id])}>
                              <img src={`${f.url}?w=200`} alt="" loading="lazy" />{aus && <em>ausgeblendet</em>}
                            </FotoKachel>
                          );
                        })}
                      </Fotos>
                    </>
                  )}
                  <Label as="label" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={werte.bewertungen_zeigen} onChange={(e) => setze('bewertungen_zeigen', e.target.checked)} style={{ width: 20, height: 20 }} />
                    Google-Bewertungen zeigen (die neuesten mit Text, ungefiltert)
                  </Label>
                </Karte>

                <Karte>
                  <KTitel><span className="n">4</span> Kontakt und Impressum</KTitel>
                  <Label htmlFor="w-mail">E-Mail für Anfragen (steht auf der Website)</Label>
                  <Eingabe id="w-mail" type="email" inputMode="email" value={werte.kontakt_email} onChange={(e) => setze('kontakt_email', e.target.value)} placeholder="info@ihr-betrieb.de" />
                  <Hinweis>Das Impressum ist Pflicht. Wir setzen deine Angaben in eine Vorlage — die Angaben selbst verantwortest du. Keine Rechtsberatung.</Hinweis>
                  {IMPRESSUM_FELDER.filter((f) => sichtbar(f.key)).map((f) => (
                    <div key={f.key}>
                      <Label htmlFor={`imp-${f.key}`}>{f.label}{fehlt.has(f.key) ? ' *' : ''}</Label>
                      {f.key === 'rechtsform' ? (
                        <Auswahl id={`imp-${f.key}`} value={werte.impressum?.rechtsform || ''} aria-invalid={fehlt.has(f.key)} onChange={(e) => setzeImpressum('rechtsform', e.target.value)}>
                          <option value="">Bitte wählen</option>
                          {Object.entries(RECHTSFORMEN).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                        </Auswahl>
                      ) : (
                        <Eingabe id={`imp-${f.key}`} value={werte.impressum?.[f.key] || ''} aria-invalid={fehlt.has(f.key)}
                          inputMode={f.key === 'plz' ? 'numeric' : f.key === 'telefon' ? 'tel' : f.key === 'email' ? 'email' : undefined}
                          onChange={(e) => setzeImpressum(f.key, e.target.value)} />
                      )}
                    </div>
                  ))}
                  {!impressum.ok && <Hinweis data-testid="impressum-fehlt">Noch offen: {[...fehlt].map((k) => IMPRESSUM_FELDER.find((f) => f.key === k)?.label.split(' (')[0]).join(', ')}.</Hinweis>}
                </Karte>

                <Leiste>
                  <Knopf type="button" onClick={() => speichern()} disabled={Boolean(laeuft) || !geaendert} data-testid="website-speichern">
                    {laeuft === 'speichern' ? <Loader size={15} /> : <Check size={15} />} Speichern
                  </Knopf>
                  {geaendert && <Hinweis style={{ margin: 0 }}>Ungespeicherte Änderungen</Hinweis>}
                </Leiste>
                {meldung && <Meldung $ok={meldung.ok} role={meldung.ok ? 'status' : 'alert'} data-testid="website-meldung">{meldung.text}</Meldung>}
              </div>

              <VorschauKarte aria-label="Vorschau">
                <Reiter>
                  {[['/', 'Startseite'], ['/impressum', 'Impressum'], ['/datenschutz', 'Datenschutz']].map(([p, t]) => (
                    <button key={p} type="button" aria-pressed={pfad === p} onClick={() => zeigeSeite(p)}>{t}</button>
                  ))}
                  <span style={{ flex: 1 }} />
                  <button type="button" aria-pressed={handy} onClick={() => setHandy(true)} aria-label="Handy-Ansicht"><Smartphone size={14} /></button>
                  <button type="button" aria-pressed={!handy} onClick={() => setHandy(false)} aria-label="Desktop-Ansicht"><Monitor size={14} /></button>
                </Reiter>
                {geaendert && <Hinweis style={{ margin: '0 0 8px' }}>Die Vorschau zeigt den zuletzt gespeicherten Stand.</Hinweis>}
                <Rahmen title="Vorschau deiner Website" srcDoc={html} sandbox="" $handy={handy} data-testid="website-vorschau" />
              </VorschauKarte>
            </Spalten>
          </>
        )}
      </Seite>
    </ProGate>
  );
}
