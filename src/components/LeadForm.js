import React, { useState } from 'react';
import styled from 'styled-components';
import { AlertCircle, CheckCircle, FileText, Loader } from 'lucide-react';
import PlacesSearch from './PlacesSearch';
import supabase from '../supabaseClient';
import { useIndustry } from '../context/IndustryContext';
import { savePublicFunnel } from '../utils/publicFunnel';

const Section=styled.section`background:var(--color-primary);padding:90px 24px`;
const Inner=styled.div`max-width:1050px;margin:auto;display:grid;grid-template-columns:1fr 1fr;gap:70px;@media(max-width:850px){grid-template-columns:1fr}`;
const H2=styled.h2`color:white;font-size:clamp(2rem,4vw,3rem);margin:8px 0 20px`;
const Accent=styled.span`color:var(--color-accent)`;
const Copy=styled.p`color:rgba(255,255,255,.7);line-height:1.7`;
const Steps=styled.ol`color:white;line-height:2.4;margin-top:24px;padding-left:24px`;
const Card=styled.div`background:white;border-top:5px solid var(--color-accent);padding:32px;border-radius:var(--radius-card)`;
const Label=styled.label`display:block;font-weight:700;font-size:.8rem;margin:20px 0 7px;color:var(--color-primary)`;
const Input=styled.input`width:100%;padding:13px;border:2px solid ${p=>p.$error?'#d93025':'var(--color-border)'};border-radius:var(--radius-card);font:inherit`;
const Button=styled.button`width:100%;border:0;border-radius:var(--radius-button);padding:15px;margin-top:20px;background:var(--color-accent);color:white;font-weight:800;cursor:pointer;display:flex;gap:9px;align-items:center;justify-content:center;&:disabled{opacity:.6;cursor:not-allowed}`;
const Selected=styled.div`padding:14px;background:#f4f6f8;border-radius:6px;color:var(--color-primary);display:flex;justify-content:space-between;gap:12px`;
const LinkButton=styled.button`border:0;background:none;color:var(--color-accent);text-decoration:underline;cursor:pointer`;
const Note=styled.p`font-size:.78rem;color:#66717e;line-height:1.5;margin-top:12px`;
const Message=styled.div`padding:20px;text-align:center;color:var(--color-primary);svg{margin-bottom:10px}`;

export default function LeadForm({ result, onPlaceSelect, onNoResults, onReset, searchResetKey=0 }) {
  const { key: industryKey }=useIndustry();
  const [email,setEmail]=useState(''); const [error,setError]=useState(''); const [status,setStatus]=useState('idle');
  const selected=result?.dataSource!=='manual'&&result?.placeId?result:null;
  const submit=async()=>{
    if(!selected){setError('Bitte wähle einen Betrieb aus der Google-Vorschlagsliste.');return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError('Bitte gib eine gültige E-Mail-Adresse ein.');return;}
    setStatus('loading');setError('');
    const {data,error:invokeError}=await supabase.functions.invoke('request-profile-report',{body:{email:email.trim(),placeId:selected.placeId,industryKey}});
    if(invokeError||!data?.requestId){setStatus('error');setError(data?.error==='legal_gate_closed'?'Der PDF-Versand ist noch nicht rechtlich freigegeben. Bitte versuche es später erneut.':'Die Anfrage konnte nicht angenommen werden. Bitte versuche es erneut.');return;}
    savePublicFunnel({email,result:selected,reportRequestId:data.requestId}); setStatus('success');
  };
  return <Section id="form"><Inner><div><Copy>Kostenloser Bericht</Copy><H2>Dein kostenloser <Accent>Google-Profil-Bericht</Accent></H2><Copy>Nur die im öffentlichen Check tatsächlich verfügbaren Angaben werden ausgewertet. Kein Ranking, keine behauptete Sichtbarkeitsmessung.</Copy><Steps><li>Betrieb auswählen</li><li>Profil-Check prüfen</li><li>PDF-Bericht per E-Mail erhalten</li></Steps></div><Card>
    {status==='success'?<Message role="status"><CheckCircle size={46} color="#1e7e34"/><h3>Anfrage angenommen</h3><p>Dein Bericht wurde zuverlässig gespeichert und zur Erstellung und Zustellung an <strong>{email}</strong> angenommen. Die E-Mail ist damit noch nicht als zugestellt bestätigt.</p><p><a href="/signup">Vollständigen Health Score per Google-Business-Verbindung freischalten</a></p></Message>:<>
      <h3>PDF-Bericht anfordern</h3>{selected?<Selected><span><strong>{selected.name}</strong><br/><small>Aus dem öffentlichen Profil-Check übernommen</small></span><LinkButton type="button" onClick={()=>{onReset();setStatus('idle')}}>Betrieb ändern</LinkButton></Selected>:<><Label>Betrieb *</Label><PlacesSearch onSelect={onPlaceSelect} onNoResults={onNoResults} resetKey={searchResetKey}/>{result?.dataSource==='manual'&&<Note><AlertCircle size={14}/> Für eine manuelle Eingabe erzeugen wir keinen Bericht mit fingierten Google-Daten. Wähle einen bestätigten Vorschlag oder verbinde dein verwaltetes Profil nach der Registrierung.</Note>}</>}
      <Label htmlFor="report-email">E-Mail-Adresse *</Label><Input id="report-email" type="email" value={email} onChange={e=>{setEmail(e.target.value);setError('')}} $error={!!error}/>{error&&<Note role="alert">{error}</Note>}
      <Button onClick={submit} disabled={status==='loading'}>{status==='loading'?<><Loader size={18}/>Anfrage wird angenommen…</>:<><FileText size={18}/>Kostenlosen PDF-Bericht anfordern</>}</Button><Note>Transaktionsmail zur angeforderten Leistung. Keine Newsletter-Anmeldung und keine Marketing-Einwilligung.</Note>
    </>}</Card></Inner></Section>;
}
