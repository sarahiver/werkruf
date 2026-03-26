import ProGate from '../../components/dashboard/ProGate';
import React, { useState, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, CheckCheck, Download, Star, ExternalLink, Smartphone } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;

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
  color: var(--color-text-muted); margin-bottom: 28px;
`;

const Grid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  @media(max-width: 700px) { grid-template-columns: 1fr; }
`;

const Card = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); padding: 24px;
  animation: ${fadeUp} .4s ease ${({ $d }) => $d || '0s'} both;
`;

const CardTitle = styled.h2`
  font-family: var(--font-display); font-weight: 700;
  font-size: 1rem; text-transform: uppercase; letter-spacing: .06em;
  color: var(--color-primary); margin-bottom: 6px;
`;

const CardSub = styled.p`
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text-muted); margin-bottom: 20px; line-height: 1.5;
`;

/* Link generator */
const LinkBox = styled.div`
  display: flex; gap: 8px; align-items: stretch;
  margin-bottom: 14px;
`;

const LinkInput = styled.input`
  flex: 1; padding: 10px 14px;
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text);
  background: var(--color-bg);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-card);
  outline: none;
  &:focus { border-color: var(--color-primary); }
`;

const IconBtn = styled.button`
  padding: 10px 14px;
  background: ${({ $primary }) => $primary ? 'var(--color-accent)' : 'var(--color-bg)'};
  color: ${({ $primary }) => $primary ? 'white' : 'var(--color-text-muted)'};
  border: 1px solid ${({ $primary }) => $primary ? 'var(--color-accent)' : 'var(--color-border)'};
  border-radius: var(--radius-card); cursor: pointer;
  display: flex; align-items: center; gap: 6px;
  font-family: var(--font-body); font-weight: 600; font-size: .82rem;
  transition: filter .2s;
  &:hover { filter: brightness(.9); }
  white-space: nowrap;
`;

const OpenBtn = styled.a`
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 18px;
  background: var(--color-primary); color: white;
  font-family: var(--font-body); font-weight: 700; font-size: .85rem;
  text-decoration: none; border-radius: var(--radius-button);
  transition: filter .2s; margin-top: 8px;
  &:hover { filter: brightness(1.15); }
`;

/* QR Code */
const QRWrap = styled.div`
  display: flex; flex-direction: column; align-items: center;
  padding: 24px;
  background: var(--color-bg); border-radius: var(--radius-card);
  margin-bottom: 16px;
`;

const QRLabel = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); margin-top: 12px; text-align: center;
`;

const DownloadBtn = styled.button`
  display: inline-flex; align-items: center; gap: 7px;
  width: 100%; justify-content: center;
  padding: 11px;
  background: var(--color-primary); color: white;
  font-family: var(--font-display); font-weight: 700;
  font-size: .88rem; letter-spacing: .06em; text-transform: uppercase;
  border: none; border-radius: var(--radius-button); cursor: pointer;
  transition: filter .2s; margin-bottom: 8px;
  &:hover { filter: brightness(1.15); }
`;

/* Tips */
const TipCard = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); padding: 20px;
  margin-top: 16px; grid-column: 1 / -1;
  animation: ${fadeUp} .4s ease .1s both;
`;

const TipList = styled.div`
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px; margin-top: 14px;
`;

const TipItem = styled.div`
  display: flex; gap: 10px; align-items: flex-start;
`;

const TipNum = styled.div`
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--color-accent); color: white;
  font-family: var(--font-display); font-weight: 900; font-size: .8rem;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
`;

const TipText = styled.p`
  font-family: var(--font-body); font-size: .82rem;
  color: var(--color-text); line-height: 1.5;
`;

const NoBusiness = styled.div`
  text-align: center; padding: 60px 24px;
  background: var(--color-bg); border-radius: var(--radius-card);
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function DashboardKundenGewinnung() {
  const { profile } = useAuthContext();
  const [copied, setCopied] = useState(false);
  const qrRef = useRef(null);

  const placeId     = profile?.google_place_id;
  const companyName = profile?.company_name || 'Dein Betrieb';
  const reviewUrl   = placeId
    ? `https://search.google.com/local/writereview?placeid=${placeId}`
    : null;

  const handleCopy = () => {
    if (!reviewUrl) return;
    navigator.clipboard.writeText(reviewUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownloadQR = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return;

    const canvas = document.createElement('canvas');
    const size   = 400;
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const img  = new Image();
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);

    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const link = document.createElement('a');
      link.download = `WERKRUF-QR-${companyName.replace(/\s/g, '-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = url;
  };

  if (!placeId) {
    return (
      <Page>
        <PageTitle>Kunden-Gewinnung</PageTitle>
        <NoBusiness>
          <Star size={36} color="var(--color-accent)" style={{ marginBottom: 14, display: 'block', margin: '0 auto 14px' }} />
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem',
            textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: 8 }}>
            Betrieb noch nicht verknüpft
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '.88rem',
            color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            Verknüpfe zuerst deinen Google Business Eintrag in der Übersicht,<br/>
            dann generieren wir deinen persönlichen Bewertungslink.
          </p>
        </NoBusiness>
      </Page>
    );
  }

  return (
    <ProGate feature="Kunden-Gewinnung">
    <Page>
      <PageTitle>Kunden-Gewinnung</PageTitle>
      <PageSub>
        Mehr Bewertungen = mehr Sichtbarkeit. Teile deinen Link und watch your rating climb.
      </PageSub>

      <Grid>
        {/* Review Link */}
        <Card $d="0s">
          <CardTitle>Dein Bewertungslink</CardTitle>
          <CardSub>
            Schick diesen Link direkt nach dem Auftrag — per WhatsApp, SMS oder E-Mail.
            Kunden landen sofort auf dem Bewertungsformular.
          </CardSub>

          <LinkBox>
            <LinkInput value={reviewUrl} readOnly />
            <IconBtn $primary onClick={handleCopy}>
              {copied ? <><CheckCheck size={15} /> Kopiert!</> : <><Copy size={15} /> Kopieren</>}
            </IconBtn>
          </LinkBox>

          <OpenBtn href={reviewUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={15} /> Link testen
          </OpenBtn>

          <div style={{ marginTop: 20, padding: '14px 16px',
            background: 'var(--color-bg)', borderRadius: 'var(--radius-card)',
            borderLeft: '3px solid var(--color-accent)' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '.82rem',
              color: 'var(--color-text)', lineHeight: 1.6 }}>
              <strong>WhatsApp-Vorlage:</strong><br />
              "Hallo [Name], vielen Dank für deinen Auftrag! Über eine kurze Bewertung würde ich mich sehr freuen: {reviewUrl}"
            </p>
          </div>
        </Card>

        {/* QR Code */}
        <Card $d=".06s">
          <CardTitle>QR-Code zum Ausdrucken</CardTitle>
          <CardSub>
            Hänge den QR-Code in deinem Fahrzeug, im Büro oder auf Rechnungen.
            Kunden scannen — fertig.
          </CardSub>

          <QRWrap ref={qrRef}>
            <QRCodeSVG
              value={reviewUrl}
              size={180}
              bgColor="#ffffff"
              fgColor="#002C51"
              level="M"
            />
            <QRLabel>
              <Smartphone size={12} style={{ display: 'inline', marginRight: 4 }} />
              Scannen → Bewertung schreiben
            </QRLabel>
          </QRWrap>

          <DownloadBtn onClick={handleDownloadQR}>
            <Download size={16} /> QR-Code als PNG herunterladen
          </DownloadBtn>

          <p style={{ fontFamily: 'var(--font-body)', fontSize: '.75rem',
            color: 'var(--color-text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
            Für Druckqualität empfehlen wir min. 300 DPI.
          </p>
        </Card>

        {/* Tips */}
        <TipCard>
          <CardTitle>
            <Star size={16} color="var(--color-accent)" style={{ display: 'inline', marginRight: 7, verticalAlign: 'middle' }} />
            Mehr Bewertungen in 30 Tagen
          </CardTitle>
          <TipList>
            {[
              'Link direkt nach Auftragsabschluss per WhatsApp schicken — Timing ist alles.',
              'QR-Code auf Rechnungen drucken — Erinnerung beim Bezahlen.',
              'Freundlich ansprechen: "Würden Sie 2 Minuten für eine kurze Bewertung opfern?"',
              'Jede Bewertung sofort beantworten — auch positive. Google liebt aktive Profile.',
              'Mit WERKRUF PRO: Automatische Bewertungsanfragen nach Auftragsabschluss.',
            ].map((tip, i) => (
              <TipItem key={i}>
                <TipNum>{i + 1}</TipNum>
                <TipText>{tip}</TipText>
              </TipItem>
            ))}
          </TipList>
        </TipCard>
      </Grid>
    </Page>
    </ProGate>
  );
}
