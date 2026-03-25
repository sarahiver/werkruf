import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { Send, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import supabase from '../supabaseClient';
import { useIndustry } from '../context/IndustryContext';

const fadeUp = keyframes`from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}`;
const fadeIn = keyframes`from{opacity:0}to{opacity:1}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

const Section = styled.section`
  background: var(--color-primary);
  padding: 100px 24px;
  position: relative;
  overflow: hidden;
`;

const DiagStripes = styled.div`
  position: absolute; inset: 0;
  background: repeating-linear-gradient(
    -45deg, transparent, transparent 30px,
    rgba(var(--color-accent-rgb), 0.03) 30px,
    rgba(var(--color-accent-rgb), 0.03) 60px
  );
  pointer-events: none;
  display: ${({ $show }) => $show ? 'block' : 'none'};
`;

const Inner = styled.div`
  max-width: 1100px; margin: 0 auto;
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 80px; align-items: start;
  @media (max-width: 860px) { grid-template-columns: 1fr; gap: 48px; }
`;

const InfoCol = styled.div`animation: ${fadeUp} 0.6s ease both;`;

const Eyebrow = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: 0.75rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--color-accent); margin-bottom: 16px;
`;

const Title = styled.h2`
  font-size: clamp(2rem, 3.5vw, 2.8rem);
  text-transform: var(--text-transform);
  color: var(--color-white); line-height: 1.05; margin-bottom: 20px;
`;

const TitleAccent = styled.span`color: var(--color-accent);`;

const InfoText = styled.p`
  font-family: var(--font-body); font-size: 0.98rem;
  color: rgba(255,255,255,0.62); line-height: 1.78; margin-bottom: 40px;
`;

const ProcessList = styled.ol`list-style: none; counter-reset: step;`;

const ProcessItem = styled.li`
  counter-increment: step;
  display: grid; grid-template-columns: 36px 1fr;
  gap: 16px; padding: 18px 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  &:last-child { border-bottom: none; }
  &::before {
    content: counter(step, decimal-leading-zero);
    font-family: var(--font-display); font-weight: var(--heading-weight);
    font-size: 1.05rem; color: var(--color-accent); line-height: 1.5;
  }
`;

const ProcessText = styled.div`
  font-family: var(--font-body); font-size: 0.92rem;
  color: rgba(255,255,255,0.65); line-height: 1.5;
`;

const ProcessStrong = styled.strong`
  display: block; color: var(--color-white);
  font-weight: 600; font-size: 0.98rem; margin-bottom: 2px;
`;

const FormCol = styled.div`animation: ${fadeUp} 0.6s ease 0.15s both;`;

const FormCard = styled.div`
  background: var(--color-white);
  padding: 40px 36px;
  border-top: 5px solid var(--color-accent);
  border-radius: var(--radius-card);
  @media (max-width: 560px) { padding: 28px 20px; }
`;

const FormTitle = styled.h3`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.5rem; text-transform: var(--text-transform);
  color: var(--color-primary); margin-bottom: 4px;
`;

const FormSubtitle = styled.p`
  font-family: var(--font-body); font-size: 0.85rem;
  color: var(--color-text-muted); margin-bottom: 30px;
`;

const Field = styled.div`margin-bottom: 18px;`;

const Label = styled.label`
  display: block; font-family: var(--font-body); font-weight: 600;
  font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--color-primary); margin-bottom: 7px;
`;

const Input = styled.input`
  width: 100%; padding: 12px 15px;
  border: 2px solid ${({ $error }) => $error ? '#E53E3E' : 'var(--color-border)'};
  background: ${({ $error }) => $error ? '#FFF5F5' : 'var(--color-bg)'};
  color: var(--color-text);
  font-family: var(--font-body); font-size: 0.98rem;
  outline: none; border-radius: var(--radius-card);
  transition: border-color 0.2s, background 0.2s;
  &:focus { border-color: var(--color-primary); background: var(--color-white); }
  &::placeholder { color: #A0ADB8; }
`;

const Select = styled.select`
  width: 100%; padding: 12px 15px;
  border: 2px solid var(--color-border);
  background: var(--color-bg); color: var(--color-text);
  font-family: var(--font-body); font-size: 0.98rem;
  outline: none; cursor: pointer;
  border-radius: var(--radius-card);
  transition: border-color 0.2s;
  &:focus { border-color: var(--color-primary); background: var(--color-white); }
`;

const ErrorText = styled.span`
  display: block; margin-top: 4px;
  font-family: var(--font-body); font-size: 0.78rem; color: #E53E3E;
`;

const SubmitBtn = styled.button`
  width: 100%; display: flex; align-items: center;
  justify-content: center; gap: 10px; padding: 15px;
  background: ${({ disabled }) => disabled ? 'rgba(var(--color-accent-rgb), .6)' : 'var(--color-accent)'};
  color: var(--color-white);
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.1rem; letter-spacing: 0.08em;
  text-transform: var(--text-transform);
  border: none; margin-top: 8px;
  cursor: ${({ disabled }) => disabled ? 'not-allowed' : 'pointer'};
  border-radius: var(--radius-button);
  transition: filter 0.2s, transform 0.15s;
  &:hover:not(:disabled) { filter: brightness(0.9); transform: translateY(-1px); }
  .spin { animation: ${spin} 0.8s linear infinite; }
`;

const PrivacyNote = styled.p`
  font-family: var(--font-body); font-size: 0.75rem;
  color: #A0ADB8; text-align: center; margin-top: 12px; line-height: 1.5;
`;

const StatusBox = styled.div`
  display: flex; flex-direction: column;
  align-items: center; gap: 16px;
  padding: 40px 20px; text-align: center;
  animation: ${fadeIn} .3s ease;
  svg { color: ${({ $type }) => $type === 'success' ? '#38A169' : '#E53E3E'}; }
`;

const StatusTitle = styled.h4`
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1.6rem; text-transform: var(--text-transform);
  color: var(--color-primary);
`;

const StatusText = styled.p`
  font-family: var(--font-body); font-size: 0.92rem;
  color: var(--color-text-muted); line-height: 1.6;
`;

const RetryBtn = styled.button`
  padding: 12px 28px; background: var(--color-accent);
  color: var(--color-white);
  font-family: var(--font-display); font-weight: var(--heading-weight);
  font-size: 1rem; letter-spacing: 0.08em; text-transform: var(--text-transform);
  border: none; cursor: pointer; border-radius: var(--radius-button);
  &:hover { filter: brightness(0.9); }
`;

const INITIAL = { company_name: '', contact_person: '', phone: '', trade: '', city: '' };

const LeadForm = () => {
  const { key: industryKey, design } = useIndustry();
  const [form,    setForm]    = useState(INITIAL);
  const [errors,  setErrors]  = useState({});
  const [status,  setStatus]  = useState('idle');
  const [errorMsg,setErrorMsg]= useState('');

  const validate = () => {
    const e = {};
    if (!form.company_name.trim())   e.company_name   = 'Pflichtfeld';
    if (!form.contact_person.trim()) e.contact_person = 'Pflichtfeld';
    if (!form.phone.trim())          e.phone = 'Pflichtfeld';
    else if (!/^[\d\s+\-()]{6,}$/.test(form.phone)) e.phone = 'Keine gültige Nummer';
    return e;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = async () => {
    const ve = validate();
    if (Object.keys(ve).length > 0) { setErrors(ve); return; }
    setStatus('loading'); setErrorMsg('');
    try {
      const { error } = await supabase.from('leads').insert([{
        company_name:   form.company_name.trim(),
        contact_person: form.contact_person.trim(),
        phone:          form.phone.trim(),
        trade:          form.trade.trim() || null,
        city:           form.city.trim()  || null,
        source:         'lead_form',
        industry_key:   industryKey,
        status:         'new',
      }]);
      if (error) throw error;
      setStatus('success');
      setForm(INITIAL);
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'Unbekannter Fehler. Bitte versuch es nochmal.');
    }
  };

  return (
    <Section id="form">
      <DiagStripes $show={design.accentStripePattern} />
      <Inner>
        <InfoCol>
          <Eyebrow>Kostenloser Einstieg</Eyebrow>
          <Title>Dein <TitleAccent>Sichtbarkeits-</TitleAccent>Check</Title>
          <InfoText>
            Wir schauen uns an, wie dein Betrieb gerade online aufgestellt ist —
            und sagen dir ehrlich, was du verpasst. Kein Pitch, kein Druck.
          </InfoText>
          <ProcessList>
            <ProcessItem>
              <ProcessText><ProcessStrong>Formular ausfüllen</ProcessStrong>Dauert 60 Sekunden.</ProcessText>
            </ProcessItem>
            <ProcessItem>
              <ProcessText><ProcessStrong>Wir analysieren</ProcessStrong>Innerhalb von 48h schauen wir uns deinen Auftritt an.</ProcessText>
            </ProcessItem>
            <ProcessItem>
              <ProcessText><ProcessStrong>Klartext-Gespräch</ProcessStrong>Du kriegst ein konkretes Ergebnis — ohne Marketing-Sprech.</ProcessText>
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
                <StatusText>Deine Anfrage ist bei uns angekommen. Wir melden uns in 48h.</StatusText>
              </StatusBox>
            ) : status === 'error' ? (
              <StatusBox $type="error">
                <AlertCircle size={48} />
                <StatusTitle>Hoppla.</StatusTitle>
                <StatusText>{errorMsg}</StatusText>
                <RetryBtn onClick={() => setStatus('idle')}>Nochmal versuchen</RetryBtn>
              </StatusBox>
            ) : (
              <>
                <Field>
                  <Label>Betriebsname *</Label>
                  <Input type="text" name="company_name" value={form.company_name}
                    onChange={handleChange} placeholder="Sanitär Müller GmbH"
                    $error={!!errors.company_name} />
                  {errors.company_name && <ErrorText>{errors.company_name}</ErrorText>}
                </Field>
                <Field>
                  <Label>Ansprechpartner *</Label>
                  <Input type="text" name="contact_person" value={form.contact_person}
                    onChange={handleChange} placeholder="Max Müller"
                    $error={!!errors.contact_person} />
                  {errors.contact_person && <ErrorText>{errors.contact_person}</ErrorText>}
                </Field>
                <Field>
                  <Label>Telefon *</Label>
                  <Input type="tel" name="phone" value={form.phone}
                    onChange={handleChange} placeholder="+49 40 123456"
                    $error={!!errors.phone} />
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
                  <Input type="text" name="city" value={form.city}
                    onChange={handleChange} placeholder="Hamburg" />
                </Field>
                <SubmitBtn onClick={handleSubmit} disabled={status === 'loading'}>
                  {status === 'loading'
                    ? <><Loader size={18} className="spin" />Wird gesendet…</>
                    : <><Send size={18} />Check starten — kostenlos</>
                  }
                </SubmitBtn>
                <PrivacyNote>Deine Daten bleiben bei uns. Kein Newsletter, keine Weitergabe.</PrivacyNote>
              </>
            )}
          </FormCard>
        </FormCol>
      </Inner>
    </Section>
  );
};

export default LeadForm;
