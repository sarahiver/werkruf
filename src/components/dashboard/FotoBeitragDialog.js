import React, { useState } from 'react';
import styled from 'styled-components';
import { Megaphone, Loader, Check, Sparkles, X } from 'lucide-react';
import supabase from '../../supabaseClient';
import { BEITRAG_MAX_ZEICHEN, pruefeBeitragstext, BEITRAG_GRUND_TEXT, statusText } from '../../utils/saisonBeitraege';
import { NOTIZ_MAX_ZEICHEN, FOTO_BEITRAG_TEXT } from '../../utils/fotoBeitrag';

/*
 * Foto → Google-Beitrag.
 *
 * Der Betrieb hat ein Foto ueber WERKRUF hochgeladen und macht daraus
 * einen Beitrag fuer sein Google-Profil:
 *   1. optional kurze Notiz („Wärmepumpe im Neubau")
 *   2. „Vorschlag schreiben lassen" → Text (nur Vorschlag)
 *   3. Text pruefen und aendern — oder gleich selbst schreiben
 *   4. „Auf Google veröffentlichen" (mit diesem Foto)
 *
 * Nichts geht ohne den Klick in Schritt 4 zu Google. Der Client schickt
 * nur photoId, locationId, Notiz, Text — welches Bild, prueft der Server.
 */

const Card = styled.div`
  background: var(--color-white); border: 2px solid var(--color-accent);
  border-radius: var(--radius-card); padding: 20px 22px; margin: 0 0 24px;
`;
const Kopf = styled.div`display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;`;
const Titel = styled.h2`
  display: flex; align-items: center; gap: 10px; margin: 0 0 6px;
  font-family: var(--font-display); font-weight: var(--heading-weight); font-size: 1.05rem;
  color: var(--color-primary); text-transform: var(--text-transform);
  svg { color: var(--color-accent); }
`;
const Schliessen = styled.button`background: none; border: 0; cursor: pointer; color: var(--color-text-muted); padding: 4px;`;
const Inhalt = styled.div`
  display: grid; grid-template-columns: 160px 1fr; gap: 18px; margin-top: 8px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const Vorschau = styled.img`width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; border: 1px solid var(--color-border);`;
const Label = styled.label`display: block; font-family: var(--font-body); font-size: .78rem; color: var(--color-text-muted); margin: 0 0 4px;`;
const Eingabe = styled.input`
  width: 100%; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: 10px;
  font-family: var(--font-body); font-size: .9rem; color: var(--color-text);
`;
const Area = styled.textarea`
  width: 100%; min-height: 140px; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: 10px;
  font-family: var(--font-body); font-size: .92rem; line-height: 1.55; color: var(--color-text); resize: vertical;
`;
const Zeile = styled.div`display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 10px;`;
const Zaehler = styled.span`font-family: var(--font-body); font-size: .78rem; color: ${(p) => (p.$warn ? '#D93025' : 'var(--color-text-muted)')}; margin-left: auto;`;
const Knopf = styled.button`
  padding: 10px 16px; border-radius: var(--radius-button); cursor: pointer;
  background: var(--color-primary); color: white; border: 1px solid var(--color-primary);
  font-family: var(--font-body); font-size: .88rem; font-weight: 600; display: inline-flex; align-items: center; gap: 7px;
  &:disabled { opacity: .55; cursor: default; }
  &.ghost { background: var(--color-white); color: var(--color-text); border-color: var(--color-border); }
`;
const Hinweis = styled.p`margin: 8px 0 0; font-family: var(--font-body); font-size: .78rem; line-height: 1.5; color: var(--color-text-muted);`;
const Fehler = styled.p`margin: 10px 0 0; font-family: var(--font-body); font-size: .84rem; color: #B42318;`;
const Status = styled.p`margin: 12px 0 0; font-family: var(--font-body); font-size: .88rem; display: flex; align-items: center; gap: 6px; color: ${(p) => (p.$ok ? '#1E7B45' : '#B45309')};`;

async function rufeLocation(pfad, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Sitzung');
  const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/location/${pfad}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const m = payload?.error?.message || '';
    const e = new Error(FOTO_BEITRAG_TEXT[m] || BEITRAG_GRUND_TEXT[m] || 'Das hat nicht geklappt. Bitte versuch es noch einmal.');
    e.code = payload?.error?.code || m;
    throw e;
  }
  return payload;
}

const GRUND = {
  unklar: FOTO_BEITRAG_TEXT.unklar,
  ungeeignet: FOTO_BEITRAG_TEXT.ungeeignet,
  limit: FOTO_BEITRAG_TEXT.limit,
  nicht_konfiguriert: FOTO_BEITRAG_TEXT.nicht_konfiguriert,
  nicht_verfuegbar: FOTO_BEITRAG_TEXT.nicht_konfiguriert,
  notiz_zu_lang: FOTO_BEITRAG_TEXT.notiz_zu_lang,
};

export default function FotoBeitragDialog({ foto, location, onClose, rufe = rufeLocation }) {
  const [notiz, setNotiz] = useState('');
  const [text, setText] = useState('');
  const [vorschlag, setVorschlag] = useState(null);
  const [laeuft, setLaeuft] = useState(null);      // 'vorschlag' | 'veroeffentlichen' | null
  const [hinweis, setHinweis] = useState('');
  const [fehler, setFehler] = useState('');
  const [ergebnis, setErgebnis] = useState(null);

  const pruefung = pruefeBeitragstext(text);
  const zeichen = [...text].length;
  const fertig = Boolean(ergebnis?.ok);

  const schreibeVorschlag = async () => {
    setFehler(''); setHinweis(''); setLaeuft('vorschlag');
    try {
      const r = await rufe('photo-post-preview', { locationId: location.id, photoId: foto.id, notiz });
      if (r?.ok && r.vorschlag) { setText(r.vorschlag); setVorschlag(r.vorschlag); }
      else setHinweis(GRUND[r?.reason] || FOTO_BEITRAG_TEXT.nicht_konfiguriert);
    } catch (e) { setFehler(e.message); }
    finally { setLaeuft(null); }
  };

  const veroeffentlichen = async () => {
    if (!pruefung.ok || laeuft || fertig) return;
    setFehler(''); setLaeuft('veroeffentlichen');
    try {
      const r = await rufe('photo-post', { locationId: location.id, photoId: foto.id, summary: text, vorschlagGenutzt: vorschlag != null });
      setErgebnis(r);
    } catch (e) { setFehler(e.message); }
    finally { setLaeuft(null); }
  };

  return (
    <Card data-testid="foto-beitrag">
      <Kopf>
        <Titel><Megaphone size={18} /> Beitrag aus diesem Foto</Titel>
        <Schliessen type="button" onClick={onClose} aria-label="Schließen"><X size={18} /></Schliessen>
      </Kopf>
      <Inhalt>
        <Vorschau src={`${foto.cloudinary_url}?f_auto&q_auto&w=400`} alt="Ausgewähltes Foto" />
        <div>
          {!fertig && (
            <>
              <Label htmlFor="foto-notiz">Was ist zu sehen? (optional)</Label>
              <Eingabe id="foto-notiz" value={notiz} maxLength={NOTIZ_MAX_ZEICHEN} placeholder="z. B. Neue Wärmepumpe im Einfamilienhaus"
                onChange={(e) => setNotiz(e.target.value)} disabled={Boolean(laeuft)} data-testid="foto-notiz" />
              <Zeile>
                <Knopf type="button" className="ghost" onClick={schreibeVorschlag} disabled={Boolean(laeuft)} data-testid="foto-vorschlag">
                  {laeuft === 'vorschlag' ? <><Loader size={15} /> Vorschlag wird geschrieben …</> : <><Sparkles size={15} /> {vorschlag ? 'Neuen Vorschlag schreiben' : 'Vorschlag schreiben lassen'}</>}
                </Knopf>
              </Zeile>
              {hinweis && <Hinweis role="status" data-testid="foto-hinweis" style={{ color: '#B45309' }}>{hinweis}</Hinweis>}
              <div style={{ marginTop: 14 }}>
                <Label htmlFor="foto-text">Beitragstext — prüfen, ändern, freigeben</Label>
                <Area id="foto-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={BEITRAG_MAX_ZEICHEN + 200}
                  placeholder="Schreib hier selbst oder lass dir einen Vorschlag machen." disabled={Boolean(laeuft)} data-testid="foto-text" />
              </div>
              <Zeile>
                <Knopf type="button" onClick={veroeffentlichen} disabled={!pruefung.ok || Boolean(laeuft)} data-testid="foto-veroeffentlichen">
                  {laeuft === 'veroeffentlichen' ? <><Loader size={15} /> Wird übermittelt …</> : 'Mit Foto auf Google veröffentlichen'}
                </Knopf>
                <Zaehler $warn={zeichen > BEITRAG_MAX_ZEICHEN}>{zeichen} / {BEITRAG_MAX_ZEICHEN}</Zaehler>
              </Zeile>
              {!pruefung.ok && text && <Fehler>{BEITRAG_GRUND_TEXT[pruefung.grund]}</Fehler>}
              <Hinweis>
                Der Vorschlag beschreibt nur, was auf dem Foto zu sehen ist und was du notierst. Prüf ihn trotzdem —
                veröffentlicht wird genau dein Text. Achte darauf, dass keine Personen, Kennzeichen oder Hausnummern
                zu erkennen sind.
              </Hinweis>
            </>
          )}
          {fehler && <Fehler role="alert" data-testid="foto-fehler">{fehler}</Fehler>}
          {ergebnis && (
            <Status $ok={ergebnis.ok} data-testid="foto-status">
              {ergebnis.ok && <Check size={16} />} {statusText(ergebnis.googleState, ergebnis.status)}
            </Status>
          )}
        </div>
      </Inhalt>
    </Card>
  );
}
