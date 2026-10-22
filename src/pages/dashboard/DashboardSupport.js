import React from 'react';
import { useAuthContext } from '../../context/AuthContext';
import { isFoundingPartner } from '../../utils/subscription';
import DirekterDraht from '../../components/dashboard/DirekterDraht';
import { Page, PageTitle, PageSub, Card } from '../../components/dashboard/gb/GbUi';

/* ─────────────────────────────────────────────────────────────────
   DashboardSupport — eigene Seite fuer den Direkten Draht

   Vom 21.10. lag die Karte auf der Uebersicht, nach den naechsten
   Schritten. Zu weit unten: Der erste Founding Partner hat sie nicht
   gefunden. Jetzt ein Menuepunkt und eine Seite.

   ═════════════════════════════════════════════════════════════
   WARUM KEINE UMLEITUNG FUER NICHT-FOUNDING-PARTNER
   ═════════════════════════════════════════════════════════════

   Der erste Entwurf leitete auf /dashboard um, wenn das Profil kein
   Founding Partner ist. Das Profil ist beim ersten Rendern aber
   null — noch nicht geladen, nicht "kein Partner" —, und
   profileLoading springt erst einen Tick spaeter auf true. Ein
   echter Founding Partner waere beim ersten Aufruf kurz auf die
   Uebersicht geworfen worden.

   Deshalb keine Umleitung. Wer kein Founding Partner ist, sieht
   einen Satz. Der Menuepunkt ist fuer ihn ohnehin unsichtbar, und
   die eigentliche Regel steht in der Datenbank — hier gibt es nichts
   zu verbergen.
───────────────────────────────────────────────────────────────── */
export default function DashboardSupport() {
  const { profile } = useAuthContext();

  return (
    <Page>
      <PageTitle>Support</PageTitle>
      {isFoundingPartner(profile) ? (
        <>
          <PageSub>
            Deine direkte Leitung als Founding Partner. Keine Warteschleife, kein
            Formular ins Nichts — hier liest ein Mensch mit.
          </PageSub>
          <DirekterDraht />
        </>
      ) : (
        <>
          <PageSub>Der direkte Draht ist Founding Partnern vorbehalten.</PageSub>
          <Card data-testid="support-kein-fp">
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '.9rem', lineHeight: 1.6, color: 'var(--color-text-muted)', margin: 0 }}>
              Fragen beantworten wir trotzdem gern — schreib an{' '}
              <a href="mailto:info@werkruf.com" style={{ color: 'var(--color-primary)' }}>info@werkruf.com</a>.
            </p>
          </Card>
        </>
      )}
    </Page>
  );
}
