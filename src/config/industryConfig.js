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
     HANDWERK — werkruf.de
  ───────────────────────────────────────────── */
  handwerk: {
    key: 'handwerk',

    /* Domain-Mapping (für automatische Erkennung) */
    domains: ['werkruf.de', 'www.werkruf.de', 'handwerk.werkruf.de'],

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
    },

    /* Texts */
    copy: {
      hero: {
        eyebrow:     'Für Handwerk & Gewerbe',
        headline:    'Volle Auftragsbücher?',
        headlineAccent: 'Pick dir die Rosinen.',
        subline:     'Schluss damit, jeden Auftrag annehmen zu müssen.',
        checks: [
          'Echte Google-Daten — kein Schätzwert',
          'Sichtbarkeits-Score in Sekunden',
          'Kostenloser 4-seitiger PDF-Report',
        ],
      },
      check: {
        eyebrow:       'Kostenloser Sofort-Check',
        title:         'Wie sichtbar bist du',
        titleAccent:   'gerade wirklich?',
        subline:       'Betrieb suchen — in Sekunden siehst du, was dir gerade entgeht.',
        cardTitle:     'Kostenloser Sichtbarkeits-Check',
        cardSub:       'Betrieb eingeben — wir zeigen dir sofort, was dir gerade entgeht.',
      },
      analysis: {
        eyebrow:       'Dein Analyse-Ergebnis',
        title:         'Dein',
        titleAccent:   'Sichtbarkeits-Score',
        successGreeting: 'Moin!',
        successSub:    'Wir schicken deinen Sichtbarkeits-Report in 48h an',
        upsellTitle:   'Direkt loslegen statt warten?',
        upsellText:    'Mit WERKRUF PRO startest du sofort — keine Wartezeit, kein PDF. Profil-Optimierung, Bewertungs-Autopilot und monatliche Reports.',
      },
      features: [
        {
          num: '01', title: 'A-Kunden Magnet',
          body: 'Dein Profil zieht genau die Auftraggeber an, die zahlen können und wollen. Keine Preisdiskussionen.',
          tag: 'Qualität statt Quantität',
        },
        {
          num: '02', title: 'Mitarbeiter-Magnet',
          body: 'Gute Leute suchen gute Betriebe. Mit einem starken Auftritt findest du Fachkräfte, bevor die Konkurrenz sie bekommt.',
          tag: 'Fachkräfte gewinnen',
        },
        {
          num: '03', title: 'Zeit zurückgewinnen',
          body: 'Kein Rumtelefonieren mehr mit Interessenten, die eh nix kaufen. Deine Zeit gehört den Projekten.',
          tag: 'Weniger Stress',
        },
        {
          num: '04', title: 'Besser gefunden werden',
          body: 'Google, Maps, Branchenportale — wir sorgen dafür, dass dich die Richtigen finden.',
          tag: 'SEO & Sichtbarkeit',
        },
        {
          num: '05', title: 'Dein Ruf, geschützt',
          body: 'Bewertungen sind heute alles. Wir helfen dir, aktiv gute Rezensionen zu sammeln.',
          tag: 'Reputation',
        },
        {
          num: '06', title: 'Schnell live',
          body: 'Kein monatelanges Hin-und-her. Dein Auftritt steht in 48 Stunden.',
          tag: 'Sofortstart',
        },
      ],
      footer: {
        tagline: 'Digitaler Rückenwind für echtes Handwerk',
        email:   'hallo@werkruf.de',
        links: [
          { label: 'Impressum',   href: '/impressum'  },
          { label: 'Datenschutz', href: '/datenschutz' },
          { label: 'Kontakt',     href: 'mailto:hallo@werkruf.de' },
        ],
      },
    },

    /* Pricing */
    pricing: {
      currency:        '€',
      monthlyPrice:    149,
      annualPrice:     1490,       // ~2 Monate gratis
      trialDays:       30,
      priceLabel:      '/ Monat (netto)',
      trialCTA:        'Jetzt 30 Tage gratis testen',
      productName:     'WERKRUF PRO',
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
        'Einrichtung in 48 Stunden',
        'Monatlich kündbar — kein Jahresvertrag',
      ],
      comparison: [
        { feature: 'Sichtbarkeits-Check',         free: true,  pro: true  },
        { feature: 'PDF-Report (4 Seiten)',         free: true,  pro: true  },
        { feature: 'Google-Profil Optimierung',     free: false, pro: true  },
        { feature: 'Keyword-Optimierung',           free: false, pro: true  },
        { feature: 'Bewertungs-Autopilot',          free: false, pro: true  },
        { feature: 'KI-Antwort-Assistent',          free: false, pro: true  },
        { feature: 'Monatliches PDF-Reporting',     free: false, pro: true  },
        { feature: 'Wettbewerber-Monitoring',       free: false, pro: true  },
        { feature: 'Persönlicher Ansprechpartner',  free: false, pro: true  },
      ],
    },
  },

  /* ─────────────────────────────────────────────
     GASTRONOMIE — gastroruf.de
  ───────────────────────────────────────────── */
  gastro: {
    key: 'gastro',

    domains: ['gastroruf.de', 'www.gastroruf.de', 'gastro.werkruf.de'],

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
    },

    copy: {
      hero: {
        eyebrow:        'Für Restaurants & Cafés',
        headline:       'Leere Tische?',
        headlineAccent: 'Nicht mit uns.',
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
        successSub:      'Wir schicken deinen Restaurant-Report in 48h an',
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
        email:   'hallo@gastroruf.de',
        links: [
          { label: 'Impressum',   href: '/impressum'  },
          { label: 'Datenschutz', href: '/datenschutz' },
          { label: 'Kontakt',     href: 'mailto:hallo@gastroruf.de' },
        ],
      },
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
     BEAUTY — beautyruf.de (Starter-Template)
  ───────────────────────────────────────────── */
  beauty: {
    key: 'beauty',

    domains: ['beautyruf.de', 'www.beautyruf.de', 'beauty.werkruf.de'],

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
        successSub:      'Wir schicken deinen Studio-Report in 48h an',
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
        email:   'hallo@beautyruf.de',
        links: [
          { label: 'Impressum',   href: '/impressum'  },
          { label: 'Datenschutz', href: '/datenschutz' },
          { label: 'Kontakt',     href: 'mailto:hallo@beautyruf.de' },
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
