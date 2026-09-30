/**
 * Öffnungszeiten nach Googles Strukturen.
 *
 * Validierung und Vergleich, gemeinsam genutzt von Oberfläche und
 * Edge Function. Reines JavaScript ohne Importe — Deno holt es relativ,
 * Jest direkt.
 *
 * Die Strukturen stammen aus dem Discovery-Dokument der Business
 * Information API (Revision 20260928):
 *
 *   BusinessHours       { periods: TimePeriod[] }
 *   TimePeriod          { openDay, openTime, closeDay, closeTime }
 *   TimeOfDay           { hours 0-23, minutes 0-59, seconds, nanos }
 *   SpecialHours        { specialHourPeriods: SpecialHourPeriod[] }
 *   SpecialHourPeriod   { startDate, openTime, endDate, closeTime, closed }
 *   MoreHours           { hoursTypeKey, periods: TimePeriod[] }
 *
 * ⚠️  Die Prüfung hier ist eine Vorabprüfung, keine Zusage. Google
 * lehnt am Ende ab, was Google ablehnt — etwa Zeiten, die zur
 * Kategorie nicht passen. Sie fängt ab, was sich ohne Netzaufruf
 * erkennen lässt, und erspart dem Kunden eine unnötige Fehlermeldung.
 */

export const TAGE = Object.freeze([
  { key: 'MONDAY',    kurz: 'Mo', lang: 'Montag' },
  { key: 'TUESDAY',   kurz: 'Di', lang: 'Dienstag' },
  { key: 'WEDNESDAY', kurz: 'Mi', lang: 'Mittwoch' },
  { key: 'THURSDAY',  kurz: 'Do', lang: 'Donnerstag' },
  { key: 'FRIDAY',    kurz: 'Fr', lang: 'Freitag' },
  { key: 'SATURDAY',  kurz: 'Sa', lang: 'Samstag' },
  { key: 'SUNDAY',    kurz: 'So', lang: 'Sonntag' },
]);

const TAG_INDEX = Object.fromEntries(TAGE.map((t, i) => [t.key, i]));

/* ─────────────────────────────────────────────
   UMWANDLUNG
───────────────────────────────────────────── */

/** TimeOfDay → "HH:MM". Fehlende Felder sind laut Schema 0. */
export function alsText(zeit) {
  if (!zeit || typeof zeit !== 'object') return '';
  const h = Number(zeit.hours ?? 0);
  const m = Number(zeit.minutes ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "HH:MM" → TimeOfDay. Gibt null zurück, wenn die Eingabe nicht passt. */
export function alsZeit(text) {
  const treffer = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!treffer) return null;
  const hours = Number(treffer[1]);
  const minutes = Number(treffer[2]);

  /* 24:00 ist gueltig. Die Referenz sagt zu openTime und closeTime:
     "Valid values are 00:00-24:00, where 24:00 represents midnight at
     the end of the specified day field."

     Eine fruehere Fassung wies es als ungueltig ab — damit liess sich
     ein Sondertag, der bis Mitternacht geht, gar nicht eintragen. */
  if (hours > 24 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;
  /* hours: 0 weglassen waere zulaessig — Google behandelt fehlende
     Felder als 0. Explizit ist es aber eindeutiger, und der Vergleich
     zweier Zeitfenster wird dadurch unempfindlicher. */
  return { hours, minutes };
}

/** Minuten seit Wochenbeginn. Grundlage für Überschneidungsprüfungen. */
function minutenSeitWochenbeginn(tag, zeit) {
  const t = TAG_INDEX[tag];
  if (t === undefined) return null;
  return t * 1440 + Number(zeit?.hours ?? 0) * 60 + Number(zeit?.minutes ?? 0);
}

/* ─────────────────────────────────────────────
   EINZELNES ZEITFENSTER
───────────────────────────────────────────── */

/**
 * Ist dieses Zeitfenster „durchgehend geöffnet"?
 *
 * Google drückt das so aus: openTime und closeTime beide 00:00 bei
 * gleichem openDay und closeDay.
 */
export function istDurchgehend(fenster) {
  return Boolean(
    fenster
    && fenster.openDay === fenster.closeDay
    && alsText(fenster.openTime) === '00:00'
    && alsText(fenster.closeTime) === '00:00',
  );
}

/**
 * Reicht das Zeitfenster über Mitternacht?
 *
 * Zwei Formen: ein anderer closeDay, oder derselbe Tag mit einer
 * closeTime, die vor der openTime liegt. Die zweite Form ist die
 * häufigere Fehlerquelle — sie sieht aus wie ein Tippfehler, ist aber
 * bei Gastronomie und Notdiensten normal.
 */
export function ueberMitternacht(fenster) {
  if (!fenster || istDurchgehend(fenster)) return false;
  if (fenster.openDay !== fenster.closeDay) return true;

  const auf = minutenSeitWochenbeginn(fenster.openDay, fenster.openTime);
  const zu  = minutenSeitWochenbeginn(fenster.closeDay, fenster.closeTime);
  return auf !== null && zu !== null && zu < auf;
}

/**
 * Das Zeitfenster als Minutenbereich seit Wochenbeginn.
 * Über Mitternacht reichende Fenster laufen über 10080 hinaus — so
 * lassen sich Überschneidungen ohne Sonderfälle vergleichen.
 */
function alsBereich(fenster) {
  const auf = minutenSeitWochenbeginn(fenster.openDay, fenster.openTime);
  let zu = minutenSeitWochenbeginn(fenster.closeDay, fenster.closeTime);
  if (auf === null || zu === null) return null;

  if (istDurchgehend(fenster)) return { von: auf, bis: auf + 1440 };
  if (zu <= auf) zu += 7 * 1440;       // über Mitternacht oder übers Wochenende
  return { von: auf, bis: zu };
}

/** Überschneiden sich zwei Zeitfenster? Auch über den Wochenwechsel. */
export function ueberschneiden(a, b) {
  const x = alsBereich(a);
  const y = alsBereich(b);
  if (!x || !y) return false;

  const woche = 7 * 1440;
  /* Die Woche ist ein Ring: Ein Fenster Sonntag 22:00 bis Montag 02:00
     muss gegen eines am Montagmorgen geprueft werden. Deshalb beide
     Bereiche zusaetzlich um eine Woche versetzt vergleichen. */
  for (const versatz of [-woche, 0, woche]) {
    if (x.von < y.bis + versatz && y.von + versatz < x.bis) return true;
  }
  return false;
}

/* ─────────────────────────────────────────────
   REGULÄRE ÖFFNUNGSZEITEN
───────────────────────────────────────────── */

/**
 * Prüft reguläre Öffnungszeiten.
 *
 * @returns {Array<{feld: string, meldung: string, index?: number}>}
 *          Leer heisst: nichts gefunden, was sich hier erkennen lässt.
 */
export function pruefeRegulaer(periods) {
  const fehler = [];
  const liste = Array.isArray(periods) ? periods : [];

  liste.forEach((f, i) => {
    if (!TAG_INDEX[f?.openDay]) {
      if (f?.openDay !== 'MONDAY') {
        fehler.push({ index: i, feld: 'openDay', meldung: 'Kein gültiger Wochentag.' });
        return;
      }
    }
    if (!TAG_INDEX[f?.closeDay] && f?.closeDay !== 'MONDAY') {
      fehler.push({ index: i, feld: 'closeDay', meldung: 'Kein gültiger Wochentag.' });
      return;
    }

    const auf = alsText(f.openTime);
    const zu  = alsText(f.closeTime);

    if (!auf || !zu) {
      fehler.push({ index: i, feld: 'zeit', meldung: 'Öffnungs- und Schließzeit müssen gesetzt sein.' });
      return;
    }

    /* Gleiche Zeit am gleichen Tag: entweder durchgehend (00:00) oder
       ein Fenster ohne Dauer. */
    if (f.openDay === f.closeDay && auf === zu && !istDurchgehend(f)) {
      fehler.push({
        index: i, feld: 'zeit',
        meldung: `${auf} bis ${zu} ergibt kein Zeitfenster. Für durchgehend geöffnet 00:00 bis 00:00 eintragen.`,
      });
    }
  });

  /* Überschneidungen. Sie sind der Grund, warum Google eine ganze
     Woche ablehnen kann, obwohl jedes Fenster für sich gültig ist. */
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      if (ueberschneiden(liste[i], liste[j])) {
        const tag = TAGE.find((t) => t.key === liste[i].openDay)?.lang ?? liste[i].openDay;
        fehler.push({
          index: j, feld: 'zeit',
          meldung: `Überschneidet sich mit einem anderen Zeitfenster (${tag} ${alsText(liste[i].openTime)}).`,
        });
      }
    }
  }

  return fehler;
}

/* ─────────────────────────────────────────────
   SONDERÖFFNUNGSZEITEN
───────────────────────────────────────────── */

const alsDatumstext = (d) => (d && d.year
  ? `${d.year}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}`
  : '');

const alsDatum = (text) => {
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!t) return null;
  const [, y, m, d] = t.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d };
};

export { alsDatumstext, alsDatum };

/** Tage zwischen zwei Datumsangaben. Beide als {year, month, day}. */
function tageDazwischen(a, b) {
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86400000);
}

/** Minuten eines Sonderzeitraums, ueber das Enddatum hinweg. */
function dauerInMinuten(p) {
  const start = p.startDate;
  const ende = p.endDate ?? p.startDate;
  if (!start || !ende) return null;
  const tage = tageDazwischen(start, ende);
  const auf = Number(p.openTime?.hours ?? 0) * 60 + Number(p.openTime?.minutes ?? 0);
  const zu  = Number(p.closeTime?.hours ?? 0) * 60 + Number(p.closeTime?.minutes ?? 0);
  return tage * 1440 + zu - auf;
}

/**
 * Prüft Sonderöffnungszeiten.
 *
 * Belegt aus der Referenz zu SpecialHourPeriod:
 *
 *   „A special hour period must represent a range of less than 24
 *   hours. The open_time and start_date must predate the close_time and
 *   end_date. The close_time and end_date can extend to 11:59 a.m. on
 *   the day after the specified start_date."
 *
 *   Gültig:   start=23.11., open=08:00, close=18:00
 *             start=23.11., end=24.11., open=13:00, close=11:59
 *   Ungültig: start=23.11., open=13:00, close=11:59  (ohne Enddatum)
 *             start=23.11., end=24.11., open=13:00, close=12:00
 *             start=23.11., end=25.11., open=08:00, close=18:00
 *
 * MEHRERE Zeitfenster am selben Tag sind ausdrücklich erlaubt — Googles
 * Hilfe beschreibt „To add multiple sets of hours for the date" und
 * nennt als Beispiel zwei getrennte Zeiträume am 26. Dezember. Eine
 * frühere Fassung dieser Prüfung lehnte doppelte Daten pauschal ab und
 * machte damit geteilte Öffnungszeiten an Feiertagen unmöglich.
 *
 * Widersprüchlich bleibt: derselbe Tag einmal geschlossen und einmal
 * mit Zeiten, oder zwei sich überschneidende Zeitfenster.
 */
export function pruefeSonderzeiten(perioden) {
  const fehler = [];
  const liste = Array.isArray(perioden) ? perioden : [];

  liste.forEach((p, i) => {
    const start = alsDatumstext(p?.startDate);
    if (!start) {
      fehler.push({ index: i, feld: 'startDate', meldung: 'Datum fehlt.' });
      return;
    }

    if (p.closed === true) {
      if (p.openTime || p.closeTime) {
        fehler.push({
          index: i, feld: 'closed',
          meldung: 'An einem geschlossenen Tag dürfen keine Uhrzeiten stehen.',
        });
      }
      return;
    }

    const auf = alsText(p.openTime);
    const zu  = alsText(p.closeTime);
    if (!auf || !zu) {
      fehler.push({
        index: i, feld: 'zeit',
        meldung: 'Öffnungs- und Schließzeit angeben — oder den Tag als geschlossen markieren.',
      });
      return;
    }

    const endeText = alsDatumstext(p.endDate) || start;
    const tage = p.endDate ? tageDazwischen(p.startDate, p.endDate) : 0;

    if (tage < 0) {
      fehler.push({ index: i, feld: 'endDate', meldung: 'Das Enddatum liegt vor dem Startdatum.' });
      return;
    }

    if (tage > 1) {
      fehler.push({
        index: i, feld: 'endDate',
        meldung: 'Ein Sondertag darf höchstens bis zum Folgetag reichen.',
      });
      return;
    }

    const dauer = dauerInMinuten(p);

    if (dauer !== null && dauer <= 0) {
      fehler.push({
        index: i, feld: 'zeit',
        meldung: endeText === start
          ? `${auf} bis ${zu} reicht über Mitternacht. Dann muss das Enddatum der Folgetag sein.`
          : `${auf} bis ${zu} ergibt kein Zeitfenster.`,
      });
      return;
    }

    if (dauer !== null && dauer >= 1440) {
      fehler.push({
        index: i, feld: 'zeit',
        meldung: 'Ein Sondertag muss kürzer als 24 Stunden sein.',
      });
      return;
    }

    /* Reicht der Zeitraum in den Folgetag, ist bei 11:59 Schluss. */
    if (tage === 1 && zu > '11:59') {
      fehler.push({
        index: i, feld: 'zeit',
        meldung: `Bis in den Folgetag erlaubt Google höchstens 11:59 — ${zu} ist zu spät.`,
      });
    }
  });

  /* ── Widersprüche zwischen Einträgen desselben Tages ── */
  const nachTag = new Map();
  liste.forEach((p, i) => {
    const key = alsDatumstext(p?.startDate);
    if (!key) return;
    if (!nachTag.has(key)) nachTag.set(key, []);
    nachTag.get(key).push({ p, i });
  });

  for (const [tagText, eintraege] of nachTag) {
    if (eintraege.length < 2) continue;

    const geschlossen = eintraege.filter((e) => e.p.closed === true);
    const offen = eintraege.filter((e) => e.p.closed !== true);

    if (geschlossen.length > 0 && offen.length > 0) {
      fehler.push({
        index: offen[0].i, feld: 'startDate',
        meldung: `Der ${tagText} ist einmal als geschlossen und einmal mit Zeiten eingetragen.`,
      });
      continue;
    }

    if (geschlossen.length > 1) {
      fehler.push({
        index: geschlossen[1].i, feld: 'startDate',
        meldung: `Der ${tagText} ist mehrfach als geschlossen eingetragen.`,
      });
      continue;
    }

    /* Mehrere Zeitfenster am selben Tag sind erlaubt — solange sie
       sich nicht überschneiden. */
    for (let a = 0; a < offen.length; a++) {
      for (let b = a + 1; b < offen.length; b++) {
        const x = offen[a].p, y = offen[b].p;
        const xAuf = alsText(x.openTime), xZu = alsText(x.closeTime);
        const yAuf = alsText(y.openTime), yZu = alsText(y.closeTime);
        if (!xAuf || !xZu || !yAuf || !yZu) continue;

        if (xAuf < yZu && yAuf < xZu) {
          fehler.push({
            index: offen[b].i, feld: 'zeit',
            meldung: `Überschneidet sich mit dem anderen Zeitfenster am ${tagText} (${xAuf}–${xZu}).`,
          });
        }
      }
    }
  }

  return fehler;
}

/* ─────────────────────────────────────────────
   WEITERE ZEITEN
───────────────────────────────────────────── */

/**
 * Prüft moreHours.
 *
 * `hoursTypeKey` ist kategorieabhängig — welche Werte zulässig sind,
 * sagt `categories.batchGet` mit `view=FULL`. Ohne diese Liste wird
 * hier nur geprüft, was strukturell erkennbar ist.
 */
export function pruefeWeitereZeiten(moreHours, erlaubteTypen = null) {
  const fehler = [];
  const liste = Array.isArray(moreHours) ? moreHours : [];

  liste.forEach((eintrag, i) => {
    if (!eintrag?.hoursTypeKey) {
      fehler.push({ index: i, feld: 'hoursTypeKey', meldung: 'Art der Zeiten fehlt.' });
      return;
    }

    if (erlaubteTypen && !erlaubteTypen.includes(eintrag.hoursTypeKey)) {
      fehler.push({
        index: i, feld: 'hoursTypeKey',
        meldung: `„${eintrag.hoursTypeKey}" ist für die gewählte Kategorie nicht vorgesehen.`,
      });
    }

    pruefeRegulaer(eintrag.periods).forEach((f) =>
      fehler.push({ ...f, index: i, feld: `periods.${f.feld}` }));
  });

  const typen = liste.map((e) => e?.hoursTypeKey).filter(Boolean);
  typen.forEach((t, i) => {
    if (typen.indexOf(t) !== i) {
      fehler.push({ index: i, feld: 'hoursTypeKey', meldung: `„${t}" ist doppelt vorhanden.` });
    }
  });

  return fehler;
}

/* ─────────────────────────────────────────────
   VERGLEICH

   Google nimmt regularHours nur als GANZES Objekt. Ein Vergleich auf
   Feldebene reicht also nicht — es muss das vollständige Objekt
   gesendet werden. Was sich vergleichen lässt, ist die Frage, OB
   gesendet werden muss.
───────────────────────────────────────────── */

/** Stabile Darstellung eines Zeitfensters für den Vergleich. */
const fensterSchluessel = (f) =>
  `${f?.openDay}|${alsText(f?.openTime)}|${f?.closeDay}|${alsText(f?.closeTime)}`;

/**
 * Haben sich die Zeitfenster geändert?
 *
 * Unempfindlich gegen Reihenfolge und gegen die Schreibweise von
 * TimeOfDay: Google liefert `{ hours: 9 }` zurück, die Oberfläche
 * erzeugt `{ hours: 9, minutes: 0 }`. Ohne Normalisierung sähe jedes
 * Laden wie eine Änderung aus.
 */
export function zeitfensterGeaendert(alt, neu) {
  const a = (Array.isArray(alt) ? alt : []).map(fensterSchluessel).sort();
  const b = (Array.isArray(neu) ? neu : []).map(fensterSchluessel).sort();
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

const sonderSchluessel = (p) =>
  `${alsDatumstext(p?.startDate)}|${alsDatumstext(p?.endDate)}|`
  + `${alsText(p?.openTime)}|${alsText(p?.closeTime)}|${p?.closed === true}`;

export function sonderzeitenGeaendert(alt, neu) {
  const a = (Array.isArray(alt) ? alt : []).map(sonderSchluessel).sort();
  const b = (Array.isArray(neu) ? neu : []).map(sonderSchluessel).sort();
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

export function weitereZeitenGeaendert(alt, neu) {
  const key = (e) => `${e?.hoursTypeKey}|`
    + (Array.isArray(e?.periods) ? e.periods.map(fensterSchluessel).sort().join(';') : '');
  const a = (Array.isArray(alt) ? alt : []).map(key).sort();
  const b = (Array.isArray(neu) ? neu : []).map(key).sort();
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

/* ─────────────────────────────────────────────
   ÄNDERUNGEN AUFBEREITEN
───────────────────────────────────────────── */

/**
 * Baut die Nutzlast für die Edge Function.
 *
 * Nur tatsächlich geänderte Blöcke landen darin. Jeder aber als
 * vollständiges Objekt — Google ersetzt regularHours, specialHours und
 * moreHours jeweils als Ganzes.
 *
 * Genau daran hängt die Anforderung, dass bestehende
 * Sonderöffnungszeiten beim Speichern der regulären Zeiten nicht
 * verlorengehen: Sie stehen in einem anderen Feld und werden gar nicht
 * erst mitgeschickt.
 */
export function baueZeitAenderungen({ vorher, regulaer, sonder, weitere }) {
  const aenderungen = {};

  if (regulaer !== undefined
      && zeitfensterGeaendert(vorher?.regularHours?.periods, regulaer)) {
    aenderungen.regularHours = { periods: regulaer };
  }

  if (sonder !== undefined
      && sonderzeitenGeaendert(vorher?.specialHours?.specialHourPeriods, sonder)) {
    aenderungen.specialHours = { specialHourPeriods: sonder };
  }

  if (weitere !== undefined
      && weitereZeitenGeaendert(vorher?.moreHours, weitere)) {
    aenderungen.moreHours = weitere;
  }

  return aenderungen;
}

/**
 * Alle Prüfungen auf einmal.
 *
 * `erlaubteTypen` ist wahlfrei: Serverseitig steht die
 * kategorieabhängige Liste nicht ohne zusätzlichen Google-Aufruf zur
 * Verfügung. Fehlt sie, entfällt nur die Prüfung auf zulässige
 * moreHours-Arten — alles Strukturelle wird trotzdem geprüft.
 *
 * Die Typangaben sind noetig, weil TypeScript aus dem Vorgabewert []
 * sonst never[] ableitet — dann passt keine echte Liste mehr hinein,
 * und die Deno-Pruefung der Edge Function schlaegt fehl.
 *
 * @param {{
 *   regulaer?: any[], sonder?: any[], weitere?: any[],
 *   erlaubteTypen?: string[] | null
 * }} [eingabe]
 */
export function pruefeAlles(eingabe = {}) {
  const {
    regulaer = [], sonder = [], weitere = [], erlaubteTypen = null,
  } = eingabe;

  return {
    regulaer: pruefeRegulaer(regulaer),
    sonder: pruefeSonderzeiten(sonder),
    weitere: pruefeWeitereZeiten(weitere, erlaubteTypen),
  };
}

export function hatFehler(befund) {
  return Object.values(befund ?? {}).some((liste) => (liste ?? []).length > 0);
}
