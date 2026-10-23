import ProGate from '../../components/dashboard/ProGate';
import React, { useState, useEffect, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import { Upload, Image, Trash2, Loader, CheckCircle, AlertCircle, CloudUpload } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import supabase from '../../supabaseClient';

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;
const pulse  = keyframes`0%,100%{opacity:1}50%{opacity:.4}`;

/* ─────────────────────────────────────────────
   CLOUDINARY — SIGNED UPLOAD
   API Secret stays server-side in Edge Function.
   Client gets a short-lived signature per upload.
───────────────────────────────────────────── */
async function uploadToCloudinary(file, supabaseClient) {
  // Step 1: Get signed params from Edge Function (API secret never leaves server)
  const { data: signData, error: signError } = await supabaseClient.functions.invoke(
    'cloudinary-sign-upload'
  );
  if (signError || !signData) throw new Error('Signatur-Fehler: ' + (signError?.message || 'Unbekannt'));

  const { signature, timestamp, apiKey, cloudName, folder, transformation } = signData;

  // Step 2: Upload directly to Cloudinary with server-signed params
  const formData = new FormData();
  formData.append('file',           file);
  formData.append('api_key',        apiKey);
  formData.append('signature',      signature);
  formData.append('timestamp',      String(timestamp));
  formData.append('folder',         folder);
  formData.append('transformation', transformation);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: formData }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Cloudinary upload failed');
  }
  return res.json();
}

/* ─────────────────────────────────────────────
   GOOGLE-MEDIEN — ANZEIGEN UND LÖSCHEN (21./22.10.2026)

   Bis hierher zeigte diese Seite ausschliesslich die Uploads ueber
   WERKRUF (business_photos) — mit einem Abzeichen "Google-Upload
   angefordert", das nie wieder seinen Zustand aenderte, und einem
   Loeschknopf, der nur die WERKRUF-Zeile entfernte. Was bei Google
   tatsaechlich stand, sah niemand.

   Jetzt ist Google die Wahrheit: media/list holt die Medien des
   ausgewaehlten Standorts, media/delete loescht dort — endgueltig.
   Die WERKRUF-Uploads bleiben als das sichtbar, was sie sind: eine
   Kopie bei uns, kein Spiegel von Google.

   Welcher Standort: bestimmeZielstandort(), dieselbe Regel wie beim
   Hochladen. Mehrere Betriebe ohne Auswahl → keine Anzeige und kein
   Loeschen. Ein Foto beim falschen Betrieb zu loeschen waere
   unumkehrbar.
───────────────────────────────────────────── */

const KATEGORIEN = {
  PROFILE:    { label: 'Profilbild',  heikel: true },
  COVER:      { label: 'Titelbild',   heikel: true },
  LOGO:       { label: 'Logo',        heikel: true },
  ADDITIONAL: { label: 'Weiteres Foto', heikel: false },
};

/** Lesbares Etikett fuer die Google-Kategorie. Unbekanntes bleibt sichtbar. */
export function kategorieLabel(category) {
  return KATEGORIEN[category]?.label ?? (category ? String(category) : 'Foto');
}

/** Profil-, Titelbild und Logo sind nicht "ein Foto unter vielen" —
    ihr Fehlen faellt im Google-Eintrag sofort auf. */
export function istHeikel(category) {
  return Boolean(KATEGORIEN[category]?.heikel);
}

/**
 * Ein Google-MediaItem (v4) auf das reduzieren, was die Seite braucht.
 * Reine Funktion, exportiert fuer den Test. Die Google-URLs sind
 * zeitlich begrenzt signiert — deshalb nie zwischenspeichern.
 */
export function medienAnzeige(item) {
  if (!item || typeof item !== 'object' || !item.name) return null;
  const category = item.locationAssociation?.category ?? null;
  return {
    name:      item.name,
    bild:      item.thumbnailUrl || item.googleUrl || null,
    gross:     item.googleUrl || item.thumbnailUrl || null,
    kategorie: category,
    label:     kategorieLabel(category),
    heikel:    istHeikel(category),
    erstellt:  item.createTime ?? null,
    format:    item.mediaFormat ?? null,
  };
}

/** Aufruf der google-business-Function mit der Sitzung des Nutzers. */
async function rufeMedia(pfad, { method = 'GET', body, query } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Keine aktive Sitzung');
  const url = new URL(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/media/${pfad}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let code = 'unbekannt';
    try { code = (await response.json())?.error?.code ?? code; } catch { /* kein JSON */ }
    const fehler = new Error(`media/${pfad} fehlgeschlagen`);
    fehler.code = code;
    throw fehler;
  }
  return response.json();
}

/* ─────────────────────────────────────────────
   STYLED
───────────────────────────────────────────── */
const Page = styled.div`animation: ${fadeUp} .4s ease both;`;

const PageTitle = styled.h1`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.4rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;
const PageSub = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text-muted); margin-bottom: 24px;
`;

const DropZone = styled.div`
  border: 2px dashed ${({ $active }) => $active ? 'var(--color-accent)' : 'var(--color-border)'};
  background: ${({ $active }) => $active ? 'rgba(var(--color-accent-rgb),.06)' : 'var(--color-bg)'};
  border-radius: var(--radius-card);
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color .2s, background .2s;
  margin-bottom: 24px;
  &:hover {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb),.04);
  }
`;

const DropIcon = styled.div`
  width: 56px; height: 56px;
  background: rgba(var(--color-primary-rgb),.08);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 14px;
  color: var(--color-primary);
`;

const DropTitle = styled.p`
  font-family: var(--font-display); font-weight: 700;
  font-size: 1rem; text-transform: uppercase;
  color: var(--color-primary); margin-bottom: 6px;
`;

const DropSub = styled.p`
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text-muted); margin-bottom: 14px;
`;

const BrowseBtn = styled.label`
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 20px;
  background: var(--color-primary); color: white;
  font-family: var(--font-body); font-weight: 700; font-size: .85rem;
  border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s;
  &:hover { filter: brightness(1.15); }
  input { display: none; }
`;

/* Upload progress */
const UploadQueue = styled.div`
  display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;
`;

const UploadItem = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
`;

const UploadThumb = styled.img`
  width: 44px; height: 44px; object-fit: cover; border-radius: 4px; flex-shrink: 0;
`;

const UploadInfo = styled.div`flex: 1; min-width: 0;`;
const UploadName = styled.p`
  font-family: var(--font-body); font-size: .85rem; color: var(--color-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;

const ProgressBar = styled.div`
  height: 4px; background: var(--color-border); border-radius: 2px; margin-top: 5px; overflow: hidden;
`;
const ProgressFill = styled.div`
  height: 100%; background: var(--color-accent);
  width: ${({ $pct }) => $pct}%;
  transition: width .3s ease;
`;

/* Gallery */
const GalleryHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
`;

const GalleryTitle = styled.h2`
  font-family: var(--font-display); font-weight: 700;
  font-size: 1rem; text-transform: uppercase;
  color: var(--color-primary);
`;

const PhotoCount = styled.span`
  font-family: var(--font-body); font-size: .8rem;
  color: var(--color-text-muted);
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
`;

const PhotoCard = styled.div`
  position: relative; border-radius: var(--radius-card); overflow: hidden;
  background: var(--color-bg);
  animation: ${fadeUp} .3s ease both;
`;

const Photo = styled.img`
  width: 100%; aspect-ratio: 1; object-fit: cover; display: block;
`;

const PhotoOverlay = styled.div`
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,.7) 0%, transparent 50%);
  opacity: 0; transition: opacity .2s;
  ${PhotoCard}:hover & { opacity: 1; }
  display: flex; flex-direction: column; justify-content: flex-end;
  padding: 10px;
`;

const SyncBadge = styled.div`
  position: absolute; top: 8px; left: 8px;
  background: rgba(0,0,0,.65); color: #FFD54F;
  font-family: var(--font-body); font-size: .62rem; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase;
  padding: 3px 7px; border-radius: 3px;
  display: flex; align-items: center; gap: 4px;
`;

const PulseDot = styled.span`
  width: 5px; height: 5px; background: #FFD54F; border-radius: 50%;
  animation: ${pulse} 1.5s ease infinite;
`;

const DeleteBtn = styled.button`
  align-self: flex-end;
  background: rgba(255,255,255,.15); border: none; cursor: pointer;
  color: white; padding: 5px; border-radius: 4px;
  display: flex; align-items: center;
  &:hover { background: rgba(255,0,0,.4); }
`;

const EmptyState = styled.div`
  text-align: center; padding: 48px 24px;
  background: var(--color-bg); border-radius: var(--radius-card);
`;
const EmptyIcon = styled.div`
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--color-border);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 14px; color: var(--color-text-muted);
`;

const ErrorBanner = styled.div`
  padding: 12px 16px; margin-bottom: 16px;
  background: #FDECEA; border-left: 3px solid #D93025;
  border-radius: var(--radius-card);
  font-family: var(--font-body); font-size: .82rem; color: #D93025;
`;

const SpinnerIcon = styled(Loader)`animation: ${spin} .8s linear infinite;`;

/* ── Google-Abschnitt ── */
const KategorieMarke = styled.span`
  position: absolute; top: 8px; left: 8px;
  background: rgba(0,44,81,.85); color: #fff;
  font-family: var(--font-body); font-size: .68rem; font-weight: 700;
  letter-spacing: .4px; text-transform: uppercase;
  border-radius: 3px; padding: 3px 7px;
`;

const Bestaetigung = styled.div`
  position: absolute; inset: 0; background: rgba(255,255,255,.96);
  display: flex; flex-direction: column; justify-content: center; gap: 8px;
  padding: 14px; text-align: center;
  p { font-family: var(--font-body); font-size: .8rem; line-height: 1.45; color: var(--color-text); margin: 0; }
  p strong { color: #B3261E; }
`;

const KnopfZeile = styled.div`display: flex; gap: 8px; justify-content: center;`;

const GefahrKnopf = styled.button`
  font-family: var(--font-body); font-size: .78rem; font-weight: 700;
  background: #B3261E; color: #fff; border: 0; border-radius: 5px;
  padding: 8px 12px; cursor: pointer;
  &:disabled { opacity: .6; cursor: wait; }
`;

const RuhigKnopf = styled.button`
  font-family: var(--font-body); font-size: .78rem; font-weight: 700;
  background: #fff; color: var(--color-primary);
  border: 1px solid var(--color-border); border-radius: 5px;
  padding: 8px 12px; cursor: pointer;
`;

const Hinweis = styled.p`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.55;
  color: var(--color-text-muted); margin: 0 0 16px;
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
/**
 * Zu welchem Betrieb gehoert ein Foto-Upload?
 *
 * Dieselbe Regel wie beim WERKRUF Score (siehe
 * supabase/migrations/20260930120000_location_health_score.sql):
 * Bei mehreren Betrieben ohne Auswahl wird NICHT geraten.
 *
 * Ein stiller Rueckfall auf is_primary oder den aeltesten Standort
 * waere hier besonders unangenehm: Ein Foto beim falschen Betrieb ist
 * oeffentlich sichtbar und muss von Hand wieder entfernt werden.
 *
 * @returns {Promise<{id: string, title: string}|null>}
 */
export async function bestimmeZielstandort() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('google_locations')
    .select('id, title, selected_at')
    .eq('user_id', user.id)
    .is('deleted_at', null);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  if (data.length === 1) return data[0];

  return data.find((l) => l.selected_at) ?? null;
}

export default function DashboardFotos() {
  const { user } = useAuthContext();
  const [photos,  setPhotos]  = useState([]);
  const [queue,   setQueue]   = useState([]); // { file, preview, progress, done, error }
  const [dragging,setDragging]= useState(false);
  const [error]               = useState('');
  const [loading, setLoading] = useState(true);

  const profileId = user?.id;

  /* ── Google-Medien ── */
  const [standort, setStandort]       = useState(undefined); // undefined = noch nicht bestimmt, null = keiner
  const [google, setGoogle]           = useState([]);
  const [googleLaedt, setGoogleLaedt] = useState(true);
  const [googleFehler, setGoogleFehler] = useState('');
  const [loeschFrage, setLoeschFrage] = useState(null);   // media name, fuer das die Bestaetigung offen ist
  const [loescht, setLoescht]         = useState(null);   // media name, das gerade geloescht wird

  const ladeGoogle = useCallback(async (ort) => {
    if (!ort) { setGoogle([]); setGoogleLaedt(false); return; }
    setGoogleLaedt(true); setGoogleFehler('');
    try {
      const { media } = await rufeMedia('list', { query: { locationId: ort.id } });
      setGoogle((media ?? []).map(medienAnzeige).filter(Boolean));
    } catch (err) {
      setGoogleFehler(err.code === 'not_connected' || err.code === 'reauth_required'
        ? 'Die Google-Verbindung muss erneuert werden — unter „Dein Profil".'
        : 'Die Fotos bei Google konnten gerade nicht geladen werden.');
    } finally {
      setGoogleLaedt(false);
    }
  }, []);

  useEffect(() => {
    if (!profileId) return;
    let abgebrochen = false;
    bestimmeZielstandort().then((ort) => {
      if (abgebrochen) return;
      setStandort(ort ?? null);
      ladeGoogle(ort ?? null);
    });
    return () => { abgebrochen = true; };
  }, [profileId, ladeGoogle]);

  /*
   * Loeschen bei Google — endgueltig.
   *
   * Zwei Klicks, nie einer: Der erste oeffnet die Bestaetigung auf der
   * Karte, der zweite loescht. Kein window.confirm — das laesst sich
   * weder gestalten noch testen, und sein Text ist zu kurz fuer das,
   * was hier passiert.
   *
   * Die Antwort des Servers traegt die neue Medienliste; damit zeigt
   * die Seite sofort den echten Stand, nicht eine lokale Vermutung.
   */
  const loescheBeiGoogle = async (eintrag) => {
    if (!standort) return;
    setLoescht(eintrag.name); setGoogleFehler('');
    try {
      const { media } = await rufeMedia('delete', {
        method: 'POST',
        body: { locationId: standort.id, mediaName: eintrag.name },
      });
      setGoogle((media ?? []).map(medienAnzeige).filter(Boolean));
      setLoeschFrage(null);
    } catch (err) {
      setGoogleFehler(err.code === 'bad_request'
        ? 'Dieses Foto gehört nicht zum ausgewählten Betrieb.'
        : 'Das Foto konnte bei Google nicht gelöscht werden. Es ist unverändert.');
    } finally {
      setLoescht(null);
    }
  };

  /* ── Load photos from Supabase ── */
  useEffect(() => {
    if (!profileId) return;
    supabase
      .from('business_photos')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setPhotos(data || []);
        setLoading(false);
      });
  }, [profileId]);

  /* ── Handle files ── */
  const handleFiles = useCallback(async (files) => {
    const valid = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!valid.length) return;

    const newItems = valid.map(file => ({
      id:       Math.random().toString(36).slice(2),
      file,
      preview:  URL.createObjectURL(file),
      progress: 0,
      done:     false,
      error:    false,
    }));

    setQueue(prev => [...prev, ...newItems]);

    for (const item of newItems) {
      try {
        // Simulate progress (Cloudinary doesn't support XHR progress easily)
        const progressInterval = setInterval(() => {
          setQueue(prev => prev.map(q =>
            q.id === item.id && q.progress < 85
              ? { ...q, progress: q.progress + 15 }
              : q
          ));
        }, 200);

        const result = await uploadToCloudinary(item.file, supabase);

        clearInterval(progressInterval);
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, progress: 100, done: true } : q
        ));

        // Save to Supabase
        const { data: newPhoto } = await supabase
          .from('business_photos')
          .insert({
            profile_id:    profileId,
            cloudinary_url:result.secure_url,
            public_id:     result.public_id,
          })
          .select()
          .single();

        if (newPhoto) {
          setPhotos(prev => [newPhoto, ...prev]);
        }

        /*
         * Die Dateiauswahl ist die ausdrueckliche Veroeffentlichung.
         * Google bekommt nur die oeffentliche HTTPS-Adresse, nie
         * Anmeldedaten aus dem Browser.
         *
         * Welcher Betrieb — verbindlich, wie beim WERKRUF Score:
         *
         *   genau ein Standort            → dieser
         *   mehrere mit Auswahl           → der ausgewaehlte
         *   mehrere ohne gueltige Auswahl → NICHT veroeffentlichen
         *
         * Vorher stand hier order('is_primary').limit(1) — ohne Filter
         * auf den Nutzer und ohne Beruecksichtigung der Auswahl. Wer
         * WERKRUF ausgewaehlt hatte, lud damit Fotos zu S&I hoch.
         */
        const location = await bestimmeZielstandort();

        if (!location) {
          throw new Error(
            'Es ist kein Betrieb ausgewählt. Wähle unter „Dein Profil" einen Betrieb, '
            + 'bevor du Fotos bei Google veröffentlichst.');
        }

        {
          const { data: { session } } = await supabase.auth.getSession();
          const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-business/media/create`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ locationId: location.id, sourceUrl: result.secure_url, category: 'ADDITIONAL' }),
          });
          if (!response.ok) throw new Error('Google konnte das Foto nicht veröffentlichen.');
        }

        // Remove from queue after delay
        setTimeout(() => {
          setQueue(prev => prev.filter(q => q.id !== item.id));
        }, 1500);

      } catch (err) {
        console.error('Upload error:', err);
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, error: true, done: true } : q
        ));
      }
    }
  }, [profileId]);

  /* Entfernt NUR die Kopie bei WERKRUF. Das Foto bei Google bleibt —
     dafuer ist der Abschnitt oben zustaendig, mit eigener Bestaetigung. */
  const handleDelete = async (photo) => {
    if (!window.confirm('Kopie bei WERKRUF entfernen? Das Foto bei Google bleibt davon unberührt.')) return;
    await supabase.from('business_photos').delete().eq('id', photo.id);
    setPhotos(prev => prev.filter(p => p.id !== photo.id));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <ProGate feature="Fotos">
    <Page>
      <PageTitle>Fotos</PageTitle>
      <PageSub>Was Kunden bei Google sehen — und neue Bilder dazu. WERKRUF bringt sie ins richtige Format.</PageSub>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* ── BEI GOOGLE SICHTBAR ── */}
      <GalleryHeader>
        <GalleryTitle>Bei Google sichtbar</GalleryTitle>
        {standort && !googleLaedt && (
          <PhotoCount>{google.length} Foto{google.length !== 1 ? 's' : ''} · {standort.title || 'Betrieb'}</PhotoCount>
        )}
      </GalleryHeader>

      {googleFehler && <ErrorBanner role="alert">{googleFehler}</ErrorBanner>}

      {standort === null ? (
        <EmptyState data-testid="google-kein-standort">
          <EmptyIcon><Image size={24} /></EmptyIcon>
          <p style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text-muted)', fontSize: '.9rem' }}>
            Wähle unter „Dein Profil" einen Betrieb aus — dann siehst du hier, welche Fotos bei Google stehen.
          </p>
        </EmptyState>
      ) : googleLaedt ? (
        <EmptyState>
          <SpinnerIcon size={28} color="var(--color-text-muted)" style={{ margin: '0 auto 12px', display: 'block' }} />
        </EmptyState>
      ) : google.length === 0 ? (
        <EmptyState data-testid="google-leer">
          <EmptyIcon><Image size={24} /></EmptyIcon>
          <p style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text-muted)', fontSize: '.9rem' }}>
            Bei Google liegen für diesen Betrieb noch keine Fotos.
          </p>
        </EmptyState>
      ) : (
        <>
          <Hinweis>
            Das sind die Fotos, die Kunden bei Google sehen. Löschen wirkt direkt bei Google
            und lässt sich nicht rückgängig machen.
          </Hinweis>
          <Grid data-testid="google-galerie">
            {google.map((g) => (
              <PhotoCard key={g.name} data-media={g.name}>
                {g.bild && <Photo src={g.bild} alt={g.label} loading="lazy" />}
                <KategorieMarke>{g.label}</KategorieMarke>
                {loeschFrage === g.name ? (
                  <Bestaetigung role="dialog" aria-label="Löschen bestätigen">
                    <p>
                      <strong>Bei Google endgültig löschen?</strong>
                      {g.heikel && <> Das ist dein <strong>{g.label}</strong> — es fehlt danach im Google-Eintrag.</>}
                    </p>
                    <KnopfZeile>
                      <GefahrKnopf
                        type="button"
                        disabled={loescht === g.name}
                        onClick={() => loescheBeiGoogle(g)}
                      >
                        {loescht === g.name ? 'Wird gelöscht…' : 'Ja, bei Google löschen'}
                      </GefahrKnopf>
                      <RuhigKnopf type="button" onClick={() => setLoeschFrage(null)} disabled={loescht === g.name}>
                        Abbrechen
                      </RuhigKnopf>
                    </KnopfZeile>
                  </Bestaetigung>
                ) : (
                  <PhotoOverlay>
                    <DeleteBtn
                      type="button"
                      aria-label={`${g.label} bei Google löschen`}
                      onClick={() => setLoeschFrage(g.name)}
                    >
                      <Trash2 size={15} />
                    </DeleteBtn>
                  </PhotoOverlay>
                )}
              </PhotoCard>
            ))}
          </Grid>
        </>
      )}

      {/* Drop Zone */}
      <DropZone
        $active={dragging}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <DropIcon>
          <CloudUpload size={26} />
        </DropIcon>
        <DropTitle>Fotos hierher ziehen</DropTitle>
        <DropSub>JPG, PNG, WebP — max. 10 MB pro Bild</DropSub>
        <BrowseBtn>
          <Upload size={15} /> Fotos auswählen
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={e => handleFiles(e.target.files)}
          />
        </BrowseBtn>
      </DropZone>

      {/* Upload Queue */}
      {queue.length > 0 && (
        <UploadQueue>
          {queue.map(item => (
            <UploadItem key={item.id}>
              <UploadThumb src={item.preview} alt="" />
              <UploadInfo>
                <UploadName>{item.file.name}</UploadName>
                <ProgressBar>
                  <ProgressFill $pct={item.progress} />
                </ProgressBar>
              </UploadInfo>
              {item.done && !item.error && <CheckCircle size={18} color="#1E7E34" />}
              {item.error && <AlertCircle size={18} color="#D93025" />}
              {!item.done && <SpinnerIcon size={18} color="var(--color-accent)" />}
            </UploadItem>
          ))}
        </UploadQueue>
      )}

      {/* ── UEBER WERKRUF HOCHGELADEN ──
          Die Kopie bei uns. Ob ein Foto bei Google angekommen ist,
          zeigt der Abschnitt oben — nicht dieses Abzeichen. */}
      <GalleryHeader>
        <GalleryTitle>Über WERKRUF hochgeladen</GalleryTitle>
        <PhotoCount>{photos.length} Foto{photos.length !== 1 ? 's' : ''}</PhotoCount>
      </GalleryHeader>

      {loading ? (
        <EmptyState>
          <SpinnerIcon size={28} color="var(--color-text-muted)" style={{ margin: '0 auto 12px', display: 'block' }} />
        </EmptyState>
      ) : photos.length === 0 ? (
        <EmptyState>
          <EmptyIcon><Image size={24} /></EmptyIcon>
          <p style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text-muted)', fontSize: '.9rem' }}>
            Noch keine Fotos — lade dein erstes Bild hoch.
          </p>
        </EmptyState>
      ) : (
        <Grid>
          {photos.map((photo) => (
            <PhotoCard key={photo.id}>
              <Photo
                src={`${photo.cloudinary_url}?f_auto&q_auto&w=400`}
                alt=""
                loading="lazy"
              />
              <SyncBadge>
                <PulseDot /> Kopie bei WERKRUF
              </SyncBadge>
              <PhotoOverlay>
                <DeleteBtn
                  type="button"
                  aria-label="Kopie bei WERKRUF entfernen"
                  title="Entfernt nur die Kopie bei WERKRUF — nicht bei Google"
                  onClick={() => handleDelete(photo)}
                >
                  <Trash2 size={15} />
                </DeleteBtn>
              </PhotoOverlay>
            </PhotoCard>
          ))}
        </Grid>
      )}
    </Page>
    </ProGate>
  );
}
