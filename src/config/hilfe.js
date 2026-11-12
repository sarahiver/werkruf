/*
 * Hilfe-Center — Inhalte (Stand 12.11.2026).
 *
 * Jede Aussage ist aus dem Code abgeleitet; die Fundstellen stehen als
 * Kommentar an den Stellen, an denen ein Satz leicht falsch werden
 * koennte. Wird eine Funktion geaendert, gehoert dieser Text mit
 * geaendert — src/hilfe.test.js prueft die kritischen Aussagen gegen
 * die Implementierung.
 *
 * Format:
 *   absaetze   Strings; [Text](/pfad) wird zu einem internen Link.
 *   {preisMonat} {preisJahr} {ersparnis} {trialTage} kommen aus
 *   src/utils/tarife.js bzw. der Branchen-Konfiguration — nie hart.
 */

export const HILFE_GRUPPEN = Object.freeze([
  { key: 'start', titel: 'Erste Schritte' },
  { key: 'google', titel: 'Google & Verbindung' },
  { key: 'bewertungen', titel: 'Bewertungen' },
  { key: 'profil', titel: 'Profil & Sichtbarkeit' },
  { key: 'alltag', titel: 'WERKRUF im Alltag' },
  { key: 'konto', titel: 'Konto & Preise' },
  { key: 'datenschutz', titel: 'Datenschutz' },
]);

/* Die vier Schritte auf /hilfe — jeder verlinkt eine Detailseite. */
export const HILFE_ABLAUF = Object.freeze([
  { titel: 'Konto erstellen', text: 'Mit E-Mail-Adresse oder mit deinem Google-Konto.', slug: 'erste-schritte' },
  { titel: 'Google-Unternehmensprofil verbinden', text: 'Einmal bei Google zustimmen, Betrieb auswählen.', slug: 'google-profil-verbinden' },
  { titel: 'WERKRUF prüft deinen Auftritt', text: 'Bewertungen, Angaben, Öffnungszeiten und Fotos — täglich.', slug: 'fotos-und-profildaten' },
  { titel: 'Du bekommst konkrete Hinweise und Antwortvorschläge', text: 'Montags eine kurze Mail, bei schlechten Bewertungen sofort.', slug: 'wochenmail' },
]);

export const HILFE_ARTIKEL = Object.freeze([
  {
    slug: 'erste-schritte',
    gruppe: 'start',
    titel: 'Erste Schritte mit WERKRUF',
    seoTitel: 'Erste Schritte: Konto, Google-Verbindung, Dashboard',
    beschreibung: 'Wie du ein WERKRUF-Konto anlegst, dein Google-Unternehmensprofil verbindest, deinen Betrieb auswählst und was danach passiert.',
    einleitung: 'Von der Anmeldung bis zur ersten Wochenmail: So läuft der Start mit WERKRUF ab.',
    abschnitte: [
      {
        titel: 'Konto anlegen',
        schritte: [
          'Auf werkruf.com „{trialTage} Tage kostenlos testen" wählen.',
          'Mit E-Mail-Adresse und Passwort registrieren — dann kommt eine Bestätigungsmail mit einem Link. Oder „Mit Google anmelden" wählen; dann ist keine Bestätigungsmail nötig.',
          'Nutzungsbedingungen bestätigen. Danach geht es direkt weiter zur Google-Verbindung.',
        ],
      },
      {
        titel: 'Anmelden',
        absaetze: [
          'Später meldest du dich unter „Einloggen" an — mit E-Mail und Passwort oder mit Google, je nachdem, wie du dich registriert hast. Passwort vergessen? Über „Passwort vergessen" bekommst du einen Link zum Zurücksetzen.',
        ],
      },
      {
        titel: 'Google verbinden und Betrieb auswählen',
        absaetze: [
          'WERKRUF arbeitet mit deinem Google-Unternehmensprofil. Du stimmst einmal bei Google zu und wählst dann den Betrieb aus, um den es gehen soll. Wie das im Einzelnen abläuft, steht unter [Google-Profil verbinden](/hilfe/google-profil-verbinden).',
        ],
      },
      {
        titel: 'Was danach passiert',
        liste: [
          'WERKRUF liest Bewertungen, Profilangaben, Öffnungszeiten und Fotos ein und berechnet daraus deinen [WERKRUF-Score](/hilfe/health-score).',
          'Im Dashboard siehst du die nächsten Schritte — sortiert nach dem, was am meisten zählt.',
          'Ab dann prüft WERKRUF dein Profil täglich. Montags kommt eine kurze [Wochenmail](/hilfe/wochenmail); bei einer 1- oder 2-Sterne-Bewertung meldet sich WERKRUF sofort.',
        ],
      },
    ],
    macht: ['Liest dein Profil aus und schlägt die nächsten Schritte vor.', 'Ändert bei Google nur etwas, wenn du es auslöst oder freigibst.'],
    verwandt: ['google-profil-verbinden', 'google-rechte', 'wochenmail'],
    cta: true,
  },
  {
    slug: 'google-profil-verbinden',
    gruppe: 'google',
    titel: 'Google-Unternehmensprofil verbinden',
    seoTitel: 'Google-Unternehmensprofil mit WERKRUF verbinden',
    beschreibung: 'Schritt für Schritt: Google-Konto auswählen, zustimmen, Betrieb wählen. Und was passiert, wenn die Verbindung verloren geht.',
    einleitung: 'Die Verbindung ist der eine Schritt, ohne den WERKRUF nichts auswerten kann. Sie dauert etwa zwei Minuten.',
    abschnitte: [
      {
        titel: 'So läuft die Verbindung',
        schritte: [
          'Im Dashboard unter „Google" die Verbindung starten. Wer gerade die Testphase gestartet hat, landet automatisch dort.',
          'Google öffnet sich: das Google-Konto wählen, das dein Unternehmensprofil verwaltet.',
          'Bei Google zustimmen. Für dein Unternehmensprofil fragt WERKRUF genau eine Berechtigung an — welche, steht unter [Google-Rechte](/hilfe/google-rechte).',
          'Zurück bei WERKRUF die Verbindung bestätigen. Hat das Google-Konto mehrere Standorte, wählst du den Betrieb aus, um den es gehen soll.',
        ],
      },
      {
        titel: 'Nach der Verbindung',
        absaetze: [
          'WERKRUF gleicht Standort, Bewertungen und Fotos mit Google ab. Danach siehst du im Dashboard deinen Score und die nächsten Schritte.',
        ],
      },
      {
        titel: 'Wenn die Verbindung verloren geht',
        absaetze: [
          'Das passiert zum Beispiel, wenn du den Zugriff in deinem Google-Konto entziehst. WERKRUF erkennt das beim nächsten Abgleich und zeigt im Dashboard „Verbindung erneuern". Ein Klick führt wieder durch die Zustimmung bei Google — dein Profil und deine Daten bleiben dabei unverändert.',
        ],
      },
      {
        titel: 'Verbindung entfernen',
        absaetze: [
          'Du kannst die Verbindung im Dashboard jederzeit trennen. WERKRUF widerruft den Zugriff dann bei Google und löscht die gespeicherten Zugangsschlüssel. Alternativ entziehst du den Zugriff direkt in deinem Google-Konto unter „Drittanbieter-Apps mit Kontozugriff".',
        ],
      },
    ],
    macht: ['Fragt für dein Profil nur die Berechtigung „Unternehmensprofil verwalten" an.', 'Speichert Zugangsschlüssel verschlüsselt und gibt sie nie an deinen Browser weiter.'],
    machtNicht: ['Übernimmt nicht die Inhaberschaft deines Profils.', 'Liest keine E-Mails, Kontakte, Kalender oder Dateien.'],
    verwandt: ['google-rechte', 'datenschutz-google', 'erste-schritte'],
    cta: true,
  },
  {
    slug: 'google-rechte',
    gruppe: 'google',
    titel: 'Welche Google-Rechte braucht WERKRUF?',
    seoTitel: 'Google-Rechte von WERKRUF: was erlaubt ist und was nicht',
    beschreibung: 'Für dein Unternehmensprofil fragt WERKRUF eine einzige Google-Berechtigung an: das Profil verwalten. Was das erlaubt, wofür WERKRUF es nutzt und was nicht.',
    einleitung: 'Für dein Unternehmensprofil fragt WERKRUF genau eine Berechtigung an: „Google-Unternehmensprofil verwalten" (technisch: business.manage). Hier steht, was sie erlaubt und wofür WERKRUF sie nutzt.',
    abschnitte: [
      {
        titel: 'Mit welchem Google-Konto du verbindest',
        absaetze: [
          'Zusätzlich zeigt Google bei der Zustimmung, dass WERKRUF deine Google-Kontokennung und die E-Mail-Adresse dieses Kontos erfährt (technisch: openid, email). Damit ordnet WERKRUF die Verbindung deinem WERKRUF-Konto zu und zeigt dir, welches Google-Konto verbunden ist. Weitere Daten aus deinem Google-Konto ruft WERKRUF darüber nicht ab.',
        ],
      },
      {
        titel: 'Bewertungen lesen',
        absaetze: [
          'Damit WERKRUF neue und unbeantwortete Bewertungen erkennt und dich bei schlechten Bewertungen sofort informiert.',
        ],
      },
      {
        titel: 'Auf Bewertungen antworten',
        absaetze: [
          'Damit eine Antwort, die du freigegeben hast, bei Google erscheint. WERKRUF veröffentlicht keine Antwort ohne deine Freigabe. Eine veröffentlichte Antwort kannst du wieder zurückziehen.',
        ],
      },
      {
        titel: 'Profilangaben lesen und ändern',
        absaetze: [
          'Damit WERKRUF Lücken und veraltete Angaben erkennt — und damit Änderungen, die du in WERKRUF vornimmst (zum Beispiel Öffnungszeiten), direkt bei Google ankommen. Geändert wird nur, was du selbst änderst. Was WERKRUF wie bearbeiten kann, steht unter [Fotos und Profildaten](/hilfe/fotos-und-profildaten).',
        ],
      },
      {
        titel: 'Fotos',
        absaetze: [
          'Damit Fotos, die du in WERKRUF hochlädst, in deinem Google-Profil erscheinen, und damit WERKRUF sieht, wie viele Fotos dein Profil hat.',
        ],
      },
      {
        titel: 'Kennzahlen und Beiträge',
        absaetze: [
          'Mit derselben Berechtigung liest WERKRUF die Leistungsdaten deines Profils (Aufrufe, Anrufe, Routenanfragen, Website-Klicks) für die Wochenmail. Und wenn du einen vorbereiteten Saison-Beitrag mit einem Klick veröffentlichst, sendet WERKRUF ihn an dein Profil.',
        ],
      },
      {
        titel: 'Behält WERKRUF die Kontrolle über mein Profil?',
        liste: [
          'Nein. Dein Google-Unternehmensprofil bleibt deins — bei Google, in deinem Konto.',
          'WERKRUF wird nicht Inhaber und nicht Verwalter deines Profils; die Inhaberschaft wird nicht übertragen.',
          'Du kannst die Verbindung jederzeit trennen — im Dashboard oder in deinem Google-Konto. Kündigst du WERKRUF, bleibt dein Profil, wie es ist.',
        ],
      },
    ],
    machtNicht: [
      'Kein Zugriff auf E-Mails, Kontakte, Kalender, Fotos in Google Fotos oder Dateien — die angefragten Berechtigungen erlauben das technisch nicht.',
      'Keine Änderungen ohne dich: Antworten erst nach Freigabe, Profiländerungen nur, wenn du sie vornimmst.',
      'Keine Nutzung deiner Google-Daten für Werbung oder zum Training allgemeiner KI-Modelle.',
    ],
    verwandt: ['google-profil-verbinden', 'datenschutz-google', 'antwortvorschlaege'],
    cta: true,
  },
  {
    slug: 'bewertungen',
    gruppe: 'bewertungen',
    titel: 'Bewertungen mit WERKRUF',
    seoTitel: 'Google-Bewertungen im Blick: neue, offene und kritische',
    beschreibung: 'Wie WERKRUF neue und unbeantwortete Google-Bewertungen erkennt, was bei 1- und 2-Sterne-Bewertungen passiert und wie Aufgaben priorisiert werden.',
    einleitung: 'Wer vor einer Beauftragung dein Profil ansieht, achtet vor allem auf Bewertungen und darauf, ob du antwortest. WERKRUF hilft dir, da nichts zu verpassen.',
    abschnitte: [
      {
        titel: 'Neue und offene Bewertungen',
        absaetze: [
          'WERKRUF gleicht deine Bewertungen regelmäßig mit Google ab. Neue und noch unbeantwortete Bewertungen erscheinen im Dashboard unter „Bewertungen" und als Aufgabe — mit der Möglichkeit, direkt einen [Antwortvorschlag](/hilfe/antwortvorschlaege) erstellen zu lassen.',
        ],
      },
      {
        titel: 'Schlechte Bewertungen',
        absaetze: [
          'Bei einer 1- oder 2-Sterne-Bewertung wartet WERKRUF nicht bis Montag: Du bekommst eine eigene E-Mail. Eine schnelle, ruhige Antwort zeigt anderen Lesern, dass du dich kümmerst.',
        ],
      },
      {
        titel: 'Was in die Priorisierung einfließt',
        liste: [
          'Unbeantwortete Bewertungen, besonders negative',
          'Deine Antwortquote',
          'Wie lange die letzte Bewertung zurückliegt',
          'Antwortentwürfe, die noch auf deine Freigabe warten',
        ],
        absaetze: [
          'Daraus entstehen wenige konkrete Aufgaben, die wichtigste zuerst.',
        ],
      },
    ],
    machtNicht: [
      'Keine Garantie für mehr oder bessere Bewertungen und kein Einfluss auf Googles Reihenfolge.',
      'Kein Löschen von Bewertungen. Ob Google eine Bewertung entfernt, entscheidet Google.',
    ],
    verwandt: ['antwortvorschlaege', 'mehr-bewertungen', 'wochenmail'],
    cta: true,
  },
  {
    slug: 'antwortvorschlaege',
    gruppe: 'bewertungen',
    titel: 'Antwortvorschläge für Bewertungen',
    seoTitel: 'Antwortvorschläge für Google-Bewertungen: so funktionieren sie',
    beschreibung: 'WERKRUF formuliert auf Knopfdruck einen Antwortvorschlag mit KI. Du prüfst, änderst und gibst frei — veröffentlicht wird nichts automatisch.',
    einleitung: 'Auf Bewertungen zu antworten kostet Zeit, vor allem bei kritischen. WERKRUF schreibt dir einen Vorschlag, du entscheidest.',
    abschnitte: [
      {
        titel: 'So entsteht ein Vorschlag',
        schritte: [
          'Im Dashboard unter „Bewertungen" bei einer Bewertung „Antwort vorschlagen" klicken.',
          'WERKRUF lässt mit KI einen Vorschlag schreiben. Dafür werden Sternzahl, Bewertungstext, der angezeigte Name der bewertenden Person und dein Betriebsname verwendet.',
          'Der Vorschlag erscheint als Entwurf. Du kannst ihn ändern, neu erstellen lassen oder verwerfen.',
        ],
      },
      {
        titel: 'Freigeben und veröffentlichen',
        absaetze: [
          'Erst wenn du auf „Freigeben" klickst, veröffentlicht WERKRUF die Antwort bei Google — genau in der Fassung, die du freigegeben hast. Danach liest WERKRUF die Antwort bei Google zurück, damit du siehst, was dort wirklich steht. Eine veröffentlichte Antwort lässt sich zurückziehen.',
        ],
      },
      {
        titel: 'Gut zu wissen',
        liste: [
          'Vorschläge entstehen nur, wenn du sie anforderst — nicht automatisch für jede Bewertung.',
          'Antwortvorschläge sind Teil von Pro (auch in der Testphase).',
          'Bei heiklen Bewertungen weist WERKRUF darauf hin, den Vorschlag besonders genau zu prüfen.',
        ],
      },
    ],
    macht: ['Schreibt einen Entwurf, wenn du ihn anforderst.', 'Veröffentlicht nur nach deiner Freigabe.'],
    machtNicht: ['Keine automatische Veröffentlichung.', 'Kein Antworten im Hintergrund ohne dich.'],
    verwandt: ['bewertungen', 'google-rechte', 'datenschutz-google'],
    cta: true,
  },
  {
    slug: 'mehr-bewertungen',
    gruppe: 'bewertungen',
    titel: 'Mehr Bewertungen bekommen',
    seoTitel: 'Mehr Google-Bewertungen: Bewertungslink, QR-Code, SMS',
    beschreibung: 'Mit deinem persönlichen Bewertungslink, einem QR-Code zum Ausdrucken und einer SMS-Anfrage bittest du Kundinnen und Kunden um eine Google-Bewertung — du entscheidest, wann.',
    einleitung: 'Frische Bewertungen zeigen, dass dein Betrieb aktiv ist. WERKRUF gibt dir drei Wege, nach einem Auftrag um eine Bewertung zu bitten. Den Anstoß gibst immer du.',
    abschnitte: [
      {
        titel: 'Bewertungslink',
        absaetze: [
          'Im Dashboard unter „Mehr Bewertungen" findest du deinen persönlichen Link, der direkt zum Google-Bewertungsformular deines Betriebs führt — auch als kurze Adresse. Den Link verschickst du selbst: per E-Mail, Messenger, auf der Rechnung.',
        ],
      },
      {
        titel: 'QR-Code',
        absaetze: [
          'Derselbe Link als QR-Code zum Herunterladen und Ausdrucken — für die Übergabe, die Rechnung oder den Transporter.',
        ],
      },
      {
        titel: 'Bewertung per SMS anfragen',
        schritte: [
          'Vorname und Mobilnummer der Kundin oder des Kunden eingeben.',
          'Vorschau prüfen — der Text ist vorgegeben und enthält deinen Betriebsnamen und den Bewertungslink.',
          '„SMS senden" klicken.',
        ],
        absaetze: [
          'Bitte nur an Kundinnen und Kunden senden, die tatsächlich bei dir waren und bei denen du die Nummer für diesen Kontakt verwenden darfst. An dieselbe Nummer geht höchstens eine Anfrage pro Tag, und es gibt ein Tageslimit. WERKRUF speichert die Nummer nicht im Klartext.',
        ],
      },
      {
        titel: 'Wer das nutzen kann',
        absaetze: [
          'Bewertungslink, QR-Code und SMS-Anfrage sind Teil von Pro (auch in der Testphase).',
        ],
      },
    ],
    machtNicht: [
      'Kein automatischer Versand nach jedem Auftrag — jede Anfrage löst du selbst aus.',
      'Keine Kundenlisten, kein Abgleich mit deinen Aufträgen, keine automatische Erkennung von Kunden.',
      'Keine Garantie, dass daraus Bewertungen werden.',
    ],
    verwandt: ['bewertungen', 'antwortvorschlaege', 'preise-und-kuendigung'],
    cta: true,
  },
  {
    slug: 'fotos-und-profildaten',
    gruppe: 'profil',
    titel: 'Fotos und Profildaten',
    seoTitel: 'Profildaten und Fotos im Google-Unternehmensprofil pflegen',
    beschreibung: 'Welche Profilangaben WERKRUF prüft, was du direkt aus WERKRUF bei Google ändern kannst, wie Fotos hochgeladen werden und was der Profil-Wächter macht.',
    einleitung: 'Aktuelle Öffnungszeiten, vollständige Angaben und echte Fotos zeigen, dass dein Betrieb läuft. WERKRUF prüft das täglich und lässt dich Änderungen direkt an Google übertragen.',
    abschnitte: [
      {
        titel: 'Was WERKRUF prüft',
        liste: [
          'Pflichtangaben: Telefonnummer, Website, Adresse, Hauptkategorie',
          'Öffnungszeiten — und vor gesetzlichen Feiertagen, ob eine Sonderöffnungszeit hinterlegt ist',
          'Anzahl der Fotos',
          'Ob Google öffentlich etwas anderes zeigt als das, was du hinterlegt hast (Profil-Wächter)',
        ],
      },
      {
        titel: 'Was du direkt aus WERKRUF ändern kannst',
        absaetze: [
          'Öffnungszeiten und Sonderöffnungszeiten, Telefonnummer, Website, Unternehmensbeschreibung, Adresse und Einzugsgebiet, Leistungen und Kategorien — soweit Google das Feld für deinen Standort zur Bearbeitung freigibt. Deine Änderung geht direkt an Google; danach liest WERKRUF den Stand bei Google zurück. Den Unternehmensnamen änderst du weiterhin bei Google selbst.',
        ],
      },
      {
        titel: 'Feiertage',
        absaetze: [
          'Etwa zwei Wochen vor einem gesetzlichen Feiertag erinnert WERKRUF dich, wenn für diesen Tag keine Sonderöffnungszeit hinterlegt ist. Du wählst mit einem Klick: geschlossen, reguläre Zeiten oder andere Zeiten.',
        ],
      },
      {
        titel: 'Profil-Wächter',
        absaetze: [
          'Google ändert manchmal Angaben selbst oder übernimmt Vorschläge anderer Nutzer. WERKRUF vergleicht täglich, was du hinterlegt hast, mit dem, was Google öffentlich zeigt. Weicht etwas ab, siehst du es als Aufgabe — bei wichtigen Feldern wie Telefon oder Adresse sofort per E-Mail. Du entscheidest, ob du Googles Fassung übernimmst oder deine wiederherstellst. WERKRUF ändert dabei nichts von selbst.',
        ],
      },
      {
        titel: 'Fotos',
        absaetze: [
          'Fotos lädst du im Dashboard hoch; sie landen direkt in deinem Google-Profil. Du kannst sie dort auch wieder entfernen. Echte Bilder von Arbeiten, Team und Fahrzeug wirken besser als Stockfotos.',
        ],
      },
      {
        titel: 'Saison-Beiträge',
        absaetze: [
          'Zu Anlässen wie Weihnachten, Jahreswechsel, Ostern oder dem Sommer bereitet WERKRUF einen kurzen Beitrag für dein Profil vor. Du prüfst und änderst den Text; erst dein Klick sendet ihn an Google. Ungefragt postet WERKRUF nie.',
        ],
      },
    ],
    macht: ['Prüft täglich und zeigt Lücken als Aufgabe.', 'Überträgt deine Änderungen direkt an Google.'],
    machtNicht: ['Ändert nichts ohne dich.', 'Verspricht keine bestimmte Platzierung bei Google.'],
    verwandt: ['health-score', 'google-rechte', 'wochenmail'],
    cta: true,
  },
  {
    slug: 'health-score',
    gruppe: 'profil',
    titel: 'Der WERKRUF-Score',
    seoTitel: 'WERKRUF-Score: woraus er besteht und was er nicht misst',
    beschreibung: 'Der WERKRUF-Score fasst Antwortquote, Bewertung, Aktualität, Profilangaben und Fotos zu einem Wert von 0 bis 100 zusammen. Er ist eine Orientierung, kein Google-Ranking.',
    einleitung: 'Der WERKRUF-Score ist ein Wert von 0 bis 100. Er zeigt auf einen Blick, wie vollständig und gepflegt dein Profil ist — und wo die meisten Punkte liegen bleiben.',
    abschnitte: [
      {
        titel: 'Woraus er besteht',
        /* src/utils/healthScore.js HEALTH_WEIGHTS — 30/25/20/15/10 */
        liste: [
          'Antwortquote — bis 30 Punkte: Anteil der Bewertungen mit Antwort',
          'Bewertung — bis 25 Punkte: Durchschnitt von 3 Sternen (0 Punkte) bis 5 Sterne (volle Punkte)',
          'Aktualität — bis 20 Punkte: wie lange die letzte Bewertung zurückliegt (bis 30 Tage voll, danach abgestuft, nach 180 Tagen keine Punkte)',
          'Profilangaben — bis 15 Punkte: Telefonnummer, Website, Adresse, Hauptkategorie',
          'Fotos — bis 10 Punkte: ab 5 Fotos voll',
        ],
      },
      {
        titel: 'Was der Score nicht ist',
        absaetze: [
          'Der Score ist kein Google-Ranking und keine Messung, wie gut du gefunden wirst. Er garantiert keine Sichtbarkeit und keinen Umsatz. Er ist eine Orientierung dafür, wo dein Profil Lücken hat — die Aufgaben im Dashboard zeigen, welche sich zuerst lohnen.',
        ],
      },
    ],
    verwandt: ['fotos-und-profildaten', 'bewertungen', 'wochenmail'],
    cta: true,
  },
  {
    slug: 'wochenmail',
    gruppe: 'alltag',
    titel: 'Die Wochenmail und Sofortmeldungen',
    seoTitel: 'Wochenmail und Sofortmeldungen von WERKRUF',
    beschreibung: 'Jeden Montag eine kurze Mail mit dem, was zählt — auch in ruhigen Wochen. Bei schlechten Bewertungen und wichtigen Profiländerungen meldet sich WERKRUF sofort.',
    einleitung: 'WERKRUF ist kein Dashboard, in das du täglich schauen musst. Das Wichtige kommt per E-Mail.',
    abschnitte: [
      {
        titel: 'Montags: die Wochenmail',
        liste: [
          'Die Aufgaben dieser Woche, die wichtigste zuerst — jede mit kurzer Begründung und einer Zeitangabe',
          '„Deine Google-Woche": Aufrufe, Anrufe, Website-Klicks und Routenanfragen aus deinem Profil, soweit Google sie liefert',
          'Links, mit denen du einzelne Schritte direkt erledigen kannst',
        ],
      },
      {
        titel: 'Auch in ruhigen Wochen',
        absaetze: [
          'Die Wochenmail kommt jeden Montag. Gibt es nichts zu tun, steht das drin — zusammen mit dem, was WERKRUF geprüft hat. So weißt du, dass alles in Ordnung ist, ohne nachzusehen.',
        ],
      },
      {
        titel: 'Sofortmeldungen',
        absaetze: [
          'Manches wartet nicht bis Montag: eine 1- oder 2-Sterne-Bewertung und Abweichungen bei wichtigen Profilangaben wie Telefonnummer oder Adresse meldet WERKRUF mit einer eigenen E-Mail.',
        ],
      },
      {
        titel: 'Einstellen und pausieren',
        absaetze: [
          'Welche Mails du bekommst, stellst du im Dashboard unter „Einstellungen" ein. Für Betriebsferien kannst du WERKRUF bis zu acht Wochen pausieren: Aufgaben und Wochenmails ruhen, wirklich kritische Hinweise bekommst du weiter. Dein Abo läuft in der Pause normal weiter.',
        ],
      },
    ],
    machtNicht: ['Keine tägliche Flut von Mails.', 'Kein „nichts gehört" ohne Grund: Auch eine ruhige Woche wird bestätigt.'],
    verwandt: ['bewertungen', 'fotos-und-profildaten', 'preise-und-kuendigung'],
    cta: true,
  },
  {
    slug: 'preise-und-kuendigung',
    gruppe: 'konto',
    titel: 'Preise, Testphase und Kündigung',
    seoTitel: 'WERKRUF Preise, Testphase und Kündigung',
    beschreibung: 'WERKRUF kostet {preisMonat} im Monat oder {preisJahr} im Jahr. Die ersten {trialTage} Tage sind kostenlos, danach monatlich kündbar. Was nach der Kündigung bleibt.',
    einleitung: 'Ein Tarif, zwei Zahlweisen, keine Einrichtungsgebühr.',
    abschnitte: [
      {
        titel: 'Preise',
        liste: [
          'Monatlich: {preisMonat} pro Monat',
          'Jährlich: {preisJahr} pro Jahr — du sparst {ersparnis} gegenüber zwölf Monatszahlungen',
        ],
      },
      {
        titel: 'Testphase',
        absaetze: [
          'Die ersten {trialTage} Tage sind kostenlos. Deine Zahlungsdaten hinterlegst du zu Beginn bei unserem Zahlungsdienstleister Stripe; in diesen {trialTage} Tagen wird nichts abgebucht. Kündigst du nicht, beginnt danach das Abo.',
        ],
      },
      {
        titel: 'Kündigen',
        absaetze: [
          'In den Einstellungen unter „Abo & Zahlungen verwalten". Die Kündigung wird zum Ende des bezahlten Zeitraums wirksam — bis dahin nutzt du WERKRUF normal weiter. Das Monatsabo ist jeden Monat kündbar, das Jahresabo zum Ende des bezahlten Jahres; eine Kündigungsfrist gibt es nicht.',
        ],
      },
      {
        titel: 'Was nach der Kündigung bleibt',
        absaetze: [
          'Dein Konto bleibt bestehen und wechselt in den kostenlosen Modus: Google-Verbindung, Score und Profilstand bleiben sichtbar; Aufgaben, Antwortvorschläge, Fotos, Profilbearbeitung, „Mehr Bewertungen" und die Wochenmail gehören zu Pro. Über eine neue 1- oder 2-Sterne-Bewertung informiert dich WERKRUF weiterhin. Du kannst jederzeit wieder einsteigen. Dein Google-Profil bleibt in jedem Fall unverändert bei Google.',
          'Möchtest du dein Konto ganz löschen, geht das in den Einstellungen. Dabei werden deine Daten bei WERKRUF gelöscht, soweit keine gesetzliche Aufbewahrungspflicht besteht.',
        ],
      },
      {
        titel: 'Abrechnung',
        absaetze: [
          'Die Abrechnung läuft über Stripe. Rechnungen und Zahlungsart findest du ebenfalls unter „Abo & Zahlungen verwalten".',
        ],
      },
    ],
    verwandt: ['erste-schritte', 'mehr-bewertungen', 'datenschutz-google'],
    cta: true,
  },
  {
    slug: 'datenschutz-google',
    gruppe: 'datenschutz',
    titel: 'Datenschutz und Google-Verbindung',
    seoTitel: 'Datenschutz bei WERKRUF: Google-Verbindung und Datenflüsse',
    beschreibung: 'Warum WERKRUF dein Google-Profil verbindet, welche Daten verarbeitet werden, welche Dienste beteiligt sind und wie du die Verbindung wieder entfernst.',
    einleitung: 'Kurz zusammengefasst, was mit deinen Daten passiert. Verbindlich ist die Datenschutzerklärung.',
    abschnitte: [
      {
        titel: 'Warum Google verbunden wird',
        absaetze: [
          'Bewertungen, Öffnungszeiten, Fotos und Kategorien liegen bei Google. Ohne Verbindung kann WERKRUF nichts prüfen und nichts für dich übertragen. Welche Berechtigung das genau ist, steht unter [Google-Rechte](/hilfe/google-rechte).',
        ],
      },
      {
        titel: 'Welche Daten verarbeitet werden',
        liste: [
          'Dein Konto: E-Mail-Adresse und die Angaben zu deinem Betrieb',
          'Aus Google: Profilangaben, Bewertungen mit Antworten, Fotos und Leistungsdaten deines Profils',
          'Zugangsschlüssel zu Google — verschlüsselt gespeichert, nie im Browser',
        ],
      },
      {
        titel: 'Beteiligte Dienste',
        liste: [
          'Supabase: Datenbank und Anmeldung, Server in der EU (Frankfurt)',
          'Vercel: Auslieferung der Website',
          'Google: Unternehmensprofil, Anmeldung mit Google und die Betriebssuche im Dashboard',
          'Anthropic: erstellt Antwortvorschläge, wenn du sie anforderst',
          'Cloudinary: Speicherung der Fotos, die du hochlädst',
          'Brevo: E-Mails und SMS-Bewertungsanfragen',
          'Stripe: Zahlungen',
        ],
        absaetze: [
          'Google Analytics läuft auf der Website nur, wenn du im Cookie-Hinweis zustimmst.',
        ],
      },
      {
        titel: 'Verbindung und Daten entfernen',
        absaetze: [
          'Die Google-Verbindung trennst du im Dashboard oder in deinem Google-Konto. Dein ganzes Konto löschst du in den Einstellungen.',
        ],
      },
    ],
    machtNicht: ['Keine Weitergabe deiner Google-Daten zu Werbezwecken.', 'Kein Training allgemeiner KI-Modelle mit deinen Daten.'],
    verwandt: ['google-rechte', 'google-profil-verbinden', 'antwortvorschlaege'],
    rechtlich: true,
    cta: false,
  },
]);

export const HILFE_SLUGS = Object.freeze(HILFE_ARTIKEL.map((a) => a.slug));

export function artikel(slug) {
  return HILFE_ARTIKEL.find((a) => a.slug === slug) ?? null;
}

/* {platzhalter} → Wert; unbekannte bleiben stehen (Test faengt das). */
export function setzeWerte(text, werte) {
  return String(text).replace(/\{([a-zA-Z]+)\}/g, (m, k) => (werte[k] != null ? String(werte[k]) : m));
}
