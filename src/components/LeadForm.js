import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { Send, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import supabase from '../supabaseClient';

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const spin = keyframes`to { transform: rotate(360deg); }`;

const Section = styled.section`
  background: #002C51;
  padding: 100px 24px;
  position: relative;
  overflow: hidden;
`;

const DiagStripes = styled.div`
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(-45deg, transparent, transparent 30px, rgba(255,140,0,0.03) 30px, rgba(255,140,0,0.03) 60px);
  pointer-events: none;
`;

const Inner = styled.div`
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 80px;
  align-items: start;
  @media (max-width: 860px) { grid-template-columns: 1fr; gap: 48px; }
`;

const InfoCol = styled.div`
  animation: ${fadeUp} 0.6s ease both;
`;

const Eyebrow = styled.p`
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #FF8C00;
  margin-bottom: 16px;
`;

const Title = styled.h2`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 900;
  font-size: clamp(2rem, 3.5vw, 2.8rem);
  text-transform: uppercase;
  color: white;
  line-height: 1.05;
  margin-bottom: 20px;
`;

const TitleAccent = styled.span`
  color: #FF8C00;
`;

const InfoText = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.98rem;
  color: rgba(255,255,255,0.62);
  line-height: 1.78;
  margin-bottom: 40px;
`;

const ProcessList = styled.ol`
  list-style: none;
  counter-reset: step;
`;

const ProcessItem = styled.li`
  counter-increment: step;
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 16px;
  padding: 18px 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  &:last-child { border-bottom: none; }
  &::before {
    content: counter(step, decimal-leading-zero);
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 1.05rem;
    color: #FF8C00;
    line-height: 1.5;
  }
`;

const ProcessText = styled.div`
  font-family: 'Barlow', sans-serif;
  font-size: 0.92rem;
  color: rgba(255,255,255,0.65);
  line-height: 1.5;
`;

const ProcessStrong = styled.strong`
  display: block;
  color: white;
  font-weight: 600;
  font-size: 0.98rem;
  margin-bottom: 2px;
`;

const FormCol = styled.div`
  animation: ${fadeUp} 0.6s ease 0.15s both;
`;

const FormCard = styled.div`
  background: white;
  padding: 40px 36px;
  border-top: 5px solid #FF8C00;
`;

const FormTitle = styled.h3`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.5rem;
  text-transform: uppercase;
  color: #002C51;
  margin-bottom: 4px;
`;

const FormSubtitle = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.85rem;
  color: #5A6A7A;
  margin-bottom: 30px;
`;

const Field = styled.div`
  margin-bottom: 18px;
`;

const Label = styled.label`
  display: block;
  font-family: 'Barlow', sans-serif;
  font-weight: 600;
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #002C51;
  margin-bottom: 7px;
`;

const Input = styled.input`
  width: 100%;
  padding: 12px 15px;
  border: 2px solid ${({ $error }) => $error ? '#E53E3E' : '#D0D8E0'};
  background: ${({ $error }) => $error ? '#FFF5F5' : '#F8F9FA'};
  color: #1A1A1A;
  font-family: 'Barlow', sans-serif;
  font-size: 0.98rem;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
  border-radius: 0;
  &:focus { border-color: #002C51; background: white; }
  &::placeholder { color: #A0ADB8; }
`;

const Select = styled.select`
  width: 100%;
  padding: 12px 15px;
  border: 2px solid #D0D8E0;
  background: #F8F9FA;
  color: #1A1A1A;
  font-family: 'Barlow', sans-serif;
  font-size: 0.98rem;
  outline: none;
  cursor: pointer;
  border-radius: 0;
  transition: border-color 0.2s;
  &:focus { border-color: #002C51; background: white; }
`;

const ErrorText = styled.span`
  display: block;
  margin-top: 4px;
  font-family: 'Barlow', sans-serif;
  font-size: 0.78rem;
  color: #E53E3E;
`;

const SubmitBtn = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 15px;
  background: ${({ disabled }) => disabled ? '#D07000' : '#FF8C00'};
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: none;
  margin-top: 8px;
  cursor: ${({ disabled }) => disabled ? 'not-allowed' : 'pointer'};
  transition: background 0.2s, transform 0.15s;
  &:hover:not(:disabled) { background: #E07A00; transform: translateY(-1px); }
  .spin { animation: ${spin} 0.8s linear infinite; }
`;

const PrivacyNote = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.75rem;
  color: #A0ADB8;
  text-align: center;
  margin-top: 12px;
  line-height: 1.5;
`;

const StatusBox = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px 20px;
  text-align: center;
  svg { color: ${({ $type }) => $type === 'success' ? '#38A169' : '#E53E3E'}; }
`;

const StatusTitle = styled.h4`
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 1.6rem;
  text-transform: uppercase;
  color: #002C51;
`;

const StatusText = styled.p`
  font-family: 'Barlow', sans-serif;
  font-size: 0.92rem;
  color: #5A6A7A;
  line-height: 1.6;
`;

const RetryBtn = styled.button`
  padding: 12px 28px;
  background: #FF8C00;
  color: white;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  &:hover { background: #E07A00; }
`;

const INITIAL = { company_name: '', contact_person: '', phone: '', trade: '', city: '' };

const LeadForm = () => {
  const [form, setForm] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const validate = () => {
    const e = {};
    if (!form.company_name.trim()) e.company_name = 'Pflichtfeld';
    if (!form.contact_person.trim()) e.contact_person = 'Pflichtfeld';
    if (!form.phone.trim()) e.phone = 'Pflichtfeld';
    else if (!/^[\d\s+\-()]{6,}$/.test(form.phone)) e.phone = 'Keine gültige Nummer';
    return e;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = async () => {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setStatus('loading');
    setErrorMsg('');
    try {
      const { error } = await supabase.from('leads').insert([{
        company_name: form.company_name.trim(),
        contact_person: form.contact_person.trim(),
        phone: form.phone.trim(),
        trade: form.trade.trim() || null,
        city: form.city.trim() || null,
      }]);
      if (error) throw error;
      setStatus('success');
      setForm(INITIAL);
    } catch (err) {
      console.error('Supabase Fehler:', err);
      setStatus('error');
      setErrorMsg(err.message || 'Unbekannter Fehler. Bitte versuch es nochmal.');
    }
  };

  return (
    <Section id="form">
      <DiagStripes />
      <Inner>
        <InfoCol>
          <Eyebrow>Kostenloser Einstieg</Eyebrow>
          <Title>Dein <TitleAccent>Sichtbarkeits-</TitleAccent>Check</Title>
          <InfoText>
            Wir schauen uns an, wie dein Betrieb gerade online aufgestellt ist —
            und sagen dir ehrlich, was du verpasst. Kein Pitch, kein Druck.
            Erst wenn du sagst "das will ich haben", reden wir über alles Weitere.
          </InfoText>
          <ProcessList>
            <ProcessItem>
              <ProcessText>
                <ProcessStrong>Formular ausfüllen</ProcessStrong>
                Dauert 60 Sekunden. Wir brauchen nur das Nötigste.
              </ProcessText>
            </ProcessItem>
            <ProcessItem>
              <ProcessText>
                <ProcessStrong>Wir analysieren</ProcessStrong>
                Innerhalb von 48h schauen wir uns deinen Online-Auftritt an.
              </ProcessText>
            </ProcessItem>
            <ProcessItem>
              <ProcessText>
                <ProcessStrong>Klartext-Gespräch</ProcessStrong>
                Du kriegst ein konkretes Ergebnis — ohne Marketing-Sprech.
              </ProcessText>
            </ProcessItem>
          </ProcessList>
        </InfoCol>

        <FormCol>
          <FormCard>
            <FormTitle>Jetzt eintragen</FormTitle>
            <FormSubtitle>Kostenlos · Unverbindlich · Kein Spam</FormSubtitle>

            {status === 'success' ? (
              <StatusBox $type="success">
                <CheckCircle size={48} />
                <StatusTitle>Alles klar!</StatusTitle>
                <StatusText>
                  Deine Anfrage ist bei uns angekommen. Wir melden uns innerhalb von
                  48 Stunden bei dir — versprochen.
                </StatusText>
              </StatusBox>
            ) : status === 'error' ? (
              <StatusBox $type="error">
                <AlertCircle size={48} />
                <StatusTitle>Hoppla.</StatusTitle>
                <StatusText>
                  {errorMsg || 'Da ist was schiefgelaufen. Versuch es nochmal oder ruf uns direkt an.'}
                </StatusText>
                <RetryBtn onClick={() => setStatus('idle')}>Nochmal versuchen</RetryBtn>
              </StatusBox>
            ) : (
              <>
                <Field>
                  <Label>Betriebsname *</Label>
                  <Input type="text" name="company_name" value={form.company_name} onChange={handleChange} placeholder="Sanitär Müller GmbH" $error={!!errors.company_name} />
                  {errors.company_name && <ErrorText>{errors.company_name}</ErrorText>}
                </Field>
                <Field>
                  <Label>Ansprechpartner *</Label>
                  <Input type="text" name="contact_person" value={form.contact_person} onChange={handleChange} placeholder="Max Müller" $error={!!errors.contact_person} />
                  {errors.contact_person && <ErrorText>{errors.contact_person}</ErrorText>}
                </Field>
                <Field>
                  <Label>Telefon *</Label>
                  <Input type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="+49 40 123456" $error={!!errors.phone} />
                  {errors.phone && <ErrorText>{errors.phone}</ErrorText>}
                </Field>
                <Field>
                  <Label>Gewerk</Label>
                  <Select name="trade" value={form.trade} onChange={handleChange}>
                    <option value="">Bitte wählen (optional)</option>
                    <option value="sanitaer">Sanitär / Heizung</option>
                    <option value="elektro">Elektro</option>
                    <option value="maler">Maler / Lackierer</option>
                    <option value="schreiner">Schreiner / Tischler</option>
                    <option value="dachdecker">Dachdecker</option>
                    <option value="garten">Garten / Landschaftsbau</option>
                    <option value="reinigung">Reinigung</option>
                    <option value="kfz">KFZ</option>
                    <option value="sonstiges">Sonstiges</option>
                  </Select>
                </Field>
                <Field>
                  <Label>Stadt / Region</Label>
                  <Input type="text" name="city" value={form.city} onChange={handleChange} placeholder="Hamburg" />
                </Field>
                <SubmitBtn onClick={handleSubmit} disabled={status === 'loading'}>
                  {status === 'loading' ? (
                    <><Loader size={18} className="spin" /> Wird gesendet…</>
                  ) : (
                    <><Send size={18} /> Check starten — kostenlos</>
                  )}
                </SubmitBtn>
                <PrivacyNote>
                  Deine Daten bleiben bei uns. Kein Newsletter, keine Weitergabe.
                </PrivacyNote>
              </>
            )}
          </FormCard>
        </FormCol>
      </Inner>
    </Section>
  );
};

export default LeadForm;
