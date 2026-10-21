import React from 'react';
import styled from 'styled-components';
import { MessageCircle, Send, CheckCircle, Clock } from 'lucide-react';
import supabase from '../../supabaseClient';
import { useAuthContext } from '../../context/AuthContext';
import { isFoundingPartner } from '../../utils/subscription';
import { Card, SectionTitle, PrimaryBtn, formatRelative } from './gb/GbUi';

/* ─────────────────────────────────────────────────────────────────
   DirekterDraht

   Der Support-Kanal fuer Founding Partner — und nur fuer sie.

   ═════════════════════════════════════════════════════════════
   WAS ES IST, WAS ES NICHT IST
   ═════════════════════════════════════════════════════════════

   Ein Formular, eine Tabelle, eine Mail an den Anbieter. Kein Chat,
   kein Ticketsystem, kein Drittanbieter. Die Antwort kommt per
   E-Mail; die Karte zeigt, was gefragt wurde und ob es beantwortet
   ist. Mehr braucht es fuer eine Handvoll Partner nicht — und jedes
   Mehr waere eine Zusage, die man dann auch halten muss.

   ═════════════════════════════════════════════════════════════
   SICHTBARKEIT IST KEINE REGEL
   ═════════════════════════════════════════════════════════════

   isFoundingPartner() entscheidet, ob die Karte erscheint. Die
   eigentliche Regel steht in der Datenbank: Die Insert-Policy auf
   support_requests prueft user_profiles.plan. Wer die Karte im
   Browser sichtbar schaltet, ohne Founding Partner zu sein, bekommt
   beim Absenden einen Fehler — und genau den zeigt diese Komponente
   dann auch an, statt ihn zu verschlucken.

   ═════════════════════════════════════════════════════════════
   WARUM DIREKT UEBER DEN SUPABASE-CLIENT
   ═════════════════════════════════════════════════════════════

   Wie die anderen Kundendaten im Dashboard (google_locations,
   review_replies, …): RLS auf die eigene Zeile, kein eigener
   Endpunkt. Der Admin-Weg laeuft getrennt ueber admin-ops.
───────────────────────────────────────────────────────────────── */

/* Die eine Zusage, die diese Karte macht. Bewusst eine Konstante und
   kein Fliesstext im Markup: Wer sie aendert, soll sie suchen muessen
   und dabei lesen, dass es eine Zusage ist. */
export const ANTWORT_ZUSAGE = 'Du bekommst eine Antwort per E-Mail — persönlich, nicht automatisch.';

export const BETREFF_MIN = 3;
export const BETREFF_MAX = 140;
export const TEXT_MIN = 10;
export const TEXT_MAX = 4000;

const STATUS = {
  open:     { label: 'Offen',       farbe: '#A66A00', Icon: Clock },
  answered: { label: 'Beantwortet', farbe: '#1E7E34', Icon: CheckCircle },
  closed:   { label: 'Erledigt',    farbe: '#5A6B7B', Icon: CheckCircle },
};

/**
 * Prueft die Eingabe, bevor etwas gesendet wird. Dieselben Grenzen wie
 * die CHECK-Constraints der Tabelle — wer hier durchkommt, kommt auch
 * dort durch, und wer hier scheitert, bekommt einen Satz statt eines
 * Datenbankfehlers.
 *
 * Reine Funktion, exportiert fuer den Test.
 */
export function pruefeEingabe({ betreff = '', text = '' } = {}) {
  const b = betreff.trim();
  const t = text.trim();
  if (b.length < BETREFF_MIN) return { fehler: 'Bitte gib einen kurzen Betreff an.' };
  if (b.length > BETREFF_MAX) return { fehler: `Der Betreff darf höchstens ${BETREFF_MAX} Zeichen haben.` };
  if (t.length < TEXT_MIN)    return { fehler: 'Beschreib dein Anliegen in ein, zwei Sätzen.' };
  if (t.length > TEXT_MAX)    return { fehler: `Die Nachricht darf höchstens ${TEXT_MAX} Zeichen haben.` };
  return { betreff: b, text: t };
}

/* ── Darstellung ── */

const Karte = styled(Card)`
  border-left: 3px solid var(--color-accent);
`;

const Intro = styled.p`
  font-family: var(--font-body); font-size: .86rem; line-height: 1.6;
  color: var(--color-text-muted); margin: 0 0 16px;
`;

const Feld = styled.div`
  display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px;
  label {
    font-family: var(--font-body); font-size: .76rem; font-weight: 700;
    letter-spacing: .4px; text-transform: uppercase; color: var(--color-text-muted);
  }
  input, textarea {
    font-family: var(--font-body); font-size: .9rem; color: var(--color-text);
    border: 1px solid var(--color-border); border-radius: 6px;
    padding: 10px 12px; background: #fff;
    &:focus { outline: 2px solid rgba(var(--color-accent-rgb), .35); border-color: var(--color-accent); }
  }
  textarea { min-height: 110px; resize: vertical; }
`;

const Zeile = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
`;

const Hinweis = styled.p`
  font-family: var(--font-body); font-size: .8rem; line-height: 1.5;
  color: ${({ $fehler }) => ($fehler ? '#B3261E' : '#1E7E34')};
  margin: 0;
`;

const Liste = styled.ul`
  list-style: none; margin: 18px 0 0; padding: 0;
  border-top: 1px solid var(--color-border);
`;

const Eintrag = styled.li`
  display: grid; grid-template-columns: 1fr auto; gap: 4px 14px;
  padding: 12px 0; border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: none; }
`;

const Betreff = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .88rem;
  color: var(--color-primary); margin: 0;
`;

const Wann = styled.p`
  font-family: var(--font-body); font-size: .76rem;
  color: var(--color-text-muted); margin: 0;
`;

const Marke = styled.span`
  display: inline-flex; align-items: center; gap: 5px; align-self: start;
  font-family: var(--font-body); font-size: .72rem; font-weight: 700;
  color: ${({ $farbe }) => $farbe};
  white-space: nowrap;
`;

export default function DirekterDraht() {
  const { user, profile } = useAuthContext();
  const sichtbar = isFoundingPartner(profile);

  const [betreff, setBetreff] = React.useState('');
  const [text, setText]       = React.useState('');
  const [sendet, setSendet]   = React.useState(false);
  const [hinweis, setHinweis] = React.useState(null); // { text, fehler }
  const [anfragen, setAnfragen] = React.useState([]);
  const [laedt, setLaedt]     = React.useState(true);

  const laden = React.useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('support_requests')
      .select('id, subject, status, created_at, answered_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error) setAnfragen(data ?? []);
    setLaedt(false);
  }, [user?.id]);

  React.useEffect(() => {
    if (!sichtbar) return;
    laden();
  }, [sichtbar, laden]);

  /* Nach dem Hook-Block, nicht davor: Hooks muessen bei jedem Rendern
     in derselben Reihenfolge laufen. */
  if (!sichtbar) return null;

  const senden = async (e) => {
    e.preventDefault();
    const geprueft = pruefeEingabe({ betreff, text });
    if (geprueft.fehler) { setHinweis({ text: geprueft.fehler, fehler: true }); return; }

    setSendet(true); setHinweis(null);
    const { error } = await supabase
      .from('support_requests')
      .insert({ user_id: user.id, subject: geprueft.betreff, body: geprueft.text });

    if (error) {
      /* 42501 ist die RLS-Abweisung: kein Founding Partner laut
         Datenbank, obwohl die Karte sichtbar war. Ehrlich sagen, nicht
         verschlucken. */
      setHinweis({
        fehler: true,
        text: error.code === '42501'
          ? 'Dein Konto ist nicht als Founding Partner freigeschaltet. Melde dich einmal ab und wieder an — oder schreib an info@werkruf.com.'
          : 'Die Anfrage konnte nicht gesendet werden. Bitte versuche es gleich noch einmal.',
      });
      setSendet(false);
      return;
    }

    setBetreff(''); setText('');
    setHinweis({ text: 'Angekommen. ' + ANTWORT_ZUSAGE, fehler: false });
    setSendet(false);
    laden();
  };

  return (
    <Karte data-testid="direkter-draht">
      <SectionTitle><MessageCircle size={15} /> Direkter Draht</SectionTitle>
      <Intro>
        Als Founding Partner hast du eine direkte Leitung. Frag, was unklar ist,
        sag, was fehlt, oder meld, was nicht stimmt. {ANTWORT_ZUSAGE}
      </Intro>

      <form onSubmit={senden} noValidate>
        <Feld>
          <label htmlFor="draht-betreff">Betreff</label>
          <input
            id="draht-betreff" type="text" value={betreff} maxLength={BETREFF_MAX}
            onChange={(e) => setBetreff(e.target.value)}
            placeholder="Worum geht es?" disabled={sendet}
          />
        </Feld>
        <Feld>
          <label htmlFor="draht-text">Nachricht</label>
          <textarea
            id="draht-text" value={text} maxLength={TEXT_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder="Je konkreter, desto schneller kann ich helfen." disabled={sendet}
          />
        </Feld>
        <Zeile>
          <PrimaryBtn type="submit" disabled={sendet}>
            <Send size={14} /> {sendet ? 'Wird gesendet…' : 'Absenden'}
          </PrimaryBtn>
          {hinweis && <Hinweis $fehler={hinweis.fehler} role={hinweis.fehler ? 'alert' : 'status'}>{hinweis.text}</Hinweis>}
        </Zeile>
      </form>

      {!laedt && anfragen.length > 0 && (
        <Liste aria-label="Deine Anfragen">
          {anfragen.map((a) => {
            const s = STATUS[a.status] ?? STATUS.open;
            return (
              <Eintrag key={a.id} data-status={a.status}>
                <Betreff>{a.subject}</Betreff>
                <Marke $farbe={s.farbe}><s.Icon size={12} /> {s.label}</Marke>
                <Wann>
                  Gesendet {formatRelative(a.created_at)}
                  {a.answered_at ? ` · beantwortet ${formatRelative(a.answered_at)}` : ''}
                </Wann>
              </Eintrag>
            );
          })}
        </Liste>
      )}
    </Karte>
  );
}
