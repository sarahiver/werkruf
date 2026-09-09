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
        subline:     'WERKRUF verbindet sich mit deinem Google-Profil, behält es im Blick und schlägt dir vor, was zu tun ist. Veröffentlicht wird nur, was du freigibst.',
        checks: [
          'Einmal verbinden — dein Profil bleibt deins',
          'Antwortvorschläge auf Knopfdruck freigeben',
          'Meldung, sobald etwas nicht stimmt',
        ],
      },
      check: {
        eyebrow:       'Kostenloser Sofort-Check',
        title:         'Wie sichtbar bist du',
        titleAccent:   'gerade wirklich?',
        subline:       'Betrieb suchen — in Sekunden siehst du, was an deinem Profil gerade fehlt.',
        cardTitle:     'Kostenloser Profil-Check',
        cardSub:       'Betrieb eingeben. Der Check liest deine öffentlichen Google-Daten und zeigt sofort, wo Lücken sind.',
      },
      analysis: {
        eyebrow:       'Dein Analyse-Ergebnis',
        title:         'Dein',
        titleAccent:   'Sichtbarkeits-Score',
        successGreeting: 'Moin!',
        successSub:    'Dein Profil-Befund ist unterwegs an',
        upsellTitle:   'Nicht nur sehen, sondern ändern?',
        upsellText:    'Verbinde dein Google-Profil mit WERKRUF. Ab dann siehst du Lücken nicht nur — du schliesst sie mit einem Klick.',
      },
      /* Drei Versprechen statt sechs Funktionen.
         Vorher standen hier sechs Kacheln, von denen vier dasselbe
         sagten ("du wirst besser gefunden"). Jede Kachel beantwortet
         jetzt eine andere Frage — und jede endet bei einer Handlung,
         die der Betrieb selbst auslöst. */
      features: [
        {
          num: '01', title: 'Es fällt auf, bevor es dir auffällt',
          body: 'WERKRUF prüft dein Profil laufend und meldet sich, wenn etwas nicht stimmt: eine neue Bewertung, veraltete Öffnungszeiten, eine abgerissene Verbindung. Du erfährst es nicht vom Kunden am Telefon.',
          tag: 'Laufende Überwachung',
        },
        {
          num: '02', title: 'Es ist beantwortet, bevor du dran denkst',
          body: 'Zu jeder neuen Bewertung liegt ein Antwortvorschlag bereit — im Ton deines Betriebs. Du liest ihn, änderst was du willst, gibst frei. Veröffentlicht wird nichts ohne dein Ja.',
          tag: 'KI schlägt vor, du entscheidest',
        },
        {
          num: '03', title: 'Es stimmt, auch wenn du nicht dran denkst',
          body: 'Öffnungszeiten, Leistungen, Fotos: WERKRUF zeigt dir, was fehlt oder veraltet ist, und überträgt deine Änderungen direkt in dein Google-Profil.',
          tag: 'Profil aktuell halten',
        },
        {
          num: '04', title: 'Dein Profil bleibt deins',
          body: 'WERKRUF arbeitet in deinem Google-Konto, nicht in einem fremden. Kündigst du, bleibt alles bestehen — Profil, Bewertungen, Fotos.',
          tag: 'Kein Lock-in',
        },
        {
          num: '05', title: 'Eine einzige Berechtigung',
          body: 'WERKRUF fragt genau ein Recht ab: dein Unternehmensprofil verwalten. Kein Zugriff auf E-Mails, Kontakte oder Dateien. Jederzeit widerrufbar.',
          tag: 'Nachprüfbar',
        },
        {
          num: '06', title: 'Zwei Minuten pro Woche',
          body: 'Mehr Zeit kostet es dich nicht. Der Rest läuft im Hintergrund, während du auf der Baustelle bist.',
          tag: 'Kein zusätzlicher Aufwand',
        },
      ],
      footer: {
        tagline: 'Digitaler Rückenwind für echtes Handwerk',
        email:   'hallo@werkruf.com',
        links: [
          { label: 'Impressum',   href: '/impressum'  },
          { label: 'Datenschutz', href: '/datenschutz' },
          { label: 'Kontakt',     href: 'mailto:hallo@werkruf.com' },
        ],
      },
    },

    /* E-Mail & PDF copy — industry-specific */
    comms: {
      expertTitle:   'Handwerk-Experte',
      greeting:      'Moin',
      emailFrom:     'hallo@werkruf.com',
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
      priceLabel:      '/ Monat (netto)',
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
      quarterPrice:    129,   // ~12% günstiger
      annualPrice:     449,   // ~24% günstiger
      setupFee:        0,

      roi: {
        avgOrderValue:     400,    // EUR
        upliftFactor:      0.30,   // +30% mehr qualif. Anfragen
        maxMonthlyRevenue: 9120,
        sliderMin:         5,
        sliderMax:         150,
        sliderStep:        5,
        sliderDefault:     30,
        sliderLabel:       'Wie viele Anrufe bekommst du aktuell pro Monat?',
        callsLabel:        'neue Aufträge / Mo.',
        investmentLabel:   'dein Monatsbeitrag',
        revenueLabel:      'zusätzlicher Umsatz',
        roiNote:           '* Basiert auf Ø +30 % mehr qualifizierten Anfragen und einem durchschnittlichen Auftragswert von',
      },
      features: [
        'Google-Profil Optimierung (vollständig)',
        'Bewertungs-Autopilot (SMS + E-Mail)',
        'Monatliches PDF-Reporting',
        'KI-Antwort-Assistent für Rezensionen',
        'Verbunden in zwei Minuten',
        'Monatlich kündbar — kein Jahresvertrag',
      ],
      comparison: [
        /* Zeilen beschreiben jetzt Ergebnisse statt Werkzeugnamen.
           "Bewertungs-Autopilot" und "KI-Antwort-Assistent" waren
           zwei Namen für dieselbe Sache — zusammengeführt.
           "Persönlicher Ansprechpartner" ist raus: das klang nach
           Agentur und ist keine Funktion, sondern Support. */
        { feature: 'Profil-Check ohne Anmeldung',        free: true,  pro: true  },
        { feature: 'Befund als PDF',                     free: true,  pro: true  },
        { feature: 'Google-Profil verbinden',            free: false, pro: true  },
        { feature: 'Laufende Überwachung',               free: false, pro: true  },
        { feature: 'Bewertungen im Dashboard',           free: false, pro: true  },
        { feature: 'KI-Antwortvorschläge zum Freigeben', free: false, pro: true  },
        { feature: 'Profil-Angaben direkt ändern',       free: false, pro: true  },
        { feature: 'Meldung bei Problemen',              free: false, pro: true  },
      ],
    },
  },

  /* ─────────────────────────────────────────────
     GASTRONOMIE — gastroruf.com
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
      priceLabel:      '/ Monat (netto)',
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
      priceLabel:      '/ Monat (netto)',
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
