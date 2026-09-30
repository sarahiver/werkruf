/**
 * Feldmodell der Google-Profilverwaltung.
 *
 * EINE Quelle für drei Fragen, die sonst in jedem Dashboard-Bereich
 * neu beantwortet würden:
 *
 *   1. Welche Felder gibt es, und in welchen Bereich gehören sie?
 *   2. Was sagt die API über sie — schreibbar, nur ganz, nur lesbar?
 *   3. Darf DIESER Betrieb sie bearbeiten?
 *
 * Die ersten beiden stammen aus der Bestandsaufnahme
 * (docs/google-api-inventory.md, erzeugt aus den Discovery-Dokumenten).
 * Die dritte ist etwas anderes: Sie hängt am einzelnen Standort und
 * lässt sich nur aus den Google-Metadaten beantworten, die beim Sync
 * mitkommen.
 *
 * ⚠️  DAS MODELL STEUERT DIE OBERFLÄCHE, NICHT DIE SICHERHEIT.
 *
 * Es entscheidet, welches Feld angezeigt und welches gesperrt wird.
 * Verbindlich ist die serverseitige Prüfung in
 * supabase/functions/google-business/. Ein Aufrufer, der die
 * Oberfläche umgeht, kommt damit nicht weiter — der Server prüft
 * dieselben Regeln noch einmal, aus denselben Daten.
 *
 * Reines JavaScript ohne Importe: Deno holt es relativ (wie
 * visibilityScore.js), Jest direkt.
 */

/* ─────────────────────────────────────────────
   BEREICHE

   Die Unternavigation des Dashboards. Reihenfolge bestimmt die
   Anzeige; `key` taucht in der URL auf.
───────────────────────────────────────────── */
export const BEREICHE = Object.freeze([
  { key: 'stammdaten',  titel: 'Unternehmensinformationen',
    beschreibung: 'Name, Kontakt, Beschreibung und Adresse.' },
  { key: 'oeffnungszeiten', titel: 'Öffnungszeiten',
    beschreibung: 'Reguläre Zeiten, Feiertage und Sonderöffnungszeiten.' },
  { key: 'kategorien',  titel: 'Kategorien und Attribute',
    beschreibung: 'Wie Google dein Unternehmen einordnet und welche Merkmale gesetzt sind.' },
  { key: 'leistungen',  titel: 'Leistungen',
    beschreibung: 'Dienstleistungen, die du anbietest.' },
  { key: 'medien',      titel: 'Bilder und Medien',
    beschreibung: 'Profilbild, Titelbild und weitere Aufnahmen.' },
  { key: 'bewertungen', titel: 'Bewertungen',
    beschreibung: 'Rezensionen lesen, beantworten und veröffentlichen.' },
  { key: 'status',      titel: 'Profilstatus',
    beschreibung: 'Was Google geändert hat und ob etwas von dir erwartet wird.' },
]);

/* ─────────────────────────────────────────────
   SCHREIBART

   Aus dem Discovery-Dokument abgeleitet, nicht geraten.
───────────────────────────────────────────── */
export const SCHREIBART = Object.freeze({
  /** Unterpfad erlaubt: updateMask=profile.description */
  UNTERPFAD: 'unterpfad',
  /** Nur als ganzes Objekt. Google lehnt Unterpfade ab. */
  GANZ: 'ganz',
  /** Nur lesbar — die API gibt es nicht zum Schreiben frei. */
  LESEN: 'lesen',
  /**
   * Von Google unterstützt, in WERKRUF noch nicht umgesetzt.
   *
   * Ein eigener Zustand, weil die Auskunft eine andere ist: Hier
   * kommt es noch, dort kommt es nicht. Ein Feld als „bearbeitbar"
   * zu zeigen, für das es keine Eingabemaske gibt, wäre ein
   * Versprechen, das die Oberfläche nicht einlöst.
   */
  NOCH_NICHT: 'noch_nicht',
  /**
   * Die API erlaubt es, WERKRUF nicht.
   *
   * Ein eigener Zustand, weil der Grund ein anderer ist: Hier ist es
   * eine Produktentscheidung, keine technische Schranke. Die
   * Unterscheidung gehoert in die Oberflaeche — "Google gibt das nicht
   * frei" und "wir machen das absichtlich nicht" sind fuer den Kunden
   * verschiedene Auskuenfte.
   */
  GESPERRT: 'gesperrt',
});

/* ─────────────────────────────────────────────
   VORAUSSETZUNGEN JE STANDORT

   Google liefert in Location.metadata Kennzeichen, welche
   Bearbeitungen für diesen einen Standort überhaupt erlaubt sind.
   Ohne sie sähe die Oberfläche Felder vor, die Google beim Speichern
   ablehnt — oder schlimmer, stillschweigend verwirft.
───────────────────────────────────────────── */
export const VORAUSSETZUNG = Object.freeze({
  SERVICE_LIST: 'canModifyServiceList',
  FOOD_MENUS:   'canHaveFoodMenus',
  LODGING:      'canOperateLodgingData',
  HEALTH:       'canOperateHealthData',
});

/* ─────────────────────────────────────────────
   FELDER
───────────────────────────────────────────── */
export const FELDER = Object.freeze([
  /* ── Unternehmensinformationen ── */
  {
    pfad: 'title', bereich: 'stammdaten', label: 'Unternehmensname',
    /* Die API laesst title zu — WERKRUF nicht.

       Eine Umbenennung bei Google kann eine erneute Verifizierung
       ausloesen, im schlechten Fall eine Sperrung des Eintrags. Google
       prueft Namensaenderungen und hat strenge Regeln dazu. Das ueber
       ein Nebenfeld im Dashboard anzubieten, waere ein Risiko ohne
       erkennbaren Nutzen.

       Die Entscheidung stammt aus dem urspruenglichen Entwurf und wird
       von src/hooks/googleBusinessApiHelpers.test.js geprueft — dieser
       Test hat den Versuch aufgedeckt, sie beim Aufbau des Feldmodells
       zu ueberschreiben. */
    art: SCHREIBART.GESPERRT, typ: 'text',
    gesperrtGrund: 'Namensänderungen nimmt Google nur nach eigener Prüfung an — '
                 + 'ändere den Namen direkt im Google-Unternehmensprofil.',
  },
  {
    pfad: 'phoneNumbers', bereich: 'stammdaten', label: 'Telefonnummern',
    art: SCHREIBART.GANZ, typ: 'objekt',
    /* Belegt aus dem Schema PhoneNumbers: "During updates, both fields
       must be set. Clients may not update just the primary or
       additional phone numbers using the update mask." */
    ganzGrund: 'Google verlangt Haupt- und Zusatznummern immer gemeinsam.',
    unterfelder: ['primaryPhone', 'additionalPhones'],
  },
  {
    pfad: 'websiteUri', bereich: 'stammdaten', label: 'Website',
    art: SCHREIBART.UNTERPFAD, typ: 'url',
  },
  {
    pfad: 'profile.description', bereich: 'stammdaten', label: 'Unternehmensbeschreibung',
    art: SCHREIBART.UNTERPFAD, typ: 'langtext',
    hinweis: 'Profile hat nur dieses eine Unterfeld — der Punktpfad ist deshalb zulässig.',
  },
  {
    pfad: 'storefrontAddress', bereich: 'stammdaten', label: 'Adresse',
    art: SCHREIBART.GANZ, typ: 'objekt',
    ganzGrund: 'Eine Adresse ergibt nur vollständig Sinn.',
  },
  {
    pfad: 'serviceArea', bereich: 'stammdaten', label: 'Einzugsgebiet',
    art: SCHREIBART.GANZ, typ: 'objekt',
    ganzGrund: 'Typ und Gebiete hängen zusammen.',
  },
  {
    pfad: 'storeCode', bereich: 'stammdaten', label: 'Standortcode',
    art: SCHREIBART.UNTERPFAD, typ: 'text',
    hinweis: 'Nur für deine eigene Zuordnung. Kunden sehen ihn nicht.',
  },
  {
    pfad: 'openInfo', bereich: 'stammdaten', label: 'Geöffnet oder geschlossen',
    art: SCHREIBART.GANZ, typ: 'objekt',
    ganzGrund: 'Status und Eröffnungsdatum gehören zusammen.',
  },

  /* ── Nur lesbar ── */
  {
    pfad: 'name', bereich: 'stammdaten', label: 'Google-Kennung',
    art: SCHREIBART.LESEN, typ: 'text',
    lesenGrund: 'Von Google vergeben.',
  },
  {
    pfad: 'languageCode', bereich: 'stammdaten', label: 'Sprache',
    art: SCHREIBART.LESEN, typ: 'text',
    lesenGrund: 'Wird bei der Anlage festgelegt und ist danach unveränderlich.',
  },
  {
    pfad: 'metadata', bereich: 'status', label: 'Von Google gelieferte Metadaten',
    art: SCHREIBART.LESEN, typ: 'objekt',
    lesenGrund: 'Auskunft über den Zustand des Profils, nicht bearbeitbar.',
  },

  /* ── Öffnungszeiten ── */
  {
    pfad: 'regularHours', bereich: 'oeffnungszeiten', label: 'Reguläre Öffnungszeiten',
    art: SCHREIBART.GANZ, typ: 'objekt',
    ganzGrund: 'Google ersetzt die gesamte Woche auf einmal.',
  },
  {
    pfad: 'specialHours', bereich: 'oeffnungszeiten', label: 'Sonderöffnungszeiten',
    art: SCHREIBART.GANZ, typ: 'objekt',
    ganzGrund: 'Die Ausnahmeliste wird als Ganzes ersetzt.',
    hinweis: 'Setzt reguläre Öffnungszeiten voraus — ohne sie lehnt Google ab.',
    benoetigtFeld: 'regularHours',
  },
  {
    pfad: 'moreHours', bereich: 'oeffnungszeiten', label: 'Weitere Zeiten',
    /* Google unterstützt das Feld, WERKRUF noch nicht: Welche
       hoursTypeKey-Werte zulässig sind, liefert categories.batchGet mit
       view=FULL — kategorieabhängig. Ohne diese Liste lässt sich keine
       sinnvolle Eingabemaske bauen, und eine feste Liste wäre falsch.

       Kommt mit Paket C. Bis dahin wird das Feld gelesen, verglichen
       und validiert, aber nicht zur Bearbeitung angeboten. */
    art: SCHREIBART.GANZ, typ: 'liste',
    ganzGrund: 'Die Liste wird als Ganzes ersetzt.',
    kategorieabhaengig: true,
    /* Ob dieses Feld tatsaechlich bearbeitbar ist, haengt an der
       Kategorie: Liefert Google keine moreHoursTypes, gibt es nichts
       einzutragen. Das ist kein Fehler und keine Sperre — es ist eine
       Eigenschaft der Kategorie. Deshalb ein eigener Zustand.

       Die Liste kommt aus categories.batchGet?view=FULL und wird als
       metadaten.moreHoursTypes uebergeben. */
    braucht: 'moreHoursTypes',
  },

  /* ── Kategorien und Attribute ── */
  {
    pfad: 'categories', bereich: 'kategorien', label: 'Kategorien',
    art: SCHREIBART.GANZ, typ: 'objekt',
    /* Belegt aus dem Schema Categories: "Clients are prohibited from
       individually updating the primary or additional categories using
       the update mask." */
    ganzGrund: 'Google verlangt Haupt- und Zusatzkategorien immer gemeinsam.',
    unterfelder: ['primaryCategory', 'additionalCategories'],
  },
  {
    pfad: 'attributes', bereich: 'kategorien', label: 'Attribute',
    art: SCHREIBART.GANZ, typ: 'liste',
    /* NICHT über locations.patch: Google sieht dafür
       locations.updateAttributes mit eigener attributeMask vor. Ohne
       Maske ersetzt Google die gesamte Attributliste. */
    ganzGrund: 'Attribute laufen über einen eigenen Endpunkt mit eigener Maske.',
    eigenerEndpunktPfad: '/attributes/update',
    eigenerEndpunkt: 'locations.updateAttributes',
    kategorieabhaengig: true,
    hinweis: 'Welche Attribute verfügbar sind, bestimmt Google je Kategorie und Land — und ändert das ohne API-Änderung.',
  },

  /* ── Leistungen ── */
  {
    pfad: 'serviceItems', bereich: 'leistungen', label: 'Leistungen',
    art: SCHREIBART.GANZ, typ: 'liste',
    ganzGrund: 'Die Liste wird als Ganzes ersetzt.',
    voraussetzung: VORAUSSETZUNG.SERVICE_LIST,
    kategorieabhaengig: true,
  },
]);

/* ─────────────────────────────────────────────
   ABGELEITETE MENGEN

   Der Server baut seine Erlaubnislisten hieraus. So gibt es keine
   zweite Liste, die auseinanderlaufen kann.
───────────────────────────────────────────── */

/** Alle Pfade, die überhaupt geschrieben werden dürfen. */
export function schreibbarePfade() {
  /* NOCH_NICHT steht bewusst nicht in dieser Liste: Der Server soll
     ein Feld ohne Eingabemaske gar nicht erst annehmen. */
  return FELDER
    .filter((f) => f.art !== SCHREIBART.LESEN
                && f.art !== SCHREIBART.GESPERRT
                && f.art !== SCHREIBART.NOCH_NICHT)
    .map((f) => f.pfad);
}

/** Felder, die Google nur als ganzes Objekt annimmt. */
export function nurGanzeObjekte() {
  /* Auch noch nicht umgesetzte Felder gehören hierher: Sobald die
     Eingabemaske kommt, gilt die Regel unverändert. */
  return FELDER
    .filter((f) => f.art === SCHREIBART.GANZ || f.art === SCHREIBART.NOCH_NICHT)
    .map((f) => f.pfad);
}

/** Pfade, bei denen ein Unterpfad zulässig ist. */
export function unterpfadErlaubt() {
  return FELDER
    .filter((f) => f.art === SCHREIBART.UNTERPFAD && f.pfad.includes('.'))
    .map((f) => f.pfad);
}

export function feldNachPfad(pfad) {
  return FELDER.find((f) => f.pfad === pfad) ?? null;
}

export function felderImBereich(bereich) {
  return FELDER.filter((f) => f.bereich === bereich);
}

/* ─────────────────────────────────────────────
   BETRIEBSSPEZIFISCHE PRÜFUNG

   Das Modell beschreibt die API. Ob ein KONKRETER Betrieb ein Feld
   bearbeiten darf, steht nicht dort, sondern in den Google-Metadaten
   dieses Standorts.

   Verwendet wird ausschliesslich, was beim Sync mitkam — kein
   zusätzlicher Google-Aufruf.
───────────────────────────────────────────── */

/**
 * Darf dieser Standort dieses Feld bearbeiten?
 *
 * @returns {{ erlaubt: boolean, grund: string|null, code: string|null }}
 *
 * `code` ist für Tests und Protokolle gedacht, `grund` für die
 * Oberfläche.
 */
export function istBearbeitbar(pfad, location, metadaten = null) {
  const feld = feldNachPfad(pfad);

  if (!feld) {
    return { erlaubt: false, code: 'unbekannt',
             grund: 'Dieses Feld ist WERKRUF nicht bekannt.' };
  }

  if (feld.art === SCHREIBART.LESEN) {
    return { erlaubt: false, code: 'nur_lesbar',
             grund: feld.lesenGrund ?? 'Dieses Feld liefert Google nur lesend.' };
  }

  if (feld.art === SCHREIBART.NOCH_NICHT) {
    return { erlaubt: false, code: 'noch_nicht_umgesetzt',
             grund: feld.nochNichtGrund ?? 'Von Google unterstützt, in WERKRUF noch nicht bearbeitbar.' };
  }

  if (feld.art === SCHREIBART.GESPERRT) {
    return { erlaubt: false, code: 'nicht_in_werkruf',
             grund: feld.gesperrtGrund ?? 'Dieses Feld lässt sich nicht über WERKRUF ändern.' };
  }

  const metadata = location?.google_profile?.metadata ?? {};

  /* ── Voice of Merchant ──
     Ohne sie nimmt Google Änderungen zwar an, veröffentlicht sie aber
     nicht. Das Feld deshalb nicht zu sperren wäre falsch: Der Kunde
     bekäme eine Erfolgsmeldung für etwas, das nie sichtbar wird. */
  if (metadata.hasVoiceOfMerchant === false) {
    return {
      erlaubt: false, code: 'keine_voice_of_merchant',
      grund: 'Google hat die Kontrolle über dieses Profil noch nicht bestätigt. '
           + 'Änderungen würden übermittelt, aber nicht veröffentlicht.',
    };
  }

  /* ── Feldspezifische Voraussetzung ──
     Google liefert je Standort Kennzeichen wie canModifyServiceList.
     Steht dort ausdrücklich false, ist die Bearbeitung gesperrt. */
  if (feld.voraussetzung && metadata[feld.voraussetzung] === false) {
    return {
      erlaubt: false, code: 'voraussetzung_fehlt',
      grund: `Google erlaubt für diesen Betrieb keine Änderung an „${feld.label}".`,
    };
  }

  /* ── Kategorieabhängige Verfügbarkeit ──
     Liefert Google für die Hauptkategorie keine Typen, gibt es nichts
     einzutragen. Das ist etwas anderes als „gesperrt": Die API
     unterstützt das Feld, für DIESEN Betrieb gibt es aber keine
     Auswahl.

     Ohne Metadaten wird NICHT gesperrt — sonst sähe jedes Feld
     gesperrt aus, solange die Metadaten noch laden. */
  if (feld.braucht && metadaten) {
    if (metadaten.abrufErfolgreich === false) {
      return {
        erlaubt: false, code: 'metadaten_fehlen',
        grund: 'Die für deine Kategorie verfügbaren Optionen konnten gerade nicht von Google geladen werden.',
      };
    }
    const verfuegbar = metadaten[feld.braucht];
    if (Array.isArray(verfuegbar) && verfuegbar.length === 0) {
      return {
        erlaubt: false, code: 'fuer_kategorie_nicht_verfuegbar',
        grund: 'Für diese Unternehmenskategorie bietet Google keine weiteren Öffnungszeiten an.',
      };
    }
  }

  /* ── Abhängigkeit von einem anderen Feld ──
     specialHours ohne regularHours lehnt Google ab. */
  if (feld.benoetigtFeld) {
    const vorhanden = location?.google_profile?.[feld.benoetigtFeld];
    if (!vorhanden) {
      const anderes = feldNachPfad(feld.benoetigtFeld);
      return {
        erlaubt: false, code: 'abhaengigkeit_fehlt',
        grund: `Dafür müssen zuerst „${anderes?.label ?? feld.benoetigtFeld}" gesetzt sein.`,
      };
    }
  }

  return { erlaubt: true, code: null, grund: null };
}

/**
 * Alle Felder eines Bereichs mit ihrem Zustand für diesen Standort.
 * Die Oberfläche kann damit unmittelbar rendern.
 */
export function bereichFuerStandort(bereich, location, metadaten = null) {
  return felderImBereich(bereich).map((feld) => ({
    ...feld,
    ...istBearbeitbar(feld.pfad, location, metadaten),
  }));
}

/**
 * Welche Bereiche haben für diesen Standort überhaupt bearbeitbare
 * Felder? Für die Unternavigation.
 */
export function bereicheMitStatus(location, metadaten = null) {
  return BEREICHE.map((b) => {
    const felder = bereichFuerStandort(b.key, location, metadaten);
    return {
      ...b,
      felderGesamt: felder.length,
      felderBearbeitbar: felder.filter((f) => f.erlaubt).length,
      /* Bereiche ohne eigene Felder im Modell (Bewertungen, Medien)
         sind trotzdem gültig — sie haben eigene Endpunkte. */
      ausFeldmodell: felder.length > 0,
    };
  });
}

/* ─────────────────────────────────────────────
   ÄNDERUNGEN AUFBEREITEN

   Wandelt die Eingaben der Oberfläche in das Format, das die
   Edge Function erwartet — unter Beachtung der Schreibart.
───────────────────────────────────────────── */

/**
 * @param {Array<{pfad: string, wert: unknown}>} aenderungen
 * @param {object} location  für das Zusammenführen ganzer Objekte
 * @returns {{ nutzlast: object, verworfen: Array<{pfad: string, grund: string}> }}
 */
export function baueAenderungen(aenderungen, location, metadaten = null) {
  const nutzlast = {};
  const verworfen = [];

  for (const { pfad, wert } of aenderungen) {
    const pruefung = istBearbeitbar(pfad, location, metadaten);
    if (!pruefung.erlaubt) {
      verworfen.push({ pfad, grund: pruefung.grund });
      continue;
    }

    const feld = feldNachPfad(pfad);

    if (feld.art === SCHREIBART.GANZ && feld.unterfelder && wert && typeof wert === 'object') {
      /* Vorhandene Unterfelder übernehmen, damit das Speichern eines
         Unterfelds die übrigen nicht löscht. Genau daran ist der
         Editor am 29.09. gescheitert: additionalPhones verschwanden
         beim Ändern der Hauptnummer. */
      nutzlast[pfad] = { ...(location?.google_profile?.[pfad] ?? {}), ...wert };
    } else {
      nutzlast[pfad] = wert;
    }
  }

  return { nutzlast, verworfen };
}
