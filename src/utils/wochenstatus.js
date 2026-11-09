/**
 * Wochenstatus der Montagsmail — WP6.
 *
 * Reines JavaScript ohne Importe: Deno (send-email) und Jest laden
 * dieselbe Datei. Hier faellt die eine Entscheidung, die die Vorlage
 * nicht selbst treffen darf: Ist „Alles geprueft" wahr?
 *
 * ═══════════════════════════════════════════════════════════════
 * DIE VIER ZUSTAENDE
 * ═══════════════════════════════════════════════════════════════
 *
 *   connection_problem  Die Google-Verbindung ist nicht aktiv. WERKRUF
 *                       konnte nichts pruefen — also behauptet es das
 *                       auch nicht. Vorrang vor allem anderen.
 *   data_incomplete     Verbindung da, aber der letzte Abgleich ist
 *                       aelter als 72 Stunden oder hat nie
 *                       stattgefunden. Was geprueft wurde, war alt.
 *   actions_open        Es gibt offene Aufgaben — faellige (die Mail
 *                       zeigt sie) oder nur offene (quiet: die Mail
 *                       verweist aufs Dashboard). Nie „nichts zu tun".
 *   ok_no_actions       Verbindung aktiv, Abgleich frisch, keine
 *                       offene Aufgabe: „Alles geprueft".
 *
 * ═══════════════════════════════════════════════════════════════
 * WAS „GEPRUEFT" HEISST
 * ═══════════════════════════════════════════════════════════════
 *
 * Nur, was die Engine wirklich auswertet (google-business/index.ts,
 * buildFacts + Regeln, taeglich 04:30 und nach jedem Bewertungs-
 * abgleich):
 *
 *   review.*        neue, unbeantwortete, negative Bewertungen,
 *                   Antwortquote, lange keine Bewertung
 *   reply.*         wartende Entwuerfe, gescheiterte Veroeffentlichung
 *   profile.*       Pflichtangaben Telefon, Website, Adresse,
 *                   Kategorie; Oeffnungszeiten; Fotos
 *   connection.*    Verbindung vorhanden / verloren
 *   sync.failing    Abgleich scheitert
 *   health.declined Profilwert gesunken
 *
 * Nicht geprueft werden (und deshalb hier nicht behauptet): Beitraege,
 * Fragen & Antworten, Google-eigene Aenderungen am Profil (WP8),
 * Mitbewerber (WP11).
 */

export const SYNC_ALT_AB_STUNDEN = 72;

/** Die Liste, die in der Mail unter „Alles geprueft" steht. */
export const GEPRUEFT = Object.freeze([
  'Bewertungen und Antwortentwürfe',
  'Pflichtangaben: Telefon, Website, Adresse, Kategorie',
  'Öffentlich sichtbare Angaben gegen deine hinterlegten (Profil-Wächter)',
  'Öffnungszeiten',
  'Fotos',
  'Google-Verbindung und Datenabgleich',
]);

/**
 * @param {object} eingabe
 * @param {object} [eingabe.check]   weekly_check_facts(): connectionStatus,
 *                                   lastSyncedAt, syncAgeHours, openCount, dueCount
 * @param {Array}  [eingabe.actions] die Aufgaben der Mail (max. 3)
 * @param {string} [eingabe.weeklyState] all_clear | quiet_week | action_due
 * @returns {{ state: string, quiet: boolean, grund: string }}
 */
export function leiteWochenstatusAb({ check, actions, weeklyState } = {}) {
  const c = check && typeof check === 'object' ? check : {};
  const status = typeof c.connectionStatus === 'string' ? c.connectionStatus : 'none';
  const anzahlAufgaben = Array.isArray(actions) ? actions.length : 0;
  const open = Number.isFinite(Number(c.openCount)) ? Number(c.openCount) : 0;
  const due  = Number.isFinite(Number(c.dueCount))  ? Number(c.dueCount)  : 0;

  if (status !== 'active') {
    return { state: 'connection_problem', quiet: false, grund: `Verbindung ${status}` };
  }

  const alter = c.syncAgeHours === null || c.syncAgeHours === undefined
    ? null : Number(c.syncAgeHours);
  if (alter === null || !Number.isFinite(alter) || alter > SYNC_ALT_AB_STUNDEN) {
    return {
      state: 'data_incomplete', quiet: false,
      grund: alter === null ? 'noch kein Abgleich' : `letzter Abgleich vor ${Math.round(alter)} h`,
    };
  }

  if (anzahlAufgaben > 0 || due > 0) {
    return { state: 'actions_open', quiet: false, grund: `${Math.max(anzahlAufgaben, due)} fällig` };
  }
  if (open > 0 || weeklyState === 'quiet_week') {
    return { state: 'actions_open', quiet: true, grund: `${open} offen, nichts fällig` };
  }
  return { state: 'ok_no_actions', quiet: false, grund: 'keine offene Aufgabe' };
}

/* ─────────────────────────────────────────────
   WAS PASSIERT IST
───────────────────────────────────────────── */

const plural = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;

/**
 * Aus weekly_happened() die Zeilen fuer „Diese Woche passiert".
 * Nur, was wirklich war — null, wenn nichts. Keine Nullen.
 */
export function wasPassiertIst(happened) {
  const h = happened && typeof happened === 'object' ? happened : {};
  const zahl = (k) => (Number.isFinite(Number(h[k])) ? Number(h[k]) : 0);
  const zeilen = [];

  const neu = zahl('reviewsNew');
  const negativ = zahl('negativeNew');
  if (neu > 0) {
    zeilen.push(plural(neu, 'neue Bewertung', 'neue Bewertungen')
      + (negativ > 0 ? ` — davon ${plural(negativ, 'eine mit höchstens 2 Sternen', 'mit höchstens 2 Sternen')}` : ''));
  }
  const antworten = zahl('repliesPublished');
  if (antworten > 0) zeilen.push(plural(antworten, 'Antwort veröffentlicht', 'Antworten veröffentlicht'));
  const erledigt = zahl('tasksCompleted');
  if (erledigt > 0) zeilen.push(plural(erledigt, 'Aufgabe erledigt', 'Aufgaben erledigt'));

  /* WP8 — Profilaenderungen (der Waechter). Eine Zeile je Diff, in
     ehrlicher Formulierung: aufgeloest → "wieder wie hinterlegt";
     pending → "wird geprueft"; sonst "Google zeigt eine andere …".
     Kritische offene stehen ohnehin in der Sofortmeldung — hier
     trotzdem, damit die Wochenmail vollstaendig ist. */
  const aenderungen = Array.isArray(h.profileChanges) ? h.profileChanges : [];
  for (const a of aenderungen.slice(0, 4)) {
    const label = a?.label || a?.fieldPath || 'Profilangabe';
    if (a?.resolvedAt) zeilen.push(`${label}: öffentlich wieder wie hinterlegt`);
    else if (a?.changeType === 'pending') zeilen.push(`${label}: deine Änderung wird von Google noch geprüft`);
    else if (a?.changeType === 'rejected') zeilen.push(`${label}: Google hat deine Änderung nicht übernommen`);
    else if (a?.changeType === 'closed_by_google') zeilen.push('Google zeigt deinen Betrieb aktuell als geschlossen');
    else if (a?.origin === 'updated_by_google') zeilen.push(`Google hat deine ${label} aktualisiert`);
    else zeilen.push(`Google zeigt eine andere ${label}`);
  }

  return zeilen.length > 0 ? zeilen : null;
}

/* ─────────────────────────────────────────────
   DARSTELLUNG
───────────────────────────────────────────── */

function esc(wert) {
  return String(wert ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const KOPF = (text) =>
  `<div class="wr-muted" style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#6B7280;margin:0 0 2px;">${text}</div>`;

/** „Diese Woche passiert" — '' wenn nichts war. */
export function passiertHtml(zeilen) {
  if (!Array.isArray(zeilen) || zeilen.length === 0) return '';
  return KOPF('DIESE WOCHE PASSIERT') +
    `<ul data-block="passiert" style="margin:0 0 18px;padding:0 0 0 18px;font-size:13px;line-height:1.6;color:#333A45;">` +
    zeilen.map((z) => `<li>${esc(z)}</li>`).join('') +
    `</ul>`;
}

/**
 * Der Statusblock anstelle einer leeren Aufgabenliste.
 *
 *   ok_no_actions       gruen: „Alles geprueft" + die Liste GEPRUEFT
 *   actions_open/quiet  neutral: nichts Neues, Offenes im Dashboard
 *   data_incomplete     bernstein: Abgleich alt — keine
 *                       Vollstaendigkeitsbehauptung
 *   connection_problem  bernstein: Verbindung erneuern
 *
 * Bei actions_open ohne quiet gibt es keinen Block — die Aufgaben
 * sind der Block.
 */
export function wochenstatusHtml(ergebnis) {
  const e = ergebnis && typeof ergebnis === 'object' ? ergebnis : { state: 'data_incomplete' };
  const box = (farben, titel, text, extra = '') => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;" data-block="wochenstatus" data-state="${esc(e.state)}${e.quiet ? '-quiet' : ''}">
<tr><td class="wr-tile" style="background:${farben.bg};border-left:3px solid ${farben.bar};padding:13px 15px;">
  <div style="font-size:13.5px;font-weight:bold;color:${farben.fg};margin-bottom:3px;">${titel}</div>
  <div style="font-size:13px;line-height:1.55;color:${farben.fg};">${text}</div>${extra}
</td></tr></table>`;

  const gruen     = { bg: '#E8F5E9', bar: '#1E7E34', fg: '#1B5E20' };
  const neutral   = { bg: '#F6F7F9', bar: '#8A9199', fg: '#333A45' };
  const bernstein = { bg: '#FAEEDA', bar: '#BA7517', fg: '#633806' };

  switch (e.state) {
    case 'ok_no_actions':
      return box(gruen, 'Alles geprüft ✓',
        'Diese Woche ist nichts Dringendes offen.',
        `<div style="font-size:12px;line-height:1.5;color:#2E5A31;margin-top:6px;">Geprüft: ${GEPRUEFT.map(esc).join(' · ')}.</div>`);
    case 'actions_open':
      if (!e.quiet) return '';
      return box(neutral, 'Nichts Neues diese Woche',
        'Deine offenen Aufgaben bleiben im Dashboard sichtbar — keine davon ist gerade fällig.');
    case 'connection_problem':
      return box(bernstein, 'Google-Verbindung erneuern',
        'WERKRUF konnte dein Profil diese Woche nicht prüfen, weil die Verbindung zu Google nicht aktiv ist. Im Dashboard unter „Dein Google-Profil" mit einem Klick neu verbinden — danach läuft alles weiter.');
    case 'data_incomplete':
    default:
      return box(bernstein, 'Daten nicht aktuell',
        'Der letzte Abgleich mit Google liegt länger zurück. Die Angaben in dieser Mail können veraltet sein — WERKRUF versucht es weiter und meldet sich, wenn etwas dauerhaft hakt.');
  }
}
