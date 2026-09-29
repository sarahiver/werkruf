import React from 'react';
import styled from 'styled-components';
import { Send, Lock } from 'lucide-react';

import { istBearbeitbar } from '../../utils/gbpFieldModel';
import { ProfileInput, ProfileTextarea, GhostBtn, Spinner, Badge } from './gb/GbUi';

/**
 * Umschlag fuer ein Eingabefeld, das gesperrt sein kann.
 *
 * Nennt den Grund am Feld statt nur auszugrauen: "Warum kann ich das
 * nicht bearbeiten?" ist sonst die erste Rueckfrage.
 */
function FeldMitSperre({ sperre, children }) {
  if (sperre.erlaubt) return children;
  return (
    <div>
      {children}
      <SperrGrund><Lock size={11} /> {sperre.grund}</SperrGrund>
    </div>
  );
}

const SperrGrund = styled.p`
  font-family: var(--font-body); font-size: .74rem; line-height: 1.5;
  color: var(--color-text-muted); margin: 4px 0 0;
  display: flex; align-items: flex-start; gap: 5px;
  svg { flex-shrink: 0; margin-top: 2px; }
`;

const EditorHinweis = styled.div`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.5;
  border-radius: 6px; padding: 9px 12px;
  border-left: 3px solid ${p => p.$art === 'ok' ? '#1E7E34' : '#D93025'};
  background: ${p => p.$art === 'ok' ? '#E8F5E9' : '#FDECEA'};
  color: ${p => p.$art === 'ok' ? '#1B5E20' : '#8B1A12'};
  strong { display: inline; }
  small { color: inherit; opacity: .8; }
`;

/**
 * Stammdaten-Editor.
 *
 * UMGEZOGEN aus DashboardGoogleBusiness.js am 29.09.2026, unveraendert
 * bis auf die Anbindung ans Feldmodell. Die vier Sicherheitskorrekturen
 * vom selben Tag sind vollstaendig erhalten und werden weiterhin von
 * src/pages/dashboard/locationProfileEditor.test.js geprueft.
 *
 * Drei Regeln, die diese Komponente einhalten muss:
 *
 * 1. NUR tatsaechlich geaenderte Felder werden uebertragen. Vorher
 *    gingen bei jedem Speichern alle drei raus — mit updateMask
 *    "phoneNumbers,profile,websiteUri". Google ersetzt bei
 *    updateMask=profile das GESAMTE profile-Objekt: Wer nur die
 *    Beschreibung aenderte, loeschte damit jedes andere Unterfeld,
 *    das Google dort fuehrt. Jetzt Punktpfade, also
 *    profile.description.
 *
 * 2. Die Rueckmeldung behauptet nicht mehr, als bekannt ist. Eine
 *    erfolgreiche PATCH-Antwort heisst: Google hat die Aenderung
 *    ANGENOMMEN. Ob sie oeffentlich auf Maps erscheint, sagt die API
 *    nicht — Google prueft eingereichte Aenderungen und veroeffentlicht
 *    sie spaeter oder gar nicht. "Von Google bestaetigt" war deshalb
 *    falsch.
 *
 * 3. Erfolg und Fehler sind getrennte Zustaende. Vorher landeten beide
 *    im selben notice-String und sahen gleich aus.
 */
export default function StammdatenEditor({ location, onSave }) {
  /* Ausgangswerte aus dem bestaetigten Google-Stand. */
  const urspruenglich = React.useMemo(() => ({
    telefon:      location.primary_phone || '',
    website:      location.website_uri || '',
    beschreibung: location.google_profile?.profile?.description || '',
  }), [location.primary_phone, location.website_uri, location.google_profile]);

  const [telefon, setTelefon]           = React.useState(urspruenglich.telefon);
  const [website, setWebsite]           = React.useState(urspruenglich.website);
  const [beschreibung, setBeschreibung] = React.useState(urspruenglich.beschreibung);

  const [busy, setBusy]       = React.useState(false);
  const [erfolg, setErfolg]   = React.useState(null);
  const [fehler, setFehler]   = React.useState(null);

  /* Sperren aus dem Feldmodell. Sie steuern nur die Anzeige — die
     Edge Function prueft dieselben Regeln noch einmal und lehnt ab,
     wenn jemand die Oberflaeche umgeht. */
  const sperre = {
    telefon:      istBearbeitbar('phoneNumbers', location),
    website:      istBearbeitbar('websiteUri', location),
    beschreibung: istBearbeitbar('profile.description', location),
  };
  const allesGesperrt = !Object.values(sperre).some((s) => s.erlaubt);

  /* Nach erfolgreichem Speichern liefert der Server den bestaetigten
     Stand; die Ausgangswerte wandern nach. Ohne das gaelte das Feld
     weiterhin als geaendert und ginge beim naechsten Mal erneut raus. */
  React.useEffect(() => {
    setTelefon(urspruenglich.telefon);
    setWebsite(urspruenglich.website);
    setBeschreibung(urspruenglich.beschreibung);
  }, [urspruenglich]);

  const geaendert = {
    telefon:      telefon.trim()      !== urspruenglich.telefon,
    website:      website.trim()      !== urspruenglich.website,
    beschreibung: beschreibung.trim() !== urspruenglich.beschreibung,
  };
  const etwasGeaendert = Object.values(geaendert).some(Boolean);

  const speichern = async () => {
    setBusy(true); setErfolg(null); setFehler(null);

    /* Punktpfade: Jeder Eintrag ersetzt genau dieses Unterfeld.
       Unveraenderte Felder tauchen gar nicht erst auf und landen damit
       auch nicht in der updateMask. */
    const aenderungen = {};

    /* phoneNumbers akzeptiert Google NUR als Ganzes — das Discovery-
       Dokument sagt ausdruecklich, dass primaryPhone und
       additionalPhones nicht einzeln ueber die updateMask geaendert
       werden duerfen. Die vorhandenen additionalPhones werden deshalb
       mitgeschickt, sonst loescht das Speichern sie. */
    if (geaendert.telefon && sperre.telefon.erlaubt) {
      aenderungen.phoneNumbers = {
        ...(location.google_profile?.phoneNumbers || {}),
        primaryPhone: telefon.trim() || null,
      };
    }

    if (geaendert.website && sperre.website.erlaubt) aenderungen.websiteUri = website.trim() || null;

    /* profile hat nur das Unterfeld description — hier ist der
       Punktpfad zulaessig und genauer. */
    if (geaendert.beschreibung && sperre.beschreibung.erlaubt) aenderungen['profile.description'] = beschreibung.trim() || null;

    try {
      const antwort = await onSave(location.id, aenderungen);

      /* Nur bei confirmed: true. Alles andere ist keine Bestaetigung. */
      if (antwort?.confirmed) {
        setErfolg({
          felder: antwort.updateMask ? antwort.updateMask.split(',') : Object.keys(aenderungen),
        });
      } else {
        setFehler('Google hat die Änderung nicht bestätigt. Bitte versuche es erneut.');
      }
    } catch (error) {
      setFehler(error.message || 'Die Änderung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
      <small>Name, Adresse und Verifizierungsstatus werden von Google nur lesend angezeigt.</small>

      <FeldMitSperre sperre={sperre.telefon}>
        <ProfileInput aria-label="Telefonnummer" value={telefon}
          disabled={!sperre.telefon.erlaubt}
          onChange={(e) => setTelefon(e.target.value)} placeholder="Telefonnummer" />
      </FeldMitSperre>
      <FeldMitSperre sperre={sperre.website}>
        <ProfileInput aria-label="Website" value={website}
          disabled={!sperre.website.erlaubt}
          onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
      </FeldMitSperre>
      <FeldMitSperre sperre={sperre.beschreibung}>
        <ProfileTextarea aria-label="Unternehmensbeschreibung" value={beschreibung}
          disabled={!sperre.beschreibung.erlaubt}
          onChange={(e) => setBeschreibung(e.target.value)} placeholder="Unternehmensbeschreibung" />
      </FeldMitSperre>

      {location.google_diff_mask?.length > 0 && (
        <Badge $variant="warning">Google-Änderung: {location.google_diff_mask.join(', ')}</Badge>
      )}

      <div>
        <GhostBtn onClick={speichern} disabled={busy || !etwasGeaendert || allesGesperrt}>
          {busy ? <Spinner size={14} /> : <Send size={14} />}
          {busy ? 'Wird übermittelt…' : 'Bei Google speichern'}
        </GhostBtn>
      </div>

      {erfolg && (
        <EditorHinweis $art="ok">
          <strong>An Google übermittelt.</strong>{' '}
          Google kann die Veröffentlichung noch überprüfen — bis dahin ist im
          Unternehmensprofil weiterhin der bisherige Stand sichtbar.
          {erfolg.felder.length > 0 && (
            <><br /><small>Übermittelt: {erfolg.felder.join(', ')}</small></>
          )}
        </EditorHinweis>
      )}

      {fehler && (
        <EditorHinweis $art="fehler" role="alert">
          <strong>Nicht gespeichert.</strong> {fehler}
        </EditorHinweis>
      )}
    </div>
  );
}
