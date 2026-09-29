/**
 * Vergleich zweier API-Schnappschüsse und Einstufung der Unterschiede.
 *
 * Eigenes Modul, weil drei Stellen dieselbe Logik brauchen: die Edge
 * Function gbp-api-monitor, die Tests, und spaeter jede Auswertung der
 * Aenderungshistorie. Reines JavaScript ohne Importe — Deno holt es
 * relativ, Node direkt.
 *
 * Die Normalisierung liegt bewusst NICHT hier, sondern in
 * scripts/google-api-inventory.mjs. Beide Werkzeuge muessen dieselbe
 * verwenden, sonst vergleicht das Monitoring etwas anderes, als die
 * Inventur beschreibt.
 */

/* ─────────────────────────────────────────────
   EINSTUFUNG

   Drei Stufen, wie in der Spezifikation Abschnitt 3.6 gefordert. Die
   Einstufung stuetzt sich auf zwei Tatsachen, nicht auf Vermutungen:
   was sich geaendert hat, und ob WERKRUF die betroffene API aufruft.
───────────────────────────────────────────── */
export const STUFEN = Object.freeze({
  KRITISCH:       'kritisch',
  HANDLUNGSBEDARF: 'handlungsbedarf',
  INFORMATION:    'information',
});

/* Methoden und Felder, die WERKRUF produktiv verwendet. Wird der Edge
   Function als Parameter uebergeben, damit die Liste an einer Stelle
   gepflegt wird und Tests sie setzen koennen. */
export const WERKRUF_HOSTS = Object.freeze([
  'mybusinessaccountmanagement.googleapis.com',
  'mybusinessbusinessinformation.googleapis.com',
  'mybusiness.googleapis.com',
]);

/* ─────────────────────────────────────────────
   SCHEMA-VERGLEICH
───────────────────────────────────────────── */

/**
 * Vergleicht zwei normalisierte Strukturen und liefert eine Liste von
 * Unterschieden. Jeder Unterschied ist ein eigenes Objekt, damit die
 * Mail sie einzeln benennen kann.
 */
export function vergleicheSchema(alt, neu) {
  const unterschiede = [];

  const altRes = alt?.ressourcen ?? {};
  const neuRes = neu?.ressourcen ?? {};

  /* ── Methoden ── */
  for (const name of Object.keys(neuRes)) {
    if (!(name in altRes)) {
      unterschiede.push({ art: 'methode.neu', pfad: name, neu: neuRes[name].httpMethod });
      continue;
    }
    const a = altRes[name], n = neuRes[name];

    if (a.httpMethod !== n.httpMethod) {
      unterschiede.push({ art: 'methode.http_geaendert', pfad: name, alt: a.httpMethod, neu: n.httpMethod });
    }
    if (a.path !== n.path) {
      unterschiede.push({ art: 'methode.pfad_geaendert', pfad: name, alt: a.path, neu: n.path });
    }
    if (!a.deprecated && n.deprecated) {
      unterschiede.push({ art: 'methode.veraltet', pfad: name });
    }

    /* Pflichtparameter: neu hinzugekommene brechen bestehende Aufrufe. */
    const altP = a.parameters ?? {}, neuP = n.parameters ?? {};
    for (const [pName, p] of Object.entries(neuP)) {
      if (!(pName in altP)) {
        unterschiede.push({
          art: p.required ? 'parameter.neu_pflicht' : 'parameter.neu',
          pfad: `${name}.${pName}`, neu: p.type,
        });
      } else {
        if (!altP[pName].required && p.required) {
          unterschiede.push({ art: 'parameter.jetzt_pflicht', pfad: `${name}.${pName}` });
        }
        if (altP[pName].type !== p.type) {
          unterschiede.push({ art: 'parameter.typ_geaendert', pfad: `${name}.${pName}`, alt: altP[pName].type, neu: p.type });
        }
        const altE = altP[pName].enum ?? [], neuE = p.enum ?? [];
        const weg = altE.filter((v) => !neuE.includes(v));
        const dazu = neuE.filter((v) => !altE.includes(v));
        if (weg.length) unterschiede.push({ art: 'enum.entfernt', pfad: `${name}.${pName}`, alt: weg });
        if (dazu.length) unterschiede.push({ art: 'enum.neu', pfad: `${name}.${pName}`, neu: dazu });
      }
    }
    for (const pName of Object.keys(altP)) {
      if (!(pName in neuP)) {
        unterschiede.push({ art: 'parameter.entfernt', pfad: `${name}.${pName}` });
      }
    }
  }

  for (const name of Object.keys(altRes)) {
    if (!(name in neuRes)) unterschiede.push({ art: 'methode.entfernt', pfad: name });
  }

  /* ── Schemata und Felder ── */
  const altS = alt?.schemata ?? {}, neuS = neu?.schemata ?? {};

  for (const [schema, felder] of Object.entries(neuS)) {
    if (!(schema in altS)) {
      unterschiede.push({ art: 'schema.neu', pfad: schema, neu: Object.keys(felder).length });
      continue;
    }
    const aF = altS[schema];

    for (const [feld, def] of Object.entries(felder)) {
      if (!(feld in aF)) {
        unterschiede.push({ art: 'feld.neu', pfad: `${schema}.${feld}`, neu: def.type ?? def.ref });
        continue;
      }
      const a = aF[feld];
      if (a.type !== def.type || a.ref !== def.ref) {
        unterschiede.push({
          art: 'feld.typ_geaendert', pfad: `${schema}.${feld}`,
          alt: a.ref ?? a.type, neu: def.ref ?? def.type,
        });
      }
      if (a.readOnly !== def.readOnly) {
        unterschiede.push({
          art: def.readOnly ? 'feld.jetzt_nur_lesbar' : 'feld.jetzt_schreibbar',
          pfad: `${schema}.${feld}`,
        });
      }
      if (!a.deprecated && def.deprecated) {
        unterschiede.push({ art: 'feld.veraltet', pfad: `${schema}.${feld}` });
      }
      const altE = a.enum ?? [], neuE = def.enum ?? [];
      const weg = altE.filter((v) => !neuE.includes(v));
      const dazu = neuE.filter((v) => !altE.includes(v));
      if (weg.length) unterschiede.push({ art: 'enum.entfernt', pfad: `${schema}.${feld}`, alt: weg });
      if (dazu.length) unterschiede.push({ art: 'enum.neu', pfad: `${schema}.${feld}`, neu: dazu });
    }

    for (const feld of Object.keys(aF)) {
      if (!(feld in felder)) unterschiede.push({ art: 'feld.entfernt', pfad: `${schema}.${feld}` });
    }
  }

  for (const schema of Object.keys(altS)) {
    if (!(schema in neuS)) unterschiede.push({ art: 'schema.entfernt', pfad: schema });
  }

  return unterschiede;
}

/* ─────────────────────────────────────────────
   EINSTUFUNG DER UNTERSCHIEDE
───────────────────────────────────────────── */

/** Aenderungen, die bestehenden Code brechen koennen. */
const BRECHEND = new Set([
  'methode.entfernt', 'methode.http_geaendert', 'methode.pfad_geaendert',
  'parameter.entfernt', 'parameter.neu_pflicht', 'parameter.jetzt_pflicht',
  'parameter.typ_geaendert', 'feld.entfernt', 'feld.typ_geaendert',
  'feld.jetzt_nur_lesbar', 'enum.entfernt', 'schema.entfernt',
]);

/** Angekuendigte Abschaltungen. */
const ABKUENDIGUNG = new Set(['methode.veraltet', 'feld.veraltet']);

/**
 * Stuft einen einzelnen Unterschied ein.
 *
 * Die Begruendung wird mitgeliefert und stuetzt sich auf zwei
 * Tatsachen: die Art der Aenderung und ob WERKRUF diese API aufruft.
 * Keine Behauptung darueber hinaus.
 */
export function stufeEin(unterschied, { apiGenutzt }) {
  const brechend = BRECHEND.has(unterschied.art);
  const abkuendigung = ABKUENDIGUNG.has(unterschied.art);

  if ((brechend || abkuendigung) && apiGenutzt) {
    return {
      stufe: STUFEN.KRITISCH,
      begruendung: brechend
        ? 'Bestehende Aufrufe können brechen, und WERKRUF ruft diese API produktiv auf.'
        : 'Angekündigte Abschaltung in einer API, die WERKRUF produktiv aufruft.',
    };
  }

  if (brechend || abkuendigung) {
    return {
      stufe: STUFEN.HANDLUNGSBEDARF,
      begruendung: 'Brechende Änderung oder Abkündigung — WERKRUF ruft diese API derzeit nicht auf.',
    };
  }

  if (apiGenutzt) {
    return {
      stufe: STUFEN.HANDLUNGSBEDARF,
      begruendung: 'Neues oder verändertes Element in einer produktiv genutzten API — prüfen, ob WERKRUF es unterstützen sollte.',
    };
  }

  return {
    stufe: STUFEN.INFORMATION,
    begruendung: 'Neuerung in einer API, die WERKRUF nicht aufruft.',
  };
}

/** Höchste Stufe einer Liste. */
export function hoechsteStufe(eingestufte) {
  if (eingestufte.some((e) => e.stufe === STUFEN.KRITISCH)) return STUFEN.KRITISCH;
  if (eingestufte.some((e) => e.stufe === STUFEN.HANDLUNGSBEDARF)) return STUFEN.HANDLUNGSBEDARF;
  return STUFEN.INFORMATION;
}

/* ─────────────────────────────────────────────
   CHANGE LOG

   Zweiter, getrennter Pruefweg. Notwendig, weil Google My Business v4
   nur eine statische Discovery-Datei mit revision "0" hat: Deren
   Pruefsumme erkennt Aenderungen an der Datei, nicht an der API.
───────────────────────────────────────────── */

/**
 * Loest aus einer Change-Log-Seite die datierten Eintraege heraus.
 *
 * Arbeitet auf dem TEXT, nicht auf dem HTML-Baum: Google aendert Layout,
 * Klassennamen und Navigation regelmaessig, und jede solche Aenderung
 * waere sonst ein Fehlalarm. Ausgewertet wird ausschliesslich der
 * Bereich zwischen der ersten Ueberschrift und der Fusszeile.
 *
 * Jeder Eintrag bekommt eine eigene Signatur ueber seinen
 * normalisierten Inhalt — so werden auch NACHTRAEGLICH veraenderte
 * Eintraege erkannt, nicht nur neue.
 */
/**
 * Wandelt die Change-Log-Seite in Text um.
 *
 * Liegt hier und nicht in der Edge Function, damit die Tests denselben
 * Weg gehen wie der Produktivpfad. Vorher wandelte die Function um und
 * der Test fuetterte den Zerleger mit von Hand geschriebenem Markdown —
 * dadurch prueften sie Verschiedenes, und ein Muster, das Rauten
 * verlangte, fiel nicht auf.
 */
export function htmlZuText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    /* Ueberschriften und Bloecke werden zu eigenen Zeilen — daran
       erkennt der Zerleger die Gliederung. */
    .replace(/<\/(h[1-6]|p|li|tr|div|section|dt|dd)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

export function zerlegeChangeLog(text) {
  const bereinigt = String(text ?? '')
    /* Fusszeile und Rechtehinweis abschneiden — sie tragen ein Datum
       ("Last updated"), das sich bei jedem Seitenaufbau aendern kann. */
    .split(/Except as otherwise noted|Sofern nicht anders/)[0]
    .replace(/Stay organized with collections[^\n]*/g, '')
    .replace(/Save and categorize content[^\n]*/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ');

  /* ── Ankerpunkte ──

     Der Change Log ist NICHT nach Datum gegliedert, sondern nach
     Versionen: "v4.9", "v4.8", "v3.3". Nur innerhalb davon stehen
     einzelne Datumsangaben, und nur bei den neuesten.

     Ein erster Entwurf suchte ausschliesslich nach Datumszeilen und
     fand deshalb sechs von ueber zwanzig Abschnitten — alles aeltere,
     samt der "Behavioral Changes" mit Abkuendigungen, blieb
     unsichtbar. Beim zweiten Lauf fand er gar nichts mehr, weil das
     Muster das Datum ALLEIN auf einer Zeile verlangte.

     Deshalb jetzt zwei Ankerarten, und keine Zeilenbindung: */
  const anker = [];

  /* Versionsueberschriften — die stabile Gliederung der Seite. */
  /* Rauten OPTIONAL: Aus HTML umgewandelter Text hat keine. Ein
     frueherer Entwurf verlangte sie und fand deshalb auf der echten
     Seite keine einzige Versionsueberschrift — nur im
     Markdown-Testbeispiel.

     Dafuer muss die Version allein auf ihrer Zeile stehen, sonst
     traefe jedes "v4" mitten im Fliesstext. */
  for (const m of bereinigt.matchAll(/(?:^|\n)[ \t]*#{0,4}[ \t]*(v\d+(?:\.\d+)?)[ \t]*(?=\n|$)/gi)) {
    anker.push({ pos: m.index + m[0].length, schluessel: m[1].trim() });
  }

  /* Untergliederung innerhalb einer Version: "New Features",
     "Behavioral Changes", "Backward-incompatible changes". Gerade die
     mittlere traegt die Abkuendigungen — ohne eigenen Anker landete
     sie im vorhergehenden Abschnitt und waere bei einer Aenderung
     schwerer zuzuordnen. */
  for (const m of bereinigt.matchAll(
    /(?:^|\n)[ \t]*#{0,4}[ \t]*((?:New Features?|New features?|Behaviou?ral? Changes?|Backward-incompatible changes?|Deprecated[^\n]{0,40}))[ \t]*(?=\n|$)/gi)) {
    anker.push({ pos: m.index + m[0].length, schluessel: m[1].trim() });
  }

  /* Datumsangaben — an beliebiger Stelle, nicht nur allein auf einer
     Zeile. Google setzt sie fett, und je nach Auszeichnung landen sie
     mit oder ohne Nachbartext in derselben Zeile. */
  const datumMuster = /(\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4})/g;
  for (const m of bereinigt.matchAll(datumMuster)) {
    anker.push({ pos: m.index + m[0].length, schluessel: m[1].trim() });
  }

  if (anker.length === 0) return [];

  /* Nach Position sortieren und Abschnitte bilden. */
  anker.sort((a, b) => a.pos - b.pos);

  const eintraege = [];
  const gesehen = new Set();

  for (let i = 0; i < anker.length; i++) {
    const bis = i + 1 < anker.length ? anker[i + 1].pos : bereinigt.length;
    const inhalt = bereinigt.slice(anker[i].pos, bis)
      .split('\n').map((z) => z.trim()).filter(Boolean).join('\n')
      .slice(0, 4000);

    /* Derselbe Schluessel kann mehrfach vorkommen (etwa "v4" als Teil
       einer Aufzaehlung). Der erste Treffer gewinnt; spaetere werden
       durchnummeriert, damit nichts verlorengeht. */
    let schluessel = anker[i].schluessel;
    if (gesehen.has(schluessel)) {
      let n = 2;
      while (gesehen.has(`${schluessel} (${n})`)) n++;
      schluessel = `${schluessel} (${n})`;
    }
    gesehen.add(schluessel);

    if (inhalt) eintraege.push({ datum: schluessel, inhalt });
  }

  return eintraege;
}

/**
 * Vergleicht zwei Change-Log-Staende.
 *
 * Erkennt beides, wie gefordert: neue Eintraege UND nachtraeglich
 * veraenderte. Der Vergleich laeuft ueber den normalisierten Inhalt je
 * Datum, nicht nur ueber die Ueberschriften.
 */
export function vergleicheChangeLog(alteEintraege, neueEintraege) {
  const unterschiede = [];
  const altNachDatum = new Map((alteEintraege ?? []).map((e) => [e.datum, e.inhalt]));
  const neuNachDatum = new Map((neueEintraege ?? []).map((e) => [e.datum, e.inhalt]));

  for (const [datum, inhalt] of neuNachDatum) {
    if (!altNachDatum.has(datum)) {
      unterschiede.push({ art: 'changelog.neuer_eintrag', pfad: datum, neu: inhalt.slice(0, 600) });
    } else if (altNachDatum.get(datum) !== inhalt) {
      unterschiede.push({
        art: 'changelog.eintrag_geaendert', pfad: datum,
        alt: altNachDatum.get(datum).slice(0, 300),
        neu: inhalt.slice(0, 300),
      });
    }
  }

  for (const datum of altNachDatum.keys()) {
    if (!neuNachDatum.has(datum)) {
      unterschiede.push({ art: 'changelog.eintrag_entfernt', pfad: datum });
    }
  }

  return unterschiede;
}

/** Wörter, die im Change Log auf eine brechende Änderung hindeuten. */
const ALARMWOERTER = [
  'sunset', 'deprecat', 'will be removed', 'no longer', 'breaking',
  'discontinu', 'shut down', 'shutdown', 'end of life', 'turned down',
];

/**
 * Stuft einen Change-Log-Unterschied ein.
 *
 * Bewusst zurueckhaltend: Ein Change-Log-Eintrag ist Text, kein
 * Schema-Diff. Ohne Alarmwort bleibt es bei "Handlungsbedarf" —
 * "kritisch" nur, wenn der Text selbst eine Abschaltung oder
 * Entfernung ankuendigt.
 */
export function stufeChangeLogEin(unterschied) {
  const text = `${unterschied.neu ?? ''} ${unterschied.alt ?? ''}`.toLowerCase();
  const treffer = ALARMWOERTER.filter((w) => text.includes(w));

  if (treffer.length > 0) {
    return {
      stufe: STUFEN.KRITISCH,
      begruendung: `Der Eintrag nennt: ${treffer.join(', ')}. Das deutet auf eine Abschaltung oder Entfernung hin.`,
    };
  }

  if (unterschied.art === 'changelog.eintrag_geaendert') {
    return {
      stufe: STUFEN.HANDLUNGSBEDARF,
      begruendung: 'Ein bereits veröffentlichter Eintrag wurde nachträglich geändert — Google korrigiert oder ergänzt etwas.',
    };
  }

  return {
    stufe: STUFEN.HANDLUNGSBEDARF,
    begruendung: 'Neuer Change-Log-Eintrag. Ohne Schema-Diff lässt sich die Auswirkung auf WERKRUF nicht automatisch bestimmen.',
  };
}

/* ─────────────────────────────────────────────
   SIGNATUR

   Damit dieselbe Aenderung nicht bei jedem Lauf erneut gemeldet wird.
   Deckt Art und Pfad jedes Unterschieds ab, nicht den Zeitpunkt.
───────────────────────────────────────────── */
export async function signatur(quelle, unterschiede) {
  const kern = unterschiede
    .map((u) => `${u.art}|${u.pfad}`)
    .sort()
    .join('\n');
  const daten = new TextEncoder().encode(`${quelle}\n${kern}`);
  const hash = await crypto.subtle.digest('SHA-256', daten);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
