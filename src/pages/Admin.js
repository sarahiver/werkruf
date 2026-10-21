import React, { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { Users, AlertTriangle, RefreshCw, LogOut, Search, X, MessageCircle } from 'lucide-react';
import { useAuthContext } from '../context/AuthContext';
import supabase from '../supabaseClient';
import { formatAdminDate, getSubscriptionLabel } from '../utils/adminOps';

const fadeUp = keyframes`from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}`;
const spin   = keyframes`to{transform:rotate(360deg)}`;

const Page = styled.div`
  min-height: 100vh; background: var(--color-bg);
  padding: 0;
`;

const TopBar = styled.div`
  background: var(--color-primary);
  border-bottom: 3px solid var(--color-accent);
  padding: 16px 32px;
  display: flex; align-items: center; justify-content: space-between;
`;

const Logo = styled.p`
  font-family: var(--font-display); font-weight: 900;
  font-size: 1rem; letter-spacing: 3px; text-transform: uppercase; color: white;
`;

const AdminBadge = styled.span`
  background: rgba(var(--color-accent-rgb),.2);
  color: var(--color-accent);
  font-family: var(--font-body); font-weight: 700;
  font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 8px; border-radius: var(--radius-button);
`;

const SignOutBtn = styled.button`
  display: flex; align-items: center; gap: 6px;
  background: none; border: 1px solid rgba(255,255,255,.2);
  color: rgba(255,255,255,.6); font-family: var(--font-body); font-size: .82rem;
  padding: 6px 14px; border-radius: var(--radius-button); cursor: pointer;
  &:hover { color: white; border-color: rgba(255,255,255,.4); }
`;

const Inner = styled.div`
  max-width: 1200px; margin: 0 auto; padding: 32px 24px;
`;

const StatsGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px; margin-bottom: 32px;
`;

const StatCard = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); padding: 20px;
  border-left: 4px solid ${({ $color }) => $color || 'var(--color-accent)'};
  animation: ${fadeUp} .4s ease ${({ $d }) => $d || '0s'} both;
`;

const StatNum = styled.p`
  font-family: var(--font-display); font-weight: 900;
  font-size: 2.2rem; line-height: 1;
  color: ${({ $c }) => $c || 'var(--color-primary)'};
`;

const StatLabel = styled.p`
  font-family: var(--font-body); font-size: .72rem;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--color-text-muted); margin-top: 6px;
`;

const Section = styled.div`
  background: var(--color-white); border: 1px solid var(--color-border);
  border-radius: var(--radius-card); margin-bottom: 20px;
  animation: ${fadeUp} .4s ease .1s both;
`;

const SectionHead = styled.div`
  padding: 16px 20px; border-bottom: 1px solid var(--color-border);
  display: flex; align-items: center; justify-content: space-between;
`;

const SectionTitle = styled.h2`
  font-family: var(--font-display); font-weight: 700;
  font-size: 1rem; text-transform: uppercase; color: var(--color-primary);
`;

const RefreshBtn = styled.button`
  display: flex; align-items: center; gap: 6px;
  background: none; border: 1px solid var(--color-border);
  color: var(--color-text-muted); font-family: var(--font-body); font-size: .8rem;
  padding: 6px 12px; border-radius: var(--radius-button); cursor: pointer;
  &:hover { border-color: var(--color-primary); color: var(--color-primary); }
  .spin { animation: ${spin} .8s linear infinite; }
`;

const Table = styled.table`width: 100%; border-collapse: collapse;`;
const Th = styled.th`
  padding: 12px 16px; text-align: left;
  font-family: var(--font-body); font-size: .72rem;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
`;
const Td = styled.td`
  padding: 12px 16px;
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text); border-bottom: 1px solid var(--color-border);
`;
const Tr = styled.tr`&:hover td { background: rgba(var(--color-primary-rgb),.02); }`;

const PlanBadge = styled.span`
  display: inline-block;
  background: ${({ $plan }) =>
    $plan === 'pro'   ? 'rgba(var(--color-accent-rgb),.1)' :
    $plan === 'trial' ? '#E8F5E9' : 'var(--color-bg)'};
  color: ${({ $plan }) =>
    $plan === 'pro'   ? 'var(--color-accent)' :
    $plan === 'trial' ? '#1E7E34' : 'var(--color-text-muted)'};
  font-family: var(--font-body); font-weight: 700;
  font-size: .68rem; letter-spacing: .08em; text-transform: uppercase;
  padding: 2px 8px; border-radius: 3px;
`;

const ScoreDot = styled.span`
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: ${({ $s }) => $s >= 70 ? '#1E7E34' : $s >= 45 ? '#D48A00' : '#D93025'};
  margin-right: 6px;
`;

const Empty = styled.div`
  padding: 40px; text-align: center;
  font-family: var(--font-body); font-size: .88rem; color: var(--color-text-muted);
`;

const Status = styled.span`
  display: inline-block; padding: 3px 7px; border-radius: 4px; font-size: .72rem; font-weight: 700;
  color: ${({ $ok }) => $ok ? '#1E7E34' : '#B42318'};
  background: ${({ $ok }) => $ok ? '#E8F5E9' : '#FDECEC'};
`;

const Reason = styled.div`
  max-width: 260px; color: ${({ $ok }) => $ok ? 'var(--color-text-muted)' : '#B42318'};
  font-size: .76rem; line-height: 1.35; white-space: normal;
`;

const SpinIcon = styled(RefreshCw)`animation: ${spin} .8s linear infinite;`;

/* ─────────────────────────────────────────────
   H3-ERGAENZUNGEN
───────────────────────────────────────────── */

const SearchRow = styled.form`
  display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;
`;

const SearchInput = styled.input`
  flex: 1 1 280px; padding: 10px 12px;
  font-family: var(--font-body); font-size: .88rem;
  border: 1px solid var(--color-border); border-radius: var(--radius-button);
  background: var(--color-white); color: var(--color-text);
`;

const Btn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 14px; cursor: pointer;
  font-family: var(--font-body); font-weight: 700; font-size: .8rem;
  border-radius: var(--radius-button);
  border: 1px solid ${({ $gefahr }) => ($gefahr ? '#D93025' : 'var(--color-border)')};
  background: ${({ $haupt, $gefahr }) =>
    $gefahr ? '#FDECEC' : $haupt ? 'var(--color-accent)' : 'var(--color-white)'};
  color: ${({ $haupt, $gefahr }) =>
    $gefahr ? '#B42318' : $haupt ? 'var(--color-white)' : 'var(--color-text)'};
  &:disabled { opacity: .55; cursor: default; }
`;

const Ampel = styled.span`
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-body); font-weight: 700; font-size: .72rem;
  text-transform: uppercase; letter-spacing: .08em;
  color: ${({ $stufe }) =>
    $stufe === 'blockiert' ? '#B42318' : $stufe === 'aufmerksamkeit' ? '#8A5A00' : '#1E7E34'};
`;

const Bloecke = styled.div`
  display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
`;

const Block = styled.div`
  border: 1px solid var(--color-border); border-radius: var(--radius-card);
  padding: 14px; background: var(--color-white);
`;

const BlockTitel = styled.h3`
  font-family: var(--font-body); font-weight: 700; font-size: .72rem;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--color-text-muted); margin: 0 0 8px;
`;

const Zeile = styled.div`
  display: flex; justify-content: space-between; gap: 10px;
  font-family: var(--font-body); font-size: .82rem;
  padding: 3px 0; color: var(--color-text);
  span:first-child { color: var(--color-text-muted); }
  span:last-child { font-weight: 700; text-align: right; word-break: break-word; }
`;

const Bestaetigung = styled.div`
  border: 2px solid #D93025; border-radius: var(--radius-card);
  background: #FDECEC; padding: 16px; margin-top: 12px;
  font-family: var(--font-body); font-size: .85rem; color: var(--color-text);
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function Admin() {
  const { isAdmin, signOut, loading: authLoading } = useAuthContext();
  const navigate = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [suche, setSuche] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  /* Detailansicht. Ein Kunde, gezielt geladen — §43: die Liste bleibt
     billig, die Details kosten erst beim Hinsehen. */
  const [offenerKunde, setOffenerKunde] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLaedt, setSnapshotLaedt] = useState(false);
  const [snapshotFehler, setSnapshotFehler] = useState('');

  const [bestaetigung, setBestaetigung] = useState(null);
  const [aktionLaeuft, setAktionLaeuft] = useState(false);
  const [aktionsErgebnis, setAktionsErgebnis] = useState(null);

  /* Direkter Draht: offene Anfragen der Founding Partner. Oben auf der
     Seite, weil sie das Zeitkritischste sind, was ein Admin hier
     sieht. */
  const [supportAnfragen, setSupportAnfragen] = useState([]);
  const [supportFehler, setSupportFehler]     = useState('');
  const [supportLaeuft, setSupportLaeuft]     = useState(null); // requestId waehrend eines Statuswechsels

  /* Ein Weg zum Server, eine Stelle fuer Fehler. Jede Aktion geht
     ueber admin-ops; das Frontend kennt keine Tabelle und keine RPC. */
  const rufeAdminOps = async (action, params = {}) => {
    const { data, error } = await supabase.functions.invoke('admin-ops', {
      body: { action, params },
    });
    if (error) throw new Error(error.message || 'Aufruf fehlgeschlagen');
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const ladeListe = async (begriff = suche) => {
    setRefreshing(true);
    setLoadError('');
    try {
      const [ops, leadsResult, support] = await Promise.all([
        rufeAdminOps('list_customers', { suche: begriff, limit: 50 }),
        supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(50),
        /* Eigener catch: Ein Fehler hier darf die Kundenliste nicht
           mitreissen. Die Anfragen sind wichtig, aber nicht wichtiger
           als alles andere auf der Seite. */
        rufeAdminOps('list_support_requests', { status: 'open', limit: 50 })
          .catch((e) => ({ requests: [], fehler: e.message })),
      ]);
      if (leadsResult.error) throw leadsResult.error;
      setCustomers(ops?.customers || []);
      setLeads(leadsResult.data || []);
      setSupportAnfragen(support?.requests || []);
      setSupportFehler(support?.fehler || '');
    } catch (err) {
      /* §24: brauchbar, aber ohne interne Details. Der Code steht im
         Function-Log. */
      setLoadError(`Die Admin-Daten konnten nicht geladen werden: ${err.message}`);
      setCustomers([]);
      setLeads([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    ladeListe('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  /* Nur laden. Getrennt von oeffneKunde, weil nach einer Aktion neu
     geladen wird — und dabei darf die Rueckmeldung zur Aktion nicht
     verschwinden.

     Der erste Entwurf hatte beides in einer Funktion: oeffneKunde
     setzte aktionsErgebnis auf null, und fuehreAus rief es danach
     auf. Ergebnis: "Job eingereiht, Job-ID ..." war eine
     Millisekunde sichtbar. Aufgefallen ist das nicht beim Lesen,
     sondern in adminSupport.test.js. */
  const setzeSupportStatus = async (requestId, status) => {
    setSupportLaeuft(requestId);
    setSupportFehler('');
    try {
      await rufeAdminOps('set_support_status', { requestId, status });
      /* Nach dem Wechsel verschwindet die Anfrage aus "offen". Lokal
         entfernen statt neu laden — schneller, und die Liste ist klein. */
      setSupportAnfragen((liste) => liste.filter((a) => a.id !== requestId));
    } catch (e) {
      setSupportFehler(e.message || 'Statuswechsel fehlgeschlagen.');
    } finally {
      setSupportLaeuft(null);
    }
  };

  const ladeSnapshot = async (kunde) => {
    setSnapshot(null);
    setSnapshotFehler('');
    setSnapshotLaedt(true);
    try {
      const daten = await rufeAdminOps('get_customer_support_state', { userId: kunde.id });
      if (!daten?.snapshot) throw new Error(daten?.error || 'Kein Snapshot');
      setSnapshot(daten.snapshot);
    } catch (err) {
      setSnapshotFehler(err.message);
    } finally {
      setSnapshotLaedt(false);
    }
  };

  const oeffneKunde = async (kunde) => {
    setOffenerKunde(kunde);
    setBestaetigung(null);
    setAktionsErgebnis(null);
    await ladeSnapshot(kunde);
  };

  const fuehreAus = async (action, params) => {
    setAktionLaeuft(true);
    setAktionsErgebnis(null);
    try {
      const daten = await rufeAdminOps(action, params);
      setAktionsErgebnis({ ok: daten?.ok !== false, action, daten });
      /* Nach einer schreibenden Aktion ist der Snapshot veraltet.
         Neu laden statt im Browser nachrechnen — der Server ist die
         Wahrheit. */
      if (offenerKunde) await ladeSnapshot(offenerKunde);
      await ladeListe();
    } catch (err) {
      setAktionsErgebnis({ ok: false, action, fehler: err.message });
    } finally {
      setAktionLaeuft(false);
      setBestaetigung(null);
    }
  };

  if (authLoading || !isAdmin) return null;

  const fmt = (d) => formatAdminDate(d);
  const fmtZ = (d) => formatAdminDate(d, true);

  const gesamt = customers.length;
  const proUsers = customers.filter((p) => p.plan === 'pro').length;
  const foundingUsers = customers.filter((p) => p.plan === 'founding_partner').length;
  const mitGoogle = customers.filter((p) => p.googleStatus === 'active').length;
  const ohneConsent = customers.filter((p) => !p.consentVorhanden).length;
  const setupLeads = leads.filter((l) => l.needs_manual_setup && l.status === 'new').length;

  return (
    <Page>
      <TopBar>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo>WERKRUF</Logo>
          <AdminBadge>Admin</AdminBadge>
        </div>
        <SignOutBtn onClick={async () => { await signOut(); navigate('/'); }}>
          <LogOut size={14} /> Abmelden
        </SignOutBtn>
      </TopBar>

      <Inner>
        {loadError && <Empty>{loadError}</Empty>}

        <StatsGrid>
          <StatCard $color="var(--color-accent)" $d="0s">
            <StatNum>{gesamt}</StatNum>
            <StatLabel>{suche ? 'Treffer' : 'Kunden (neueste 50)'}</StatLabel>
          </StatCard>
          <StatCard $color="#1E7E34" $d=".05s">
            <StatNum $c="#1E7E34">{proUsers}</StatNum>
            <StatLabel>Pro</StatLabel>
          </StatCard>
          <StatCard $color="var(--color-accent)" $d=".1s">
            <StatNum>{foundingUsers}</StatNum>
            <StatLabel>Founding Partner</StatLabel>
          </StatCard>
          <StatCard $color="var(--color-primary)" $d=".15s">
            <StatNum>{mitGoogle}</StatNum>
            <StatLabel>Google aktiv</StatLabel>
          </StatCard>
          {ohneConsent > 0 && (
            <StatCard $color="#D48A00" $d=".2s">
              <StatNum $c="#D48A00">{ohneConsent}</StatNum>
              <StatLabel>Ohne Zustimmung</StatLabel>
            </StatCard>
          )}
          {setupLeads > 0 && (
            <StatCard $color="#D93025" $d=".25s">
              <StatNum $c="#D93025">{setupLeads}</StatNum>
              <StatLabel>Offene Setup-Aufträge</StatLabel>
            </StatCard>
          )}
        </StatsGrid>

        {/* ── DIREKTER DRAHT (21.10.2026) ──
            Offene Supportanfragen der Founding Partner. Antworten
            geschieht per Mail an die angezeigte Adresse; hier wird nur
            der Status gefuehrt. Kein Antwortfeld — ein zweiter Kanal
            neben der Mail waere ein zweiter Ort, an dem Gespraeche
            verloren gehen. */}
        {(supportAnfragen.length > 0 || supportFehler) && (
          <Section data-testid="admin-support">
            <SectionHead>
              <SectionTitle>
                <MessageCircle size={15} style={{ display: 'inline', marginRight: 8, color: 'var(--color-accent)', verticalAlign: 'middle' }} />
                Direkter Draht — {supportAnfragen.length} offene Anfrage{supportAnfragen.length === 1 ? '' : 'n'}
              </SectionTitle>
            </SectionHead>
            {supportFehler && <Reason style={{ color: '#B3261E' }}>{supportFehler}</Reason>}
            {supportAnfragen.map((a) => (
              <Block key={a.id} style={{ marginBottom: 12 }}>
                <BlockTitel>
                  {a.betreff}
                  <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 10, fontSize: '.8rem' }}>
                    {a.betrieb || 'Betrieb unbekannt'} · {fmt(a.seit)}
                  </span>
                </BlockTitel>
                <Zeile>
                  <span>Antwort an</span>
                  <span>
                    {a.email
                      ? <a href={`mailto:${a.email}?subject=${encodeURIComponent('Re: ' + a.betreff)}`}>{a.email}</a>
                      : '—'}
                  </span>
                </Zeile>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '.88rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: '10px 0 14px' }}>
                  {a.text}
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Btn type="button" $haupt disabled={supportLaeuft === a.id}
                       onClick={() => setzeSupportStatus(a.id, 'answered')}>
                    Als beantwortet markieren
                  </Btn>
                  <Btn type="button" disabled={supportLaeuft === a.id}
                       onClick={() => setzeSupportStatus(a.id, 'closed')}>
                    Erledigt
                  </Btn>
                </div>
              </Block>
            ))}
          </Section>
        )}

        {/* ── SUCHE (§5) ── */}
        <Section>
          <SectionHead>
            <SectionTitle>
              <Users size={15} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
              Kunde finden
            </SectionTitle>
            <RefreshBtn onClick={() => ladeListe()} disabled={refreshing}>
              {refreshing ? <SpinIcon size={13} /> : <RefreshCw size={13} />}
              Aktualisieren
            </RefreshBtn>
          </SectionHead>

          <div style={{ padding: '0 16px 16px' }}>
            <SearchRow
              onSubmit={(e) => { e.preventDefault(); ladeListe(suche); }}
            >
              <SearchInput
                aria-label="Suche nach E-Mail, Unternehmen, User-ID oder Standort"
                placeholder="E-Mail, Unternehmen, User-ID oder Standortname"
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
              />
              <Btn type="submit" $haupt disabled={refreshing}>
                <Search size={14} /> Suchen
              </Btn>
              {suche && (
                <Btn type="button" onClick={() => { setSuche(''); ladeListe(''); }}>
                  Zurücksetzen
                </Btn>
              )}
            </SearchRow>
          </div>

          {loading ? (
            <Empty><SpinIcon size={20} style={{ margin: '0 auto', display: 'block' }} /></Empty>
          ) : customers.length === 0 ? (
            <Empty>{suche ? `Kein Kunde zu „${suche}" gefunden.` : 'Keine Kunden gefunden.'}</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Betrieb</Th>
                    <Th>Plan</Th>
                    <Th>Google</Th>
                    <Th>Zustimmung</Th>
                    <Th>Registriert</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((p) => (
                    <Tr key={p.id}>
                      <Td>
                        <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                          {p.unternehmen || '—'}
                        </div>
                        <div style={{ fontSize: '.75rem', color: 'var(--color-text-muted)' }}>
                          {p.email || 'Keine E-Mail'}
                        </div>
                      </Td>
                      <Td>
                        <PlanBadge $plan={p.plan}>{p.plan || 'free'}</PlanBadge>
                        <div style={{ marginTop: 5, fontSize: '.75rem' }}>{getSubscriptionLabel(p)}</div>
                      </Td>
                      <Td>
                        <Status $ok={p.googleStatus === 'active'}>
                          {p.googleStatus === 'active' ? 'Aktiv' : String(p.googleStatus).replaceAll('_', ' ')}
                        </Status>
                      </Td>
                      <Td>
                        <Status $ok={p.consentVorhanden}>
                          {p.consentVorhanden ? 'liegt vor' : 'fehlt'}
                        </Status>
                      </Td>
                      <Td>{fmt(p.registriertAm)}</Td>
                      <Td>
                        <Btn type="button" onClick={() => oeffneKunde(p)}>
                          Support-Ansicht
                        </Btn>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Section>

        {/* ── SUPPORT-ANSICHT (§4, §6, §30) ── */}
        {offenerKunde && (
          <Section>
            <SectionHead>
              <SectionTitle>
                {offenerKunde.unternehmen || offenerKunde.email || offenerKunde.id}
                {snapshot && (
                  <Ampel $stufe={snapshot.ampel.stufe} style={{ marginLeft: 12 }}>
                    <ScoreDot $s={snapshot.ampel.stufe === 'ok' ? 100 : snapshot.ampel.stufe === 'aufmerksamkeit' ? 50 : 10} />
                    {snapshot.ampel.stufe}
                  </Ampel>
                )}
              </SectionTitle>
              <Btn type="button" onClick={() => { setOffenerKunde(null); setSnapshot(null); }}>
                <X size={14} /> Schließen
              </Btn>
            </SectionHead>

            <div style={{ padding: 16 }}>
              {snapshotLaedt && <Empty><SpinIcon size={18} /></Empty>}
              {snapshotFehler && <Reason>Support-Zustand nicht ladbar: {snapshotFehler}</Reason>}

              {snapshot && (
                <>
                  {snapshot.ampel.gruende.length > 0 && (
                    <Reason $ok={false} style={{ maxWidth: 'none', marginBottom: 14 }}>
                      {snapshot.ampel.gruende.map((g) => `${g.stufe}: ${g.grund}`).join(' · ')}
                    </Reason>
                  )}

                  <Bloecke>
                    <Block>
                      <BlockTitel>Identität</BlockTitel>
                      <Zeile><span>E-Mail</span><span>{snapshot.user.email || '—'}</span></Zeile>
                      <Zeile><span>Name</span><span>{snapshot.user.name || '—'}</span></Zeile>
                      <Zeile><span>Unternehmen</span><span>{snapshot.user.unternehmen || '—'}</span></Zeile>
                      <Zeile><span>Branche</span><span>{snapshot.user.branche || '—'}</span></Zeile>
                      <Zeile><span>User-ID</span><span style={{ fontSize: '.7rem' }}>{snapshot.user.id}</span></Zeile>
                      <Zeile><span>Registriert</span><span>{fmt(snapshot.user.registriertAm)}</span></Zeile>
                    </Block>

                    <Block>
                      <BlockTitel>Entitlement</BlockTitel>
                      <Zeile><span>Plan</span><span>{snapshot.entitlement.plan}</span></Zeile>
                      <Zeile><span>Zugang aktuell</span><span>{snapshot.entitlement.zugangAktuell ? 'ja' : 'nein'}</span></Zeile>
                      <Zeile><span>Operative Mails</span><span>{snapshot.entitlement.operativeMailBerechtigt ? 'ja' : 'nein'}</span></Zeile>
                      {snapshot.entitlement.foundingPartner && (
                        <>
                          <Zeile><span>Founding Partner seit</span><span>{fmt(snapshot.entitlement.foundingPartnerSeit)}</span></Zeile>
                          {snapshot.entitlement.foundingPartnerNotiz && (
                            <Zeile><span>Notiz</span><span>{snapshot.entitlement.foundingPartnerNotiz}</span></Zeile>
                          )}
                        </>
                      )}
                    </Block>

                    <Block>
                      <BlockTitel>Zustimmung</BlockTitel>
                      <Zeile><span>Liegt vor</span><span>{snapshot.consent.liegtVor ? 'ja' : 'nein'}</span></Zeile>
                      <Zeile><span>Fassung</span><span>{snapshot.consent.fassung || '—'}</span></Zeile>
                      <Zeile><span>Zugestimmt am</span><span>{fmtZ(snapshot.consent.zugestimmtAm)}</span></Zeile>
                    </Block>

                    <Block>
                      <BlockTitel>Google-Verbindung</BlockTitel>
                      <Zeile><span>Status</span><span>{snapshot.googleAccount.status}</span></Zeile>
                      {snapshot.googleAccount.vorhanden && (
                        <>
                          <Zeile><span>Verbunden seit</span><span>{fmt(snapshot.googleAccount.verbundenSeit)}</span></Zeile>
                          <Zeile><span>Standorte aktiv</span><span>{snapshot.googleAccount.standorteAktiv}</span></Zeile>
                          {snapshot.googleAccount.standorteGeloescht > 0 && (
                            <Zeile><span>Gelöscht</span><span>{snapshot.googleAccount.standorteGeloescht}</span></Zeile>
                          )}
                          {snapshot.googleAccount.letzterFehlerCode && (
                            <Zeile>
                              <span>Letzter Fehler</span>
                              <span>{snapshot.googleAccount.letzterFehlerCode} · {fmtZ(snapshot.googleAccount.letzterFehlerAm)}</span>
                            </Zeile>
                          )}
                        </>
                      )}
                    </Block>

                    <Block>
                      <BlockTitel>Datenstand / Sync</BlockTitel>
                      <Zeile>
                        <span>Letzter Erfolg</span>
                        <span>{snapshot.sync.datenstandBekannt ? fmtZ(snapshot.sync.letzterErfolg) : 'noch kein erfolgreicher Datenstand'}</span>
                      </Zeile>
                      <Zeile><span>Letzter Job</span><span>{snapshot.sync.letzterJobStatus || '—'} · {fmtZ(snapshot.sync.letzterJob)}</span></Zeile>
                      <Zeile><span>Laufend</span><span>{snapshot.sync.laufendeJobs}</span></Zeile>
                      <Zeile><span>Fehlgeschlagen</span><span>{snapshot.sync.fehlgeschlageneJobs}</span></Zeile>
                      {snapshot.sync.letzterFehler && (
                        <Zeile>
                          <span>Fehlercode</span>
                          <span>{snapshot.sync.letzterFehler.code} · {snapshot.sync.letzterFehler.art} · {fmtZ(snapshot.sync.letzterFehler.am)}</span>
                        </Zeile>
                      )}
                    </Block>

                    <Block>
                      <BlockTitel>Engine</BlockTitel>
                      <Zeile><span>Offene Events</span><span>{snapshot.engine.offeneEvents}</span></Zeile>
                      {snapshot.engine.events.slice(0, 6).map((e) => (
                        <Zeile key={e.id}>
                          <span>{e.typ}</span>
                          <span>P{e.priority ?? '—'} · {e.lifecycle}{e.klasse ? ` · ${e.klasse}` : ''}</span>
                        </Zeile>
                      ))}
                    </Block>

                    <Block>
                      <BlockTitel>Kommunikation</BlockTitel>
                      <Zeile><span>In Queue</span><span>{snapshot.communications.offeneInQueue}</span></Zeile>
                      <Zeile><span>Fehlgeschlagen</span><span>{snapshot.communications.fehlgeschlagen}</span></Zeile>
                      {Object.entries(snapshot.communications.letzteNachVorlage).map(([vorlage, info]) => (
                        <Zeile key={vorlage}>
                          <span>{vorlage}</span>
                          <span>
                            {info
                              ? `${info.status}${info.gesendetAm ? ` · ${fmtZ(info.gesendetAm)}` : ''}${info.fehlerCode ? ` · ${info.fehlerCode}` : ''}`
                              : 'nie'}
                          </span>
                        </Zeile>
                      ))}
                    </Block>

                    <Block>
                      <BlockTitel>Billing (nur lesend)</BlockTitel>
                      <Zeile><span>Stripe-Kunde</span><span>{snapshot.billing.stripeKunde ? 'ja' : 'nein'}</span></Zeile>
                      <Zeile><span>Status</span><span>{snapshot.billing.stripeStatus || '—'}</span></Zeile>
                      <Zeile><span>Kündigung geplant</span><span>{snapshot.billing.kuendigungGeplant ? 'ja' : 'nein'}</span></Zeile>
                      <Zeile><span>Periode endet</span><span>{fmt(snapshot.billing.periodeEndet)}</span></Zeile>
                      {snapshot.billing.stripeCustomerId && (
                        <Zeile><span>Customer-ID</span><span style={{ fontSize: '.7rem' }}>{snapshot.billing.stripeCustomerId}</span></Zeile>
                      )}
                    </Block>
                  </Bloecke>

                  {/* ── STANDORTE (§8, §9, §37) ── */}
                  <Block style={{ marginTop: 14 }}>
                    <BlockTitel>Standorte</BlockTitel>
                    {snapshot.zeroLocations ? (
                      <Reason $ok={false} style={{ maxWidth: 'none' }}>
                        {snapshot.zeroLocations.hinweis}
                        <br />
                        Import: {snapshot.zeroLocations.importStatus}
                        {snapshot.zeroLocations.letzterVersuch && ` · letzter Versuch ${fmtZ(snapshot.zeroLocations.letzterVersuch)}`}
                        {snapshot.zeroLocations.letzterFehler && ` · Fehler ${snapshot.zeroLocations.letzterFehler}`}
                      </Reason>
                    ) : snapshot.locations.length === 0 ? (
                      <Reason>Keine Standorte — Google ist nicht aktiv verbunden.</Reason>
                    ) : (
                      <Table>
                        <thead>
                          <tr>
                            <Th>Name</Th><Th>Ort</Th><Th>Place-ID</Th>
                            <Th>Gewählt</Th><Th>Primär</Th>
                            <Th>Letzter Sync</Th><Th>Bewertungen</Th><Th>Rating</Th><Th>Fotos</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.locations.map((l) => (
                            <Tr key={l.id}>
                              <Td>{l.titel || '—'}</Td>
                              <Td>{l.locality || '—'}</Td>
                              <Td style={{ fontSize: '.7rem' }}>{l.placeId || '—'}</Td>
                              <Td>{l.gewaehlt ? <Status $ok>gewählt</Status> : '—'}</Td>
                              <Td>{l.primaer ? 'ja' : '—'}</Td>
                              <Td>{fmtZ(l.letzterSync)}</Td>
                              <Td>{l.bewertungen ?? '—'}</Td>
                              <Td>{l.rating ?? '—'}</Td>
                              <Td>{l.fotos ?? '—'}</Td>
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </Block>

                  {/* ── AKTIONEN (§11, §19, §20, §21) ── */}
                  <Block style={{ marginTop: 14 }}>
                    <BlockTitel>Sichere Aktionen</BlockTitel>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Btn
                        type="button"
                        disabled={aktionLaeuft}
                        onClick={() => fuehreAus('trigger_customer_sync', {
                          userId: snapshot.user.id,
                          locationId: snapshot.engine.gewaehlterStandort,
                        })}
                      >
                        <RefreshCw size={14} /> Jetzt synchronisieren
                      </Btn>

                      {snapshot.entitlement.foundingPartner ? (
                        <Btn
                          type="button"
                          $gefahr
                          disabled={aktionLaeuft}
                          onClick={() => setBestaetigung({ aktion: 'clear_founding_partner' })}
                        >
                          Founding Partner entziehen
                        </Btn>
                      ) : (
                        <Btn
                          type="button"
                          $haupt
                          disabled={aktionLaeuft}
                          onClick={() => setBestaetigung({ aktion: 'set_founding_partner' })}
                        >
                          Als Founding Partner freischalten
                        </Btn>
                      )}
                    </div>

                    {/* §20/§21: nicht Ein-Klick. Wer, welcher Plan, welche Folge. */}
                    {bestaetigung && (
                      <Bestaetigung>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>
                          {snapshot.user.name || snapshot.user.unternehmen || 'Unbekannter Name'}
                        </div>
                        <div>{snapshot.user.email || 'Keine E-Mail'}</div>
                        <div style={{ margin: '8px 0' }}>
                          Aktuell: <strong>{snapshot.entitlement.plan}</strong>
                        </div>

                        {bestaetigung.aktion === 'set_founding_partner' ? (
                          <div>
                            → Als Founding Partner freischalten. Der Zugang wird kostenlos
                            und hängt nicht mehr an Stripe.
                          </div>
                        ) : (
                          <div>
                            → Auf <strong>free</strong> zurücksetzen. Folgen:
                            <ul style={{ margin: '6px 0 0 18px' }}>
                              <li>operative Mails hören auf (Weekly, Critical Alerts)</li>
                              <li>Pro-Aktionen werden gesperrt</li>
                            </ul>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                          <Btn
                            type="button"
                            $gefahr={bestaetigung.aktion === 'clear_founding_partner'}
                            $haupt={bestaetigung.aktion === 'set_founding_partner'}
                            disabled={aktionLaeuft}
                            onClick={() => fuehreAus(bestaetigung.aktion, { userId: snapshot.user.id })}
                          >
                            Ja, ausführen
                          </Btn>
                          <Btn type="button" onClick={() => setBestaetigung(null)}>Abbrechen</Btn>
                        </div>
                      </Bestaetigung>
                    )}

                    {aktionsErgebnis && (
                      <div style={{ marginTop: 12 }}>
                        <Status $ok={aktionsErgebnis.ok}>
                          {aktionsErgebnis.ok ? 'ausgeführt' : 'nicht ausgeführt'}
                        </Status>
                        <Reason style={{ maxWidth: 'none', marginTop: 6 }}>
                          {aktionsErgebnis.fehler
                            || aktionsErgebnis.daten?.code
                            || (aktionsErgebnis.daten?.jobId
                              ? `Job eingereiht · ${aktionsErgebnis.daten.jobArt} · Job-ID ${aktionsErgebnis.daten.jobId}`
                              : 'Fertig.')}
                        </Reason>
                      </div>
                    )}

                    <Reason style={{ maxWidth: 'none', marginTop: 10 }}>
                      Jede dieser Aktionen wird in audit_logs protokolliert. Google- und
                      Stripe-Änderungen sind hier nicht möglich — dafür bleibt der
                      Produktpfad beziehungsweise das Stripe-Dashboard.
                    </Reason>
                  </Block>
                </>
              )}
            </div>
          </Section>
        )}

        {/* ── SETUP-LEADS ── */}
        {setupLeads > 0 && (
          <Section>
            <SectionHead>
              <SectionTitle>
                <AlertTriangle size={15} style={{ display: 'inline', marginRight: 8, color: '#D93025', verticalAlign: 'middle' }} />
                Offene Setup-Aufträge ({setupLeads})
              </SectionTitle>
            </SectionHead>
            <div style={{ overflowX: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <Th>Betrieb</Th>
                    <Th>E-Mail</Th>
                    <Th>Branche</Th>
                    <Th>Eingetragen am</Th>
                  </tr>
                </thead>
                <tbody>
                  {leads.filter((l) => l.needs_manual_setup && l.status === 'new').map((l) => (
                    <Tr key={l.id}>
                      <Td style={{ fontWeight: 700, color: '#D93025' }}>{l.company_name}</Td>
                      <Td>{l.email || '—'}</Td>
                      <Td>{l.industry_key || 'handwerk'}</Td>
                      <Td>{fmt(l.created_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Section>
        )}
      </Inner>
    </Page>
  );
}
