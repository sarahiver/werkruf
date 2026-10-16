/* ═══════════════════════════════════════════════════════════════
   WERKRUF — INDUSTRY CONFIG

   Eine Variable ändert das komplette Look & Feel:
   Setze ACTIVE_INDUSTRY auf einen der Keys unten,
   ODER lass die Domain-Erkennung in IndustryContext.js
   automatisch die richtige Config wählen.

   Für lokale Entwicklung: 'handwerk' | 'gastro' | 'beauty'
═══════════════════════════════════════════════════════════════ */
export const ACTIVE_INDUSTRY = 'handwerk';

/* ═══════════════════════════════════════════════════════════════
   INDUSTRY DEFINITIONS
═══════════════════════════════════════════════════════════════ */
export const INDUSTRIES = {

  /* ─────────────────────────────────────────────
     HANDWERK — werkruf.com
  ───────────────────────────────────────────── */
  handwerk: {
    key: 'handwerk',

    /* Domain-Mapping (für automatische Erkennung) */
    domains: ['werkruf.com', 'www.werkruf.com', 'handwerk.werkruf.com'],

    /* Brand */
    brand: {
      name:    'WERKRUF',
      tagline: 'Digitaler Rückenwind für echtes Handwerk',
      logo:    'WERKRUF',
    },

    /* Colors */
    colors: {
      primary:    '#002C51',   // Navy Blue
      accent:     '#FF8C00',   // Safety Orange
      bg:         '#F2F2F2',   // Hellgrau
      bgDark:     '#001A30',   // Footer
      text:       '#1A1A1A',
      textMuted:  '#5A6A7A',
      border:     '#D0D8E0',
      white:      '#FFFFFF',
    },

    /* Typography feel */
    typography: {
      displayFont: "'Barlow Condensed', sans-serif",
      bodyFont:    "'Barlow', sans-serif",
      headingWeight: 900,
      letterSpacing: '0.02em',
      textTransform: 'uppercase',
    },

    /* Design feel tokens */
    design: {
      cardBorderRadius: '0px',      // Harte Kanten
      buttonBorderRadius: '0px',
      headerStyle: 'heavy-duty',    // heavy-duty | modern | elegant
      accentStripePattern: true,    // Diagonale Streifen im Hero
      topStripe: true,              // Bund-Muster oben (navy + orange)
    },

    /* Google Places API filter */
    places: {
      types: ['plumber', 'electrician', 'painter', 'roofing_contractor',
              'general_contractor', 'car_repair', 'locksmith'],
      primaryType: 'establishment',
      componentRestrictions: { country: 'de' },
      searchPlaceholder: 'z.B. Sanitär Müller Hamburg…',
      searchHint: 'Tipp: Firmenname + Stadt eingeben für beste Treffer.',
      tradeOptions: [
        { value: 'sanitaer',   label: 'Sanitär / Heizung'      },
        { value: 'elektro',    label: 'Elektro'                 },
        { value: 'maler',      label: 'Maler / Lackierer'       },
        { value: 'schreiner',  label: 'Schreiner / Tischler'    },
        { value: 'dachdecker', label: 'Dachdecker'              },
        { value: 'garten',     label: 'Garten / Landschaftsbau' },
        { value: 'reinigung',  label: 'Reinigung'               },
        { value: 'kfz',        label: 'KFZ'                     },
        { value: 'sonstiges',  label: 'Sonstiges'               },
      ],
    },

    /* Texts */
    copy: {
      hero: {
        eyebrow:     'Für Handwerk & Gewerbe',
        headline:    'Deine Arbeit ist besser,',
        headlineAccent: 'als dein Profil vermuten lässt.',
        /* Die Subline nennt seit dem 16.10.2026 den Nutzen zuerst und
           die Mechanik danach. Vorher begann sie mit "WERKRUF
           verbindet sich mit deinem Google-Profil" — das beschreibt
           einen technischen Vorgang, keinen Grund. */
        subline:     'WERKRUF behält deinen Google-Auftritt im Blick, damit du lokal besser gefunden wirst, professioneller wirkst und keine Bewertung und kein Profilproblem verpasst.',
        differenzierung: 'Du musst dich nicht darum kümmern. WERKRUF sagt dir, was wichtig ist — in wenigen Minuten erledigt.',
        checks: [
          'Einmal verbinden — dein Profil bleibt deins',
          'Antwortvorschläge auf Knopfdruck freigeben',
          'Meldung, sobald etwas nicht stimmt',
        ],
      },
      /* Hier standen bis zum 16.10.2026 die Blöcke `check` und
         `analysis` mit den Texten des öffentlichen
         Sichtbarkeits-Checks ("Kostenloser Profil-Check", "Dein
         Sichtbarkeits-Score", "Dein Profil-Befund ist unterwegs an").

         Entfernt, weil sie von KEINER Datei gelesen wurden — auch
         nicht von SmartCheck.js, AnalysisSection.js oder LeadForm.js,
         die ihre Texte selbst mitbringen. Gemessen am 16.10.2026 über
         den gesamten Quelltext.

         Der Check selbst liegt vollständig im Repository und kann
         zurückkommen. Kehrt er zurück, gehören seine Texte neu
         geschrieben statt aus dieser Generation übernommen: Sie
         versprachen einen Befund als PDF, den das Rechte-Gate in
         request-profile-report nicht herausgibt. */

      /* Die Kacheln hängen seit dem 16.10.2026 unter drei Ergebnissen
         statt nebeneinander. Grund: Sechs gleichgewichtete Karten
         zwingen den Leser, sich selbst eine Reihenfolge zu bauen.
         Drei Überschriften nehmen ihm das ab — und sie benennen das
         Ergebnis, nicht die Funktion.

         Dazu sind die Karten auf das umgestellt, was das Produkt
         wirklich tut. Bewertungslink und QR-Code standen vorher in
         keinem Verkaufstext, obwohl sie fertig sind. */
      featureGruppen: [
        {
          key: 'A', eyebrow: 'Ergebnis A',
          titel: 'Besser gefunden werden',
          einleitung: 'Ein vollständiges, aktuelles Profil ist die Voraussetzung dafür, dass Google dich überhaupt anzeigt.',
          karten: [
            {
              title: 'Dein Profil bleibt vollständig',
              body: 'Öffnungszeiten, Leistungen, Kontaktdaten, Kategorien: WERKRUF zeigt, was fehlt oder veraltet ist, und überträgt deine Änderungen direkt zu Google — ohne Umweg über Googles Oberfläche.',
              tag: 'Direkt bearbeiten',
            },
            {
              title: 'Fotos, die auch ankommen',
              body: 'Bild vom fertigen Bad, vom Team, vom Fahrzeug — hochladen, und es landet in deinem Google-Profil. Kein Zwischenschritt, keine fremde Galerie.',
              tag: 'Hochladen statt hochladen lassen',
            },
          ],
        },
        {
          key: 'B', eyebrow: 'Ergebnis B',
          titel: 'Professioneller wirken',
          einleitung: 'Wer vor der Beauftragung dein Profil liest, entscheidet nach dem, was er dort sieht — vor allem nach den Bewertungen und deinen Antworten darauf.',
          karten: [
            {
              title: 'Jede Bewertung beantwortet',
              body: 'Zu jeder neuen Bewertung liegt ein Antwortvorschlag bereit, im Ton deines Betriebs. Du liest ihn, änderst was du willst, gibst frei. Veröffentlicht wird nichts ohne dein Ja.',
              tag: 'Vorschlag, keine Automatik',
            },
            {
              title: 'Schlechte Bewertung? Du weisst es zuerst',
              body: 'Bei einem oder zwei Sternen meldet sich WERKRUF sofort — nicht erst montags. Eine schnelle, ruhige Antwort ist der Unterschied zwischen einem Ärgernis und einem Schaden.',
              tag: 'Sofortmeldung',
            },
            {
              title: 'Mehr Bewertungen bekommen',
              body: 'Dein persönlicher Google-Bewertungslink und ein QR-Code zum Ausdrucken — für die Rechnung, die Übergabe, den Transporter. Den Link verschickst du selbst, wann du willst.',
              tag: 'Link und QR-Code',
            },
          ],
        },
        {
          key: 'C', eyebrow: 'Ergebnis C',
          titel: 'Weniger Arbeit haben',
          einleitung: 'Das Unterscheidende: WERKRUF ist kein weiteres Dashboard, in das du täglich schauen musst.',
          karten: [
            {
              title: 'Montags eine Mail, mehr nicht',
              body: 'Darin steht, was diese Woche zählt — jede Aufgabe mit Begründung und einer Zeitangabe daneben. Ist nichts zu tun, steht das auch drin. Du musst nicht nachsehen.',
              tag: 'Priorisiert statt vollständig',
            },
            {
              title: 'Es fällt auf, bevor es dir auffällt',
              body: 'WERKRUF prüft dein Profil laufend und meldet sich, wenn etwas nicht stimmt: veraltete Öffnungszeiten, eine abgerissene Verbindung, eine neue Bewertung. Du erfährst es nicht vom Kunden am Telefon.',
              tag: 'Laufende Überwachung',
            },
          ],
        },
      ],

      /* Einwände, keine Vorteile — deshalb stehen sie als schmaler
         Streifen unter den Kacheln und nicht als eigene Karten. */
      vertrauen: [
        {
          title: 'Dein Profil bleibt deins',
          body: 'WERKRUF arbeitet in deinem Google-Konto, nicht in einem fremden. Kündigst du, bleibt alles bestehen.',
        },
        {
          title: 'Eine einzige Berechtigung',
          body: 'Nur „Unternehmensprofil verwalten". Kein Zugriff auf E-Mails, Kontakte oder Dateien. Jederzeit widerrufbar.',
        },
        {
          title: 'Keine Agentur',
          body: 'Kein Beratungstermin, keine Laufzeit. WERKRUF bereitet vor, du entscheidest und gibst frei.',
        },
      ],

      /* Für die Landingpage. Kurz beantwortet, nicht die Hilfeseite
         verdoppelt — die beantwortet dieselben Fragen ausführlicher. */
      faq: [
        {
          frage:   'Was kostet WERKRUF?',
          antwort: '49 € im Monat. Die ersten 30 Tage kostenlos, danach monatlich kündbar. Keine Einrichtungsgebühr, kein Jahresvertrag.',
        },
        {
          frage:   'Was darf WERKRUF bei Google?',
          antwort: 'Genau eine Berechtigung: dein Unternehmensprofil verwalten. Kein Zugriff auf E-Mails, Kontakte oder Dateien. Du kannst sie jederzeit in deinem Google-Konto widerrufen.',
        },
        {
          frage:   'Veröffentlicht WERKRUF etwas ohne mich?',
          antwort: 'Nein. Antworten, Öffnungszeiten, Fotos — nichts geht zu Google, bevor du es freigibst. WERKRUF bereitet vor, du entscheidest.',
        },
        {
          frage:   'Wie lange dauert die Einrichtung?',
          antwort: 'Zwei Minuten. Konto anlegen, Google-Profil verbinden, fertig. Den Rest macht WERKRUF.',
        },
        {
          frage:   'Brauche ich technisches Wissen?',
          antwort: 'Nein. Du bekommst Aufgaben in normalem Deutsch, mit einer Zeitangabe daneben. Wer eine Rechnung schreiben kann, kann das auch.',
        },
        {
          frage:   'Was passiert mit meinem Profil, wenn ich kündige?',
          antwort: 'Nichts. Das Profil gehört deinem Google-Konto, nicht WERKRUF. Bewertungen, Fotos und Angaben bleiben, wie sie sind.',
        },
        {
          frage:   'Muss ich jeden Tag ins Dashboard schauen?',
          antwort: 'Nein, und das ist der Punkt. Montags kommt eine Mail mit dem, was ansteht. Passiert etwas Dringendes, meldet WERKRUF sich sofort.',
        },
      ],

      footer: {
        tagline: 'Digitaler Rückenwind für echtes Handwerk',
        email:   'info@werkruf.com',
        links: [
          { label: 'AGB',         href: '/agb'        },
          { label: 'Impressum',   href: '/impressum'  },
          { label: 'Datenschutz', href: '/datenschutz' },
          { label: 'Hilfe',       href: '/hilfe'      },
        ],
      },
    },

    /* E-Mail & PDF copy — industry-specific */
    comms: {
      expertTitle:   'Handwerk-Experte',
      greeting:      'Moin',
      emailFrom:     'info@werkruf.com',
      emailSignature:'Dein WERKRUF-Team',
      fahrplanTitle: 'Dein Profil-Befund',  // Dateiname und Deckblatt

      /* Die Phasen beschrieben früher einen Dienstleistungsablauf:
         "wir optimieren", "wir erledigen den Rest". Jetzt beschreiben
         sie, wie die Software arbeitet — und an welcher Stelle der
         Betrieb entscheidet. */
      phases: [
        {
          num: '01', title: 'Verbinden',
          text: 'Du verbindest dein Google-Profil einmal mit WERKRUF. Eine Berechtigung, zwei Minuten, jederzeit widerrufbar. Das Profil bleibt deins.',
          icon: '🔗',
        },
        {
          num: '02', title: 'Überwachen',
          text: 'WERKRUF liest dein Profil regelmässig aus, erkennt Lücken und neue Bewertungen und meldet sich, wenn etwas deine Entscheidung braucht.',
          icon: '📡',
        },
        {
          num: '03', title: 'Freigeben',
          text: 'Zu jedem Punkt liegt ein Vorschlag bereit — Antwort, Öffnungszeit, fehlende Angabe. Du gibst frei, WERKRUF überträgt es zu Google.',
          icon: '✓',
        },
      ],

      /* Aus einer Bringschuld ("Was wir von dir brauchen") wird eine
         Bestandsaufnahme ("Was dein Profil noch braucht"). Dieselben
         Punkte, aber der Betrieb steht nicht mehr als Zulieferer da. */
      checklistTitle: 'Was dein Profil noch braucht',
      checklist: [
        'Fotos: Außenansicht, Team, fertige Arbeiten',
        'Öffnungszeiten inklusive Sonderzeiten',
        'Deine Leistungen, benannt wie Kunden danach suchen',
        'Telefonnummer und Website',
        'Vollständige Anschrift mit PLZ',
      ],
      checklistNote: 'WERKRUF zeigt dir im Dashboard, was davon fehlt — und überträgt deine Angaben direkt in dein Google-Profil.',
    },

    /* Pricing */
    pricing: {
      currency:        '€',
      trialDays:       30,
      productName:     'WERKRUF PRO',
      priceLabel:      '/ Monat',
      trialCTA:        'Jetzt 30 Tage gratis testen',

      /* EIN Preis, kein Pfad.
         Bis September 2026 gab es zwei Wege: Pfad A für Betriebe mit
         Google-Profil, Pfad B mit 149 € Einrichtungsgebühr für die
         ohne. Pfad B war eine Dienstleistung — jemand legte das Profil
         von Hand an und begleitete die Verifizierung.

         Das passt nicht mehr: WERKRUF ist Software, die der Betrieb
         selbst bedient. Wer noch kein Profil hat, legt es bei Google
         in zehn Minuten kostenlos an und verbindet es danach. Dafür
         eine Gebühr zu nehmen wäre schwer zu begründen.

         monthlyPrice und annualPrice liegen bewusst flach: Signup und
         Report-Mail lesen genau diese Felder. Unter pathA vergraben
         zeigte das Signup "undefined€ / Monat". */
      monthlyPrice:    49,
      /* quarterPrice und annualPrice liest KEINE Datei (gemessen am
         16.10.2026). Der Checkout steht fest auf 'monthly'. Die Werte
         bleiben als Platzhalter stehen, dürfen aber nirgends angezeigt
         werden, solange der Checkout sie nicht annimmt — ein Preis auf
         der Seite, den der Bezahlvorgang nicht kennt, ist ein
         Abbruch mit Ansage. */
      quarterPrice:    129,   // nicht beworben
      annualPrice:     449,   // nicht beworben
      setupFee:        0,

      /* Der ROI-Block stand bis zum 16.10.2026 hier und trug einen
         Rechner auf der Preisseite: 30 Anrufe × 30 % × 400 € = 3.600 €
         Zusatzumsatz, angezeigt als "ROI 7247 %". Entfernt, weil keine
         der drei Zahlen belegbar war und die Rechnung einen Anruf
         stillschweigend in einen Auftrag verwandelte.

         Wer eine Zahl braucht, nimmt die wahre: 49 € im Monat,
         588 € im Jahr, monatlich kündbar. Siehe p4a-product-truth-audit.md,
         Abschnitt E. */

      /* Was im Preis enthalten ist.

         Jede Zeile beschreibt etwas, das das Produkt heute tut, und
         zwar als Ergebnis statt als Werkzeugname. Bis zum 16.10.2026
         standen hier "Bewertungs-Autopilot (SMS + E-Mail)" und
         "Monatliches PDF-Reporting" — für beides existiert keine
         Zeile Code. */
      features: [
        'Montags eine Mail mit dem, was diese Woche zählt',
        'Sofort Bescheid bei 1- und 2-Sterne-Bewertungen',
        'Antwortvorschlag zu jeder Bewertung — du gibst frei',
        'Öffnungszeiten, Leistungen und Kontaktdaten direkt ändern',
        'Fotos hochladen, die bei Google landen',
        'Bewertungslink und QR-Code für deine Kunden',
        'Laufende Überwachung deines Profils',
        'Monatlich kündbar — kein Jahresvertrag',
      ],

      /* Der Vergleich stellt nicht mehr Free gegen Pro — einen
         kostenlosen Tarif gibt es nicht. Verglichen werden die drei
         Wege, die ein Betrieb wirklich hat. 'agentur' bleibt bewusst
         unscharf, wo Anbieter sich unterscheiden. */
      comparison: [
        { feature: 'Zeitaufwand im Monat',
          selbst: 'mehrere Stunden', agentur: 'gering', werkruf: 'wenige Minuten' },
        { feature: 'Kosten',
          selbst: 'nur deine Zeit',  agentur: 'Monatspaket', werkruf: '49 € / Monat' },
        { feature: 'Wem gehört das Profil',
          selbst: 'dir',             agentur: 'dir, verwaltet fremd', werkruf: 'dir' },
        { feature: 'Kündigung',
          selbst: '—',               agentur: 'oft mit Laufzeit', werkruf: 'monatlich' },
        { feature: 'Was zuerst zu tun ist',
          selbst: 'musst du selbst herausfinden', agentur: 'sagt dir der Anbieter', werkruf: 'sagt dir WERKRUF, mit Zeitangabe' },
        { feature: 'Veröffentlicht wird',
          selbst: 'was du machst',   agentur: 'je nach Anbieter', werkruf: 'nur was du freigibst' },
      ],

    },
  },

  /* ─────────────────────────────────────────────
     GASTRONOMIE — gastroruf.com

     ⚠️  ACHTUNG, STAND 16.10.2026: Dieser Block ist NICHT durch den
     Wahrheitsabgleich gegangen, den handwerk am 16.10.2026 bekommen
     hat. Er stammt aus der Generation davor und behauptet unter
     anderem einen "Bewertungs-Autopilot", "Monatliches Reporting",
     eine "Google Maps Top-Platzierung" und eine ROI-Rechnung mit
     +25 %. Keine dieser Funktionen existiert, und die Prozentzahl ist
     nicht belegt.

     Das ist heute folgenlos: gastroruf.com ist nicht live, und
     ACTIVE_INDUSTRY steht auf 'handwerk'. Es wird in dem Moment
     gefährlich, in dem die Domain aufgeschaltet wird.

     Vor einem Start dieser Marke gehört derselbe Abgleich hierher:
     docs/operations/p4a-product-truth-audit.md, Abschnitt B.
  ───────────────────────────────────────────── */
  gastro: {
    key: 'gastro',

    domains: ['gastroruf.com', 'www.gastroruf.com', 'gastro.werkruf.com'],

    brand: {
      name:    'GASTRORUF',
      tagline: 'Mehr Gäste. Volle Tische. Jeden Abend.',
      logo:    'GASTRORUF',
    },

    colors: {
      primary:    '#1A1A2E',   // Deep Midnight
      accent:     '#E63946',   // Restaurant Red
      bg:         '#FAF8F5',   // Warmes Weiß
      bgDark:     '#0D0D1A',
      text:       '#1A1A1A',
      textMuted:  '#6B6B7A',
      border:     '#E5E0DA',
      white:      '#FFFFFF',
    },

    typography: {
      displayFont: "'Playfair Display', serif",
      bodyFont:    "'Lato', sans-serif",
      headingWeight: 700,
      letterSpacing: '0.01em',
      textTransform: 'none',       // Kein uppercase für Gastro
    },

    design: {
      cardBorderRadius: '8px',     // Sanftere Ecken
      buttonBorderRadius: '4px',
      headerStyle: 'elegant',
      accentStripePattern: false,
      topStripe: false,
    },

    places: {
      types: ['restaurant', 'cafe', 'bar', 'bakery', 'meal_delivery',
              'meal_takeaway', 'night_club'],
      primaryType: 'establishment',
      componentRestrictions: { country: 'de' },
      searchPlaceholder: 'z.B. Trattoria Milano Hamburg…',
      searchHint: 'Tipp: Restaurantname + Stadt für beste Treffer.',
      tradeOptions: [
        { value: 'restaurant', label: 'Restaurant'        },
        { value: 'cafe',       label: 'Café / Bistro'     },
        { value: 'bar',        label: 'Bar / Kneipe'      },
        { value: 'baeckerei',  label: 'Bäckerei'          },
        { value: 'lieferung',  label: 'Lieferservice'     },
        { value: 'catering',   label: 'Catering'          },
        { value: 'sonstiges',  label: 'Sonstiges'         },
      ],
    },

    copy: {
      hero: {
        eyebrow:        'Für Restaurants & Cafés',
        headline:       'Leere Tische?',
        headlineAccent: 'Nicht mit vollem Profil.',
        subline:        'Mehr Reservierungen, bessere Bewertungen, volle Abende — automatisch.',
        checks: [
          'Echte Google-Daten in Sekunden',
          'Bewertungs-Analyse & Optimierung',
          'Kostenloser Restaurant-Report',
        ],
      },
      check: {
        eyebrow:     'Kostenloser Restaurant-Check',
        title:       'Wie gut ist dein',
        titleAccent: 'Online-Auftritt?',
        subline:     'Restaurant suchen — sofort siehst du, wo Gäste verloren gehen.',
        cardTitle:   'Kostenloser Restaurant-Check',
        cardSub:     'Name eingeben — wir zeigen dir, was dich Reservierungen kostet.',
      },
      analysis: {
        eyebrow:         'Deine Restaurant-Analyse',
        title:           'Dein',
        titleAccent:     'Gäste-Score',
        successGreeting: 'Sehr gerne!',
        successSub:      'Dein Profil-Befund ist unterwegs an',
        upsellTitle:     'Sofort mehr Reservierungen?',
        upsellText:      'Mit GASTRORUF PRO optimieren wir dein Profil, automatisieren Bewertungsanfragen und füllen deine Tische.',
      },
      features: [
        {
          num: '01', title: 'Mehr Reservierungen',
          body: 'Dein Google-Profil wird so optimiert, dass hungrige Gäste dich finden — nicht die Konkurrenz.',
          tag: 'Direkte Buchungen',
        },
        {
          num: '02', title: 'Bewertungs-Autopilot',
          body: 'Nach jedem Besuch automatisch um eine Rezension bitten — mehr Sterne, mehr Vertrauen, mehr Gäste.',
          tag: '5-Sterne-Strategie',
        },
        {
          num: '03', title: 'Google Maps Top-Platzierung',
          body: 'Bei "Restaurant in [Stadt]" auf Seite 1 erscheinen. Dort entscheiden sich Gäste.',
          tag: 'Lokales SEO',
        },
        {
          num: '04', title: 'Speisekarte optimiert',
          body: 'Deine Karte ist auf Google sichtbar und aktuell — inklusive saisonaler Anpassungen.',
          tag: 'Menu-Sichtbarkeit',
        },
        {
          num: '05', title: 'Krisen-Management',
          body: 'Auf schlechte Bewertungen professionell reagieren — wir liefern die Texte, du klickst absenden.',
          tag: 'Reputation',
        },
        {
          num: '06', title: 'Monatlicher Report',
          body: 'Klare Zahlen: Wie oft wurdest du gefunden? Wie viele haben angerufen? Was hat sich verbessert?',
          tag: 'Transparenz',
        },
      ],
      footer: {
        tagline: 'Mehr Gäste. Volle Tische. Jeden Abend.',
        email:   'hallo@gastroruf.com',
        links: [
          { label: 'Impressum',   href: '/impressum'  },
          { label: 'Datenschutz', href: '/datenschutz' },
          { label: 'Kontakt',     href: 'mailto:hallo@gastroruf.com' },
        ],
      },
    },

    comms: {
      expertTitle:   'Gastronomie-Experte',
      greeting:      'Hallo',
      emailFrom:     'hallo@gastroruf.com',
      emailSignature:'Dein GASTRORUF-Team',
      fahrplanTitle: 'Dein Profil-Befund',  // Dateiname und Deckblatt
      phases: [
        {
          num: '01', title: 'Verbinden',
          text: 'Du verbindest dein Google-Profil einmal mit GASTRORUF. Eine Berechtigung, zwei Minuten, jederzeit widerrufbar. Das Profil bleibt deins.',
          icon: '🔗',
        },
        {
          num: '02', title: 'Überwachen',
          text: 'GASTRORUF liest dein Profil regelmässig aus, erkennt Lücken und neue Gästebewertungen und meldet sich, wenn etwas deine Entscheidung braucht.',
          icon: '📡',
        },
        {
          num: '03', title: 'Freigeben',
          text: 'Zu jedem Punkt liegt ein Vorschlag bereit — Antwort, Öffnungszeit, fehlende Angabe. Du gibst frei, GASTRORUF überträgt es zu Google.',
          icon: '✓',
        },
      ],
      checklistTitle: 'Was dein Profil noch braucht',
      checklist: [
        'Fotos: Außenansicht, Innenraum, Speisen, Team',
        'Öffnungszeiten und Ruhetage',
        'Speisekarte oder deine bekanntesten Gerichte',
        'Telefonnummer für Reservierungen',
        'Vollständige Anschrift mit PLZ',
      ],
      checklistNote: 'GASTRORUF zeigt dir im Dashboard, was davon fehlt — und überträgt deine Angaben direkt in dein Google-Profil.',
    },

    pricing: {
      currency:        '€',
      monthlyPrice:    89,
      annualPrice:     890,
      trialDays:       30,
      priceLabel:      '/ Monat',
      trialCTA:        'Jetzt 30 Tage gratis starten',
      productName:     'GASTRORUF PRO',
      roi: {
        avgOrderValue:     45,       // EUR pro Gast
        upliftFactor:      0.25,
        maxMonthlyRevenue: 2700,
        sliderMin:         10,
        sliderMax:         500,
        sliderStep:        10,
        sliderDefault:     80,
        sliderLabel:       'Wie viele Gäste hast du aktuell pro Monat?',
        callsLabel:        'neue Gäste / Mo.',
        investmentLabel:   'dein Monatsbeitrag',
        revenueLabel:      'zusätzlicher Umsatz',
        roiNote:           '* Basiert auf Ø +25 % mehr Online-Reservierungen und einem durchschnittlichen Gästeumsatz von',
      },
      features: [
        'Google-Profil Optimierung',
        'Bewertungs-Autopilot (nach Besuch)',
        'Monatliches Reporting',
        'KI-Antwort-Assistent',
        'Speisekarten-Optimierung',
        'Monatlich kündbar',
      ],
      comparison: [
        { feature: 'Restaurant-Check',              free: true,  pro: true  },
        { feature: 'PDF-Report',                     free: true,  pro: true  },
        { feature: 'Google-Profil Optimierung',      free: false, pro: true  },
        { feature: 'Speisekarten-Optimierung',       free: false, pro: true  },
        { feature: 'Bewertungs-Autopilot',           free: false, pro: true  },
        { feature: 'KI-Antwort-Assistent',           free: false, pro: true  },
        { feature: 'Monatliches Reporting',          free: false, pro: true  },
        { feature: 'Reservierungs-Monitoring',       free: false, pro: true  },
      ],
    },
  },

  /* ─────────────────────────────────────────────
     BEAUTY — beautyruf.com (Starter-Template)

     ⚠️  Wie bei gastro: nicht durch den Wahrheitsabgleich vom
     16.10.2026 gegangen. Behauptet "Buchungs-Autopilot",
     "Bewertungs-Autopilot", "Monatliches Reporting" und eine
     ROI-Rechnung mit +20 %. Nichts davon existiert. Nicht live,
     deshalb heute folgenlos — vor einem Start derselbe Abgleich.
  ───────────────────────────────────────────── */
  beauty: {
    key: 'beauty',

    domains: ['beautyruf.com', 'www.beautyruf.com', 'beauty.werkruf.com'],

    brand: {
      name:    'BEAUTYRUF',
      tagline: 'Mehr Buchungen für dein Studio.',
      logo:    'BEAUTYRUF',
    },

    colors: {
      primary:    '#2D1B4E',   // Deep Violet
      accent:     '#C9A96E',   // Gold
      bg:         '#FAFAF8',
      bgDark:     '#1A0F2E',
      text:       '#1A1A1A',
      textMuted:  '#6B6070',
      border:     '#E5DDE8',
      white:      '#FFFFFF',
    },

    typography: {
      displayFont: "'Cormorant Garamond', serif",
      bodyFont:    "'Nunito Sans', sans-serif",
      headingWeight: 600,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    },

    design: {
      cardBorderRadius: '12px',
      buttonBorderRadius: '2px',
      headerStyle: 'elegant',
      accentStripePattern: false,
      topStripe: false,
    },

    places: {
      types: ['beauty_salon', 'hair_care', 'spa', 'gym', 'nail_salon'],
      primaryType: 'establishment',
      componentRestrictions: { country: 'de' },
      searchPlaceholder: 'z.B. Salon Maria Hamburg…',
      searchHint: 'Tipp: Studio-Name + Stadt eingeben.',
    },

    copy: {
      hero: {
        eyebrow:        'Für Salons & Studios',
        headline:       'Mehr Buchungen.',
        headlineAccent: 'Weniger Leerlauf.',
        subline:        'Dein Studio online so präsentieren, dass Neukunden von selbst kommen.',
        checks: [
          'Google-Präsenz sofort analysieren',
          'Buchungs-Score in Sekunden',
          'Kostenloser Studio-Report',
        ],
      },
      check: {
        eyebrow:     'Kostenloser Studio-Check',
        title:       'Wie gut bist du',
        titleAccent: 'online sichtbar?',
        subline:     'Studio suchen — sofort siehst du, wo Neukunden verloren gehen.',
        cardTitle:   'Kostenloser Studio-Check',
        cardSub:     'Namen eingeben — wir zeigen dir dein Potenzial.',
      },
      analysis: {
        eyebrow:         'Deine Studio-Analyse',
        title:           'Dein',
        titleAccent:     'Buchungs-Score',
        successGreeting: 'Perfekt!',
        successSub:      'Dein Profil-Befund ist unterwegs an',
        upsellTitle:     'Sofort mehr Buchungen?',
        upsellText:      'Mit BEAUTYRUF PRO füllen wir deinen Kalender — automatisch.',
      },
      features: [
        { num: '01', title: 'Mehr Neukunden',       body: 'Dein Profil zieht genau die Kunden an, die zu dir passen.',              tag: 'Zielgruppe' },
        { num: '02', title: 'Bewertungen steigern', body: 'Automatisch nach dem Termin um Rezensionen bitten.',                     tag: '5 Sterne' },
        { num: '03', title: 'Google Top-Platz',     body: 'Bei lokaler Suche ganz oben erscheinen.',                               tag: 'Lokales SEO' },
        { num: '04', title: 'Fotos optimiert',      body: 'Professionelle Galerie auf Google Maps — deine Arbeit spricht für sich.', tag: 'Visuals' },
        { num: '05', title: 'Reputation',           body: 'Auf negative Bewertungen souverän reagieren.',                          tag: 'Brand' },
        { num: '06', title: 'Monatlicher Report',   body: 'Klare Zahlen: Aufrufe, Anrufe, Buchungs-Anfragen.',                     tag: 'Transparenz' },
      ],
      footer: {
        tagline: 'Mehr Buchungen für dein Studio.',
        email:   'hallo@beautyruf.com',
        links: [
          { label: 'Impressum',   href: '/impressum'  },
          { label: 'Datenschutz', href: '/datenschutz' },
          { label: 'Kontakt',     href: 'mailto:hallo@beautyruf.com' },
        ],
      },
    },

    pricing: {
      currency:        '€',
      monthlyPrice:    69,
      annualPrice:     690,
      trialDays:       30,
      priceLabel:      '/ Monat',
      trialCTA:        'Jetzt 30 Tage gratis starten',
      productName:     'BEAUTYRUF PRO',
      roi: {
        avgOrderValue:     60,
        upliftFactor:      0.20,
        maxMonthlyRevenue: 1200,
        sliderMin:         5,
        sliderMax:         200,
        sliderStep:        5,
        sliderDefault:     30,
        sliderLabel:       'Wie viele Termine hast du aktuell pro Monat?',
        callsLabel:        'neue Termine / Mo.',
        investmentLabel:   'dein Monatsbeitrag',
        revenueLabel:      'zusätzlicher Umsatz',
        roiNote:           '* Basiert auf Ø +20 % mehr Online-Buchungen und einem durchschnittlichen Terminwert von',
      },
      features: [
        'Google-Profil Optimierung',
        'Buchungs-Autopilot',
        'Monatliches Reporting',
        'KI-Antwort-Assistent',
        'Foto-Galerie Optimierung',
        'Monatlich kündbar',
      ],
      comparison: [
        { feature: 'Studio-Check',                  free: true,  pro: true  },
        { feature: 'PDF-Report',                     free: true,  pro: true  },
        { feature: 'Google-Profil Optimierung',      free: false, pro: true  },
        { feature: 'Bewertungs-Autopilot',           free: false, pro: true  },
        { feature: 'KI-Antwort-Assistent',           free: false, pro: true  },
        { feature: 'Foto-Galerie Optimierung',       free: false, pro: true  },
        { feature: 'Monatliches Reporting',          free: false, pro: true  },
        { feature: 'Kalender-Integration',           free: false, pro: true  },
      ],
    },
  },
};

/* ═══════════════════════════════════════════════════════════════
   DOMAIN → INDUSTRY MAPPING
   Wird von IndustryContext.js für automatische Erkennung genutzt
═══════════════════════════════════════════════════════════════ */
export const DOMAIN_MAP = Object.values(INDUSTRIES).reduce((map, cfg) => {
  cfg.domains.forEach(domain => { map[domain] = cfg.key; });
  return map;
}, {});

/* ═══════════════════════════════════════════════════════════════
   HELPER — aktive Config holen
═══════════════════════════════════════════════════════════════ */
export function getIndustryConfig(key) {
  return INDUSTRIES[key] || INDUSTRIES[ACTIVE_INDUSTRY];
}
