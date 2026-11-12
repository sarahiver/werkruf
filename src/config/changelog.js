/*
 * Changelog — was sich an WERKRUF geändert hat.
 *
 * Datierung: Die Einträge stammen aus den Pull Requests, die zwischen
 * dem 9. und 12.11.2026 in main gemergt wurden. Wann genau sie produktiv
 * ausgeliefert wurden, ist im Repository nicht festgehalten — deshalb
 * stehen sie gemeinsam unter „November 2026" statt unter erfundenen
 * Tagesdaten. Neue Einträge: oben anfügen, mit dem Monat, in dem sie
 * live gegangen sind.
 *
 * kategorie: 'neu' | 'verbessert' | 'behoben'
 */

export const CHANGELOG_KATEGORIEN = Object.freeze({
  neu: 'Neu',
  verbessert: 'Verbessert',
  behoben: 'Behoben',
});

export const CHANGELOG = Object.freeze([
  {
    monat: 'November 2026',
    eintraege: [
      {
        kategorie: 'neu',
        titel: 'Hilfe-Bereich und Changelog',
        text: 'Kurze Anleitungen zu allen Funktionen — von der Google-Verbindung bis zur Kündigung. Und diese Seite.',
        hilfe: null,
      },
      {
        kategorie: 'neu',
        titel: 'Bewertung per SMS anfragen',
        text: 'Vorname und Mobilnummer eingeben, Vorschau prüfen, senden. Der Text ist vorgegeben, die Nummer wird nicht im Klartext gespeichert. Dazu ein kurzer Bewertungslink.',
        hilfe: 'mehr-bewertungen',
      },
      {
        kategorie: 'neu',
        titel: 'Saison-Beiträge',
        text: 'Zu Weihnachten, Jahreswechsel, Ostern, Sommer und Heizsaison liegt ein vorbereiteter Beitrag für dein Google-Profil bereit. Veröffentlicht wird er erst mit deinem Klick.',
        hilfe: 'fotos-und-profildaten',
      },
      {
        kategorie: 'neu',
        titel: 'Jahresabo und Betriebsferien',
        text: 'WERKRUF gibt es jetzt auch jährlich — zwei Monate günstiger. Für Betriebsferien lässt sich WERKRUF bis zu acht Wochen pausieren; kritische Hinweise kommen weiter.',
        hilfe: 'preise-und-kuendigung',
      },
      {
        kategorie: 'neu',
        titel: 'Profil-Wächter',
        text: 'WERKRUF vergleicht täglich deine hinterlegten Angaben mit dem, was Google öffentlich zeigt. Abweichungen siehst du als Aufgabe, bei Telefon, Adresse oder Website sofort per E-Mail.',
        hilfe: 'fotos-und-profildaten',
      },
      {
        kategorie: 'neu',
        titel: 'Feiertags-Erinnerung',
        text: 'Etwa zwei Wochen vor einem gesetzlichen Feiertag ohne Sonderöffnungszeit erinnert WERKRUF dich. Geschlossen, regulär oder andere Zeiten — ein Klick.',
        hilfe: 'fotos-und-profildaten',
      },
      {
        kategorie: 'neu',
        titel: 'Empfehlungsprogramm',
        text: 'Empfiehl WERKRUF einem anderen Betrieb. Wird er zahlender Kunde, bekommt ihr beide einen Monat geschenkt.',
        hilfe: null,
      },
      {
        kategorie: 'verbessert',
        titel: 'Nach der Testphase geht nichts verloren',
        text: 'Endet die Testphase oder das Abo, bleibt dein Konto im kostenlosen Modus erhalten: Score, Google-Verbindung und Profilstand bleiben sichtbar, und bei schlechten Bewertungen meldet sich WERKRUF weiter.',
        hilfe: 'preise-und-kuendigung',
      },
      {
        kategorie: 'verbessert',
        titel: 'Datenschutz auf der Website',
        text: 'Statistik nur noch nach ausdrücklicher Zustimmung, jederzeit über „Cookie-Einstellungen" im Fußbereich änderbar. Schriften werden nicht mehr von Google geladen.',
        hilfe: 'datenschutz-google',
      },
    ],
  },
]);
