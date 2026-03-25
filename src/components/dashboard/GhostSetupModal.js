import React, { useState, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import {
  X, Upload, CheckCircle, Phone, Globe,
  MapPin, Image, ArrowRight, Loader, Shield
} from 'lucide-react';
import PricingCard, { buildStripeMetadata } from '../PricingCard';
import supabase from '../../supabaseClient';

const fadeIn  = keyframes`from{opacity:0}to{opacity:1}`;
const scaleIn = keyframes`from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}`;
const spin    = keyframes`to{transform:rotate(360deg)}`;

/* ─────────────────────────────────────────────
   STYLED
───────────────────────────────────────────── */
const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,.6);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px; overflow-y: auto;
  animation: ${fadeIn} .2s ease both;
`;

const Sheet = styled.div`
  background: var(--color-white);
  border-radius: var(--radius-card);
  border-top: 5px solid var(--color-accent);
  width: 100%; max-width: 640px;
  margin: auto;
  animation: ${scaleIn} .25s ease both;
  position: relative;
`;

const SheetHead = styled.div`
  padding: 24px 24px 0;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 16px;
`;

const CloseBtn = styled.button`
  position: absolute; top: 16px; right: 16px;
  background: none; border: none; cursor: pointer;
  color: var(--color-text-muted); padding: 4px;
  border-radius: var(--radius-button);
  &:hover { background: var(--color-bg); }
`;

const SheetTitle = styled.h2`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.3rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;

const SheetSub = styled.p`
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text-muted); line-height: 1.5;
`;

const SheetBody = styled.div`padding: 24px;`;

/* Steps */
const StepRow = styled.div`
  display: flex; gap: 8px; margin-bottom: 24px;
`;

const Step = styled.div`
  flex: 1; height: 3px; border-radius: 2px;
  background: ${({ $active, $done }) =>
    $done ? '#1E7E34' : $active ? 'var(--color-accent)' : 'var(--color-border)'};
  transition: background .3s;
`;

const StepLabel = styled.p`
  font-family: var(--font-body); font-size: .75rem;
  color: var(--color-text-muted); margin-bottom: 14px;
  span { color: var(--color-primary); font-weight: 600; }
`;

/* Form fields */
const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: ${({ $cols }) => $cols === 2 ? '1fr 1fr' : '1fr'};
  gap: 12px;
  @media(max-width:560px){ grid-template-columns: 1fr; }
`;

const Field = styled.div`display: flex; flex-direction: column; gap: 5px;`;

const Label = styled.label`
  font-family: var(--font-body); font-weight: 600;
  font-size: .72rem; letter-spacing: .08em; text-transform: uppercase;
  color: var(--color-primary);
`;

const Input = styled.input`
  padding: 10px 13px;
  border: 2px solid ${({ $err }) => $err ? '#E53E3E' : 'var(--color-border)'};
  background: var(--color-bg); color: var(--color-text);
  font-family: var(--font-body); font-size: .92rem;
  outline: none; border-radius: var(--radius-card);
  transition: border-color .2s;
  &:focus { border-color: var(--color-primary); background: var(--color-white); }
  &::placeholder { color: #A0ADB8; }
`;

const InputIcon = styled.div`
  position: relative;
  input { padding-left: 36px; }
`;

const IconWrap = styled.div`
  position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
  color: #A0ADB8; display: flex; align-items: center; pointer-events: none;
`;

const ErrText = styled.span`
  font-family: var(--font-body); font-size: .72rem; color: #E53E3E;
`;

/* Photo upload */
const PhotoGrid = styled.div`
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;
  @media(max-width:480px){ grid-template-columns: repeat(3, 1fr); }
`;

const PhotoSlot = styled.div`
  aspect-ratio: 1;
  border: 2px dashed ${({ $filled }) => $filled ? '#1E7E34' : 'var(--color-border)'};
  border-radius: var(--radius-card);
  background: ${({ $filled }) => $filled ? '#E8F5E9' : 'var(--color-bg)'};
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  cursor: pointer; transition: border-color .2s, background .2s;
  overflow: hidden; position: relative;
  &:hover { border-color: var(--color-accent); }
`;

const PhotoPreview = styled.img`
  width: 100%; height: 100%; object-fit: cover;
`;

const PhotoLabel = styled.p`
  font-family: var(--font-body); font-size: .65rem;
  color: var(--color-text-muted); margin-top: 4px; text-align: center;
`;

const PhotoCount = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); margin-top: 6px;
`;

/* Nav buttons */
const NavRow = styled.div`
  display: flex; gap: 10px; margin-top: 20px;
  justify-content: space-between;
`;

const BackBtn = styled.button`
  padding: 10px 20px; background: none;
  border: 2px solid var(--color-border);
  font-family: var(--font-body); font-weight: 600;
  font-size: .9rem; color: var(--color-text-muted);
  border-radius: var(--radius-button); cursor: pointer;
  transition: border-color .2s;
  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
`;

const NextBtn = styled.button`
  flex: 1; padding: 12px;
  background: var(--color-primary); color: white;
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: .95rem; letter-spacing: .06em; text-transform: var(--text-transform);
  border: none; border-radius: var(--radius-button); cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: filter .2s;
  &:hover { filter: brightness(1.1); }
  &:disabled { opacity: .5; cursor: not-allowed; }
  .spin { animation: ${spin} .8s linear infinite; }
`;

const SectionTitle = styled.p`
  font-family: var(--font-body); font-weight: 700;
  font-size: .82rem; color: var(--color-primary);
  margin: 16px 0 10px;
  &:first-child { margin-top: 0; }
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function GhostSetupModal({
  onClose,
  onCheckoutStart,
  companyName = '',
  userId,
  industryKey,
}) {
  const [step, setStep] = useState(1); // 1=details, 2=photos, 3=pricing

  // Step 1 fields
  const [address,  setAddress]  = useState('');
  const [phone,    setPhone]    = useState('');
  const [website,  setWebsite]  = useState('');
  const [errors,   setErrors]   = useState({});

  // Step 2 — photos
  const [photos,   setPhotos]   = useState(Array(5).fill(null));
  const fileRefs   = useRef([]);

  // Step 3 — checkout
  const [loading,  setLoading]  = useState(false);

  /* ── Validate step 1 ── */
  const validateStep1 = () => {
    const e = {};
    if (!address.trim()) e.address = 'Pflichtfeld';
    if (!phone.trim())   e.phone   = 'Pflichtfeld';
    return e;
  };

  /* ── Photo handler ── */
  const handlePhoto = (idx, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotos(prev => {
      const next = [...prev];
      next[idx] = { file, url };
      return next;
    });
  };

  /* ── Checkout ── */
  const handleCheckout = async ({ plan, path, setupFee, totalFirst, priceMonthly }) => {
    setLoading(true);

    const metadata = buildStripeMetadata({
      plan,
      path,
      industryKey,
      userId,
      companyName,
    });

    // Save setup details to leads table
    try {
      await supabase.from('leads').update({
        phone:   phone || null,
        city:    address || null,
        // website stored in google_place_id field temporarily until GMB is live
      }).eq('email', (await supabase.auth.getUser()).data.user?.email)
        .eq('needs_manual_setup', true);
    } catch (_) {}

    // Pass to parent for Stripe checkout
    if (onCheckoutStart) {
      onCheckoutStart({ metadata, setupFee, totalFirst, priceMonthly, plan });
    }

    setLoading(false);
  };

  const photoCount = photos.filter(Boolean).length;

  return (
    <Overlay onClick={e => e.target === e.currentTarget && onClose()}>
      <Sheet>
        <CloseBtn onClick={onClose}><X size={18} /></CloseBtn>

        <SheetHead>
          <SheetTitle>
            {step === 1 && 'Dein Betrieb — Details'}
            {step === 2 && 'Fotos für dein Profil'}
            {step === 3 && 'Paket wählen & starten'}
          </SheetTitle>
          <SheetSub>
            {step === 1 && 'Damit wir dein Google Business Profil korrekt einrichten können.'}
            {step === 2 && 'Bis zu 5 Fotos — Außenansicht, Team, Werkstatt, Fahrzeuge...'}
            {step === 3 && 'Einmalige Setup-Fee + 30 Tage Software gratis inklusive.'}
          </SheetSub>
        </SheetHead>

        <SheetBody>
          {/* Step indicator */}
          <StepRow>
            <Step $done={step > 1} $active={step === 1} />
            <Step $done={step > 2} $active={step === 2} />
            <Step $done={step > 3} $active={step === 3} />
          </StepRow>
          <StepLabel>
            Schritt <span>{step} von 3</span>
          </StepLabel>

          {/* ── STEP 1: Details ── */}
          {step === 1 && (
            <>
              <Field style={{ marginBottom: 12 }}>
                <Label>Firmenname</Label>
                <Input value={companyName} disabled
                  style={{ opacity: .6, cursor: 'not-allowed' }} />
              </Field>

              <Field style={{ marginBottom: 12 }}>
                <Label>Firmenanschrift *</Label>
                <InputIcon>
                  <IconWrap><MapPin size={15} /></IconWrap>
                  <Input
                    placeholder="Musterstraße 1, 20099 Hamburg"
                    value={address}
                    onChange={e => { setAddress(e.target.value); setErrors(p => ({...p, address: ''})); }}
                    $err={!!errors.address}
                    style={{ paddingLeft: 36 }}
                  />
                </InputIcon>
                {errors.address && <ErrText>{errors.address}</ErrText>}
              </Field>

              <FieldGrid $cols={2}>
                <Field>
                  <Label>Telefon *</Label>
                  <InputIcon>
                    <IconWrap><Phone size={15} /></IconWrap>
                    <Input
                      type="tel"
                      placeholder="+49 40 123456"
                      value={phone}
                      onChange={e => { setPhone(e.target.value); setErrors(p => ({...p, phone: ''})); }}
                      $err={!!errors.phone}
                      style={{ paddingLeft: 36 }}
                    />
                  </InputIcon>
                  {errors.phone && <ErrText>{errors.phone}</ErrText>}
                </Field>

                <Field>
                  <Label>Website (optional)</Label>
                  <InputIcon>
                    <IconWrap><Globe size={15} /></IconWrap>
                    <Input
                      type="url"
                      placeholder="www.meinbetrieb.de"
                      value={website}
                      onChange={e => setWebsite(e.target.value)}
                      style={{ paddingLeft: 36 }}
                    />
                  </InputIcon>
                </Field>
              </FieldGrid>

              <NavRow>
                <BackBtn onClick={onClose}>Abbrechen</BackBtn>
                <NextBtn onClick={() => {
                  const e = validateStep1();
                  if (Object.keys(e).length) { setErrors(e); return; }
                  setStep(2);
                }}>
                  Weiter — Fotos <ArrowRight size={15} />
                </NextBtn>
              </NavRow>
            </>
          )}

          {/* ── STEP 2: Photos ── */}
          {step === 2 && (
            <>
              <PhotoGrid>
                {photos.map((photo, idx) => (
                  <div key={idx}>
                    <PhotoSlot
                      $filled={!!photo}
                      onClick={() => fileRefs.current[idx]?.click()}
                    >
                      {photo ? (
                        <PhotoPreview src={photo.url} alt={`Foto ${idx + 1}`} />
                      ) : (
                        <>
                          <Image size={20} color="#A0ADB8" />
                          <PhotoLabel>Foto {idx + 1}</PhotoLabel>
                        </>
                      )}
                      <input
                        ref={el => fileRefs.current[idx] = el}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => handlePhoto(idx, e.target.files[0])}
                      />
                    </PhotoSlot>
                  </div>
                ))}
              </PhotoGrid>

              <PhotoCount>
                {photoCount === 0
                  ? 'Noch keine Fotos — du kannst Fotos auch später hinzufügen.'
                  : `${photoCount} von 5 Fotos ausgewählt`
                }
              </PhotoCount>

              <div style={{
                background: 'rgba(var(--color-accent-rgb),.06)',
                border: '1px solid rgba(var(--color-accent-rgb),.2)',
                borderRadius: 'var(--radius-card)',
                padding: '10px 14px', marginTop: 14,
              }}>
                <p style={{
                  fontFamily: 'var(--font-body)', fontSize: '.8rem',
                  color: 'var(--color-text)', lineHeight: 1.5,
                }}>
                  <strong style={{ color: 'var(--color-primary)' }}>Tipp:</strong>{' '}
                  Betriebe mit Fotos bekommen bis zu 42% mehr Klicks.
                  Außenansicht, Team und Arbeitsergebnisse funktionieren am besten.
                </p>
              </div>

              <NavRow>
                <BackBtn onClick={() => setStep(1)}>Zurück</BackBtn>
                <NextBtn onClick={() => setStep(3)}>
                  Weiter — Paket wählen <ArrowRight size={15} />
                </NextBtn>
              </NavRow>
            </>
          )}

          {/* ── STEP 3: Pricing ── */}
          {step === 3 && (
            <>
              <PricingCard
                path="setup"
                onCheckout={handleCheckout}
                loading={loading}
                companyName={companyName}
              />
              <NavRow style={{ marginTop: 16 }}>
                <BackBtn onClick={() => setStep(2)}>Zurück</BackBtn>
              </NavRow>
            </>
          )}
        </SheetBody>
      </Sheet>
    </Overlay>
  );
}
