import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { Mail, AlertTriangle, Check, Loader } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext';
import supabase from '../../supabaseClient';
import { Card, SectionTitle, spin } from './gb/GbUi';

/* ─────────────────────────────────────────────
   NotificationSettings

   Die Gegenseite zum proaktiven Melden. Ohne sie wäre jede zusätzliche
   Mail ein Risiko: Wer eine nicht abstellen kann, filtert den Absender
   weg — und dann kommt auch die wichtige nicht mehr an.

   Bewusst nach Anlass gruppiert statt nach Kanal. "Wenn eine schlechte
   Bewertung kommt" ist eine Entscheidung, die jemand treffen kann;
   "Transaktionale E-Mails" ist keine.

   Die Voreinstellung ist "an" — ausser bei der Flaute-Meldung. Wer
   sich anmeldet, will informiert werden. Andersherum bliebe das
   Produkt stumm, und niemand würde merken, dass es etwas zu melden
   gäbe.
───────────────────────────────────────────── */

const Row = styled.label`
  display: flex; align-items: flex-start; gap: 13px;
  padding: 15px 0; cursor: pointer;
  border-bottom: 1px solid var(--color-border);
  &:last-of-type { border-bottom: none; }
`;

const Toggle = styled.span`
  width: 40px; height: 23px; flex-shrink: 0; margin-top: 2px;
  border-radius: 12px; position: relative;
  background: ${({ $on }) => ($on ? 'var(--color-accent)' : 'var(--color-border)')};
  transition: background .18s;

  &::after {
    content: ''; position: absolute; top: 3px;
    left: ${({ $on }) => ($on ? '20px' : '3px')};
    width: 17px; height: 17px; border-radius: 50%;
    background: #fff; transition: left .18s;
  }
`;

const HiddenInput = styled.input`
  position: absolute; opacity: 0; width: 0; height: 0;
`;

const Label = styled.p`
  font-family: var(--font-body); font-weight: 700; font-size: .88rem;
  color: var(--color-primary); line-height: 1.4;
`;

const Detail = styled.p`
  font-family: var(--font-body); font-size: .81rem; line-height: 1.55;
  color: var(--color-text-muted); margin-top: 3px;
`;

const GroupLabel = styled.p`
  font-family: var(--font-body); font-size: .72rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .08em;
  color: var(--color-text-muted); margin: 18px 0 2px;
  &:first-child { margin-top: 0; }
`;

const Note = styled.p`
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid var(--color-border);
  font-family: var(--font-body); font-size: .78rem; line-height: 1.55;
  color: var(--color-text-muted);
  svg { flex-shrink: 0; margin-top: 2px; }
`;

const SaveHint = styled.span`
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-body); font-size: .75rem;
  color: ${({ $error }) => ($error ? '#B3261E' : '#1E7E34')};
  margin-left: auto;
  svg { animation: ${({ $busy }) => ($busy ? spin : 'none')} .9s linear infinite; }
`;

/* Reihenfolge nach Dringlichkeit. Was ein Ausfall ist, steht oben. */
const GROUPS = [
  {
    label: 'Wenn etwas schiefgeht',
    items: [
      {
        key: 'connection_lost',
        label: 'Verbindung zu Google abgerissen',
        detail: 'Bis zur Erneuerung läuft nichts weiter — weder Überwachung noch Antworten.',
      },
      {
        key: 'google_changed',
        label: 'Google hat deine Profilangaben geändert',
        detail: 'Google und andere Nutzer können deinen Eintrag ändern. Ohne Meldung merkt man das oft monatelang nicht.',
      },
    ],
  },
  {
    label: 'Wenn etwas zu entscheiden ist',
    items: [
      {
        key: 'negative_review',
        label: 'Schlechte Bewertung eingegangen',
        detail: 'Bei einem oder zwei Sternen — sofort, mit fertigem Antwortvorschlag.',
      },
      {
        key: 'holiday_hours',
        label: 'Feiertag steht bevor',
        detail: 'Zehn Tage vorher, falls für den Tag keine Sonderzeiten hinterlegt sind.',
      },
    ],
  },
  {
    label: 'Regelmässig',
    items: [
      {
        key: 'weekly_summary',
        label: 'Wochenmail, montags',
        detail: 'Was passiert ist und was ansteht. Kommt auch, wenn nichts war — dann sagt sie das.',
      },
      {
        key: 'monthly_report',
        label: 'Monatlicher Rückblick',
        detail: 'Entwicklung deines Profils und wonach Leute gesucht haben, als sie dich fanden.',
      },
      {
        key: 'review_drought',
        label: 'Lange keine neue Bewertung',
        detail: 'Erinnerung, wenn seit über zwei Monaten nichts dazugekommen ist.',
      },
    ],
  },
];

const DEFAULTS = {
  weekly_summary: true, negative_review: true, google_changed: true,
  connection_lost: true, holiday_hours: true, monthly_report: true,
  review_drought: false,
};

export default function NotificationSettings() {
  const { user } = useAuthContext();
  const [prefs, setPrefs]   = useState(DEFAULTS);
  const [loading, setLoad]  = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;

    (async () => {
      const { data, error: queryError } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!active) return;
      if (queryError) console.warn('[NotificationSettings]', queryError.message);
      // Fehlende Zeile ist kein Fehler — dann gelten die Voreinstellungen.
      if (data) setPrefs({ ...DEFAULTS, ...data });
      setLoad(false);
    })();

    return () => { active = false; };
  }, [user?.id]);

  const toggle = useCallback(async (key) => {
    const next = { ...prefs, [key]: !prefs[key] };

    // Sofort umschalten, dann speichern. Ein Schalter, der auf die
    // Datenbank wartet, fühlt sich kaputt an.
    setPrefs(next);
    setSaving(true);
    setSaved(false);
    setError(null);

    const { error: saveError } = await supabase
      .from('notification_preferences')
      .upsert({
        user_id: user.id,
        ...Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, next[k]])),
      }, { onConflict: 'user_id' });

    setSaving(false);

    if (saveError) {
      console.error('[NotificationSettings]', saveError.message);
      setPrefs(prefs);            // zurückdrehen
      setError('Nicht gespeichert');
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [prefs, user?.id]);

  return (
    <>
      <SectionTitle>
        <Mail size={15} /> Benachrichtigungen
        {(saving || saved || error) && (
          <SaveHint $busy={saving} $error={!!error}>
            {saving ? <><Loader size={12} /> Speichert…</>
              : error ? <><AlertTriangle size={12} /> {error}</>
              : <><Check size={12} /> Gespeichert</>}
          </SaveHint>
        )}
      </SectionTitle>

      <Card style={{ opacity: loading ? .5 : 1 }}>
        {GROUPS.map((group) => (
          <React.Fragment key={group.label}>
            <GroupLabel>{group.label}</GroupLabel>
            {group.items.map((item) => (
              <Row key={item.key}>
                <HiddenInput
                  type="checkbox"
                  checked={!!prefs[item.key]}
                  onChange={() => toggle(item.key)}
                  disabled={loading}
                />
                <Toggle $on={!!prefs[item.key]} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Label>{item.label}</Label>
                  <Detail>{item.detail}</Detail>
                </div>
              </Row>
            ))}
          </React.Fragment>
        ))}

        <Note>
          <AlertTriangle size={13} />
          WERKRUF schickt höchstens drei Sofortmeldungen pro Woche. Kommt mehr
          zusammen, wird es gebündelt — eine Liste hilft mehr als fünf einzelne
          E-Mails.
        </Note>
      </Card>
    </>
  );
}
