import React, { useState, useEffect, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import { Upload, Image, Trash2, Loader, CheckCircle, AlertCircle, CloudUpload } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import supabase from '../../supabaseClient';

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;
const pulse  = keyframes`0%,100%{opacity:1}50%{opacity:.4}`;

/* ─────────────────────────────────────────────
   CLOUDINARY CONFIG
   Set these in Vercel env vars:
   REACT_APP_CLOUDINARY_CLOUD_NAME
   REACT_APP_CLOUDINARY_UPLOAD_PRESET  (unsigned preset)
───────────────────────────────────────────── */
const CLOUD_NAME    = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET;

async function uploadToCloudinary(file, profileId) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', `werkruf/profiles/${profileId}`);
  formData.append('transformation', 'f_auto,q_auto');

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );
  if (!res.ok) throw new Error('Cloudinary upload failed');
  return res.json();
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

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardFotos() {
  const { profile, user } = useAuthContext();
  const [photos,  setPhotos]  = useState([]);
  const [queue,   setQueue]   = useState([]); // { file, preview, progress, done, error }
  const [dragging,setDragging]= useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  const profileId = user?.id;

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
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      setError('Cloudinary ist noch nicht konfiguriert. REACT_APP_CLOUDINARY_CLOUD_NAME und REACT_APP_CLOUDINARY_UPLOAD_PRESET in Vercel setzen.');
      return;
    }

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

        const result = await uploadToCloudinary(item.file, profileId);

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

  const handleDelete = async (photo) => {
    if (!window.confirm('Foto löschen?')) return;
    await supabase.from('business_photos').delete().eq('id', photo.id);
    setPhotos(prev => prev.filter(p => p.id !== photo.id));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <Page>
      <PageTitle>Fotos & Galerie</PageTitle>
      <PageSub>Lade Bilder hoch — sie werden automatisch für Google optimiert.</PageSub>

      {error && <ErrorBanner>{error}</ErrorBanner>}

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

      {/* Gallery */}
      <GalleryHeader>
        <GalleryTitle>Galerie</GalleryTitle>
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
                <PulseDot /> Wartet auf Google-Sync
              </SyncBadge>
              <PhotoOverlay>
                <DeleteBtn onClick={() => handleDelete(photo)}>
                  <Trash2 size={15} />
                </DeleteBtn>
              </PhotoOverlay>
            </PhotoCard>
          ))}
        </Grid>
      )}
    </Page>
  );
}
