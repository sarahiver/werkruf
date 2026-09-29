/**
 * Reine Schema-Logik für die Google-Business-Profile-APIs.
 *
 * KEINE Node-Importe, kein Dateisystem, kein process — damit ist das
 * Modul in Deno, im Supabase-Edge-Runtime, in Jest und in Node
 * gleichermassen ladbar.
 *
 * Grund für die Trennung: Die Edge Function gbp-api-monitor importiert
 * diese Datei. Vorher lag sie in scripts/google-api-inventory.mjs, die
 * `fs`, `path` und `url` als blanke Spezifizierer importiert. Deno 2
 * löst die über seine Node-Kompatibilität zwar auf, aber eine
 * Produktions-Function sollte kein CLI-Werkzeug mit Dateisystemzugriff
 * hereinziehen — und im Supabase-Edge-Runtime ist die Auflösung nicht
 * zugesichert.
 *
 * scripts/google-api-inventory.mjs importiert jetzt von hier. Beide
 * Werkzeuge verwenden damit nachweislich dieselbe Normalisierung; eine
 * zweite Implementierung gibt es nicht.
 */

/* ─────────────────────────────────────────────
   QUELLEN

   Alle als maschinenlesbares Discovery-Dokument. Stand 29.09.2026
   geprueft: businessinformation und accountmanagement liefern
   HTTP 200 mit revision 20260927.

   mybusinessqanda fehlt bewusst — die Q&A-API wurde am 03.11.2025
   eingestellt. Sollte Google einen Nachfolger veroeffentlichen, faellt
   das dem Monitoring ueber den Verzeichnisabgleich auf.
───────────────────────────────────────────── */
export const QUELLEN = [
  { id: 'businessinformation',
    titel: 'My Business Business Information API',
    url: 'https://mybusinessbusinessinformation.googleapis.com/$discovery/rest?version=v1',
    doku: 'https://developers.google.com/my-business/reference/businessinformation/rest',
    inWerkruf: true },

  { id: 'accountmanagement',
    titel: 'My Business Account Management API',
    url: 'https://mybusinessaccountmanagement.googleapis.com/$discovery/rest?version=v1',
    doku: 'https://developers.google.com/my-business/reference/accountmanagement/rest',
    inWerkruf: true },

  { id: 'mybusiness-v4',
    titel: 'Google My Business API v4 (Bewertungen, Medien, Beitraege)',
    /* Der reguläre Discovery-Endpunkt
       https://mybusiness.googleapis.com/$discovery/rest?version=v4
       antwortet seit Jahren mit 404 — die Dokumentationsseite nennt ihn
       trotzdem. Google veroeffentlicht stattdessen eine statische
       Beispieldatei.

       ACHTUNG: Sie traegt revision "0", liefert also KEIN
       Aenderungssignal, und ist aelter als die Referenzdokumentation —
       es fehlen unter anderem Felder auf accounts.locations.reviews.
       Fuer das Monitoring taugt sie nur eingeschraenkt; dort muss der
       Change Log ergaenzend geprueft werden. */
    url: 'https://developers.google.com/static/my-business/samples/mybusiness_google_rest_v4p9.json',
    ersatzFuer: 'https://mybusiness.googleapis.com/$discovery/rest?version=v4',
    hinweis: 'statische Beispieldatei, revision 0, aelter als die Referenz',
    doku: 'https://developers.google.com/my-business/reference/rest',
    inWerkruf: true },

  { id: 'placeactions',
    titel: 'My Business Place Actions API',
    url: 'https://mybusinessplaceactions.googleapis.com/$discovery/rest?version=v1',
    doku: 'https://developers.google.com/my-business/reference/placeactions/rest',
    inWerkruf: false },

  { id: 'notifications',
    titel: 'My Business Notifications API',
    url: 'https://mybusinessnotifications.googleapis.com/$discovery/rest?version=v1',
    doku: 'https://developers.google.com/my-business/reference/notifications/rest',
    inWerkruf: false },

  { id: 'performance',
    titel: 'Business Profile Performance API',
    url: 'https://businessprofileperformance.googleapis.com/$discovery/rest?version=v1',
    doku: 'https://developers.google.com/my-business/reference/performance/rest',
    inWerkruf: false },

  { id: 'verifications',
    titel: 'My Business Verifications API',
    url: 'https://mybusinessverifications.googleapis.com/$discovery/rest?version=v1',
    doku: 'https://developers.google.com/my-business/reference/verifications/rest',
    inWerkruf: false },

  { id: 'lodging',
    titel: 'My Business Lodging API',
    url: 'https://mybusinesslodging.googleapis.com/$discovery/rest?version=v1',
    doku: 'https://developers.google.com/my-business/reference/lodging/rest',
    inWerkruf: false },
];

/* ─────────────────────────────────────────────
   NORMALISIERUNG

   Stabil gegen alles, was sich ohne API-Aenderung aendert:
   Beschreibungstexte, Reihenfolge von Objektschluesseln,
   Dokumentationslinks, Symbole. Was bleibt, ist die Struktur —
   Ressourcen, Methoden, HTTP-Verben, Pfade, Parameter, Schemata,
   Typen, Enum-Werte, readOnly- und deprecated-Kennzeichen.

   Beschreibungen werden bewusst NICHT aufgenommen: Google formuliert
   sie regelmaessig um, und jede Umformulierung waere sonst ein
   Fehlalarm.
───────────────────────────────────────────── */
export function normalisiere(discovery) {
  const ressourcen = {};

  const sammleRessourcen = (knoten, praefix = '') => {
    for (const [name, res] of Object.entries(knoten ?? {})) {
      const pfad = praefix ? `${praefix}.${name}` : name;

      for (const [methode, def] of Object.entries(res.methods ?? {})) {
        ressourcen[`${pfad}.${methode}`] = {
          httpMethod: def.httpMethod,
          path: def.path,
          request: def.request?.$ref ?? null,
          response: def.response?.$ref ?? null,
          scopes: (def.scopes ?? []).slice().sort(),
          deprecated: Boolean(def.deprecated),
          parameters: Object.fromEntries(
            Object.entries(def.parameters ?? {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([pName, p]) => [pName, {
                type: p.type ?? null,
                format: p.format ?? null,
                location: p.location ?? null,
                required: Boolean(p.required),
                repeated: Boolean(p.repeated),
                enum: p.enum ? p.enum.slice().sort() : null,
              }]),
          ),
        };
      }

      if (res.resources) sammleRessourcen(res.resources, pfad);
    }
  };
  sammleRessourcen(discovery.resources);

  const schemata = {};
  for (const [name, schema] of Object.entries(discovery.schemas ?? {})) {
    schemata[name] = Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([feld, def]) => [feld, {
          type: def.type ?? null,
          format: def.format ?? null,
          ref: def.$ref ?? def.items?.$ref ?? null,
          array: def.type === 'array',
          readOnly: Boolean(def.readOnly),
          deprecated: Boolean(def.deprecated),
          enum: def.enum ? def.enum.slice().sort() : null,
        }]),
    );
  }

  return {
    id: discovery.id ?? null,
    name: discovery.name ?? null,
    version: discovery.version ?? null,
    /* Googles eigene Revisionsnummer. Aendert sie sich nicht, hat sich
       am Dokument nichts geaendert — ein billiger Vorabfilter. */
    revision: discovery.revision ?? null,
    ressourcen: Object.fromEntries(Object.entries(ressourcen).sort(([a], [b]) => a.localeCompare(b))),
    schemata: Object.fromEntries(Object.entries(schemata).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Stabile Pruefsumme ueber die normalisierte Struktur. */
export async function pruefsumme(normalisiert) {
  const text = JSON.stringify(normalisiert);
  const daten = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', daten);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ─────────────────────────────────────────────
   ABRUF
───────────────────────────────────────────── */
export async function hole(quelle, { timeoutMs = 20000 } = {}) {
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), timeoutMs);
  try {
    const antwort = await fetch(quelle.url, {
      signal: abbruch.signal,
      headers: { Accept: 'application/json' },
    });
    if (!antwort.ok) {
      return { ok: false, status: antwort.status, fehler: `HTTP ${antwort.status}` };
    }
    const roh = await antwort.json();
    return { ok: true, status: antwort.status, discovery: roh };
  } catch (err) {
    return { ok: false, status: null, fehler: String(err?.message ?? err) };
  } finally {
    clearTimeout(wecker);
  }
}

/* ─────────────────────────────────────────────
   ABGLEICH MIT WERKRUF

   Sucht im Quelltext nach den Pfaden, die die jeweilige Methode
   verwendet. Grob, aber ausreichend fuer die Frage "beruehren wir das
   ueberhaupt?" — und ehrlicher als eine gepflegte Liste, die
   auseinanderlaeuft.
───────────────────────────────────────────── */
/* ladeCode() und CODE_DATEIEN liegen bewusst NICHT hier, sondern in
   google-api-inventory.mjs: Sie lesen Dateien und brauchen node:fs.
   Dieses Modul bleibt frei von Node-Importen, damit es im
   Supabase-Edge-Runtime ladbar ist. verwendetInWerkruf() bekommt den
   Quelltext deshalb als Parameter. */

const NICHTSSAGEND = new Set([
  'accounts', 'locations', 'get', 'list', 'create', 'patch', 'delete',
  'update', 'search', 'batchGet', 'media', 'admins', 'attributes',
  'categories', 'reviews', 'name', 'parent', 'v1', 'v4', 'v2',
]);

/**
 * Verwendet WERKRUF diese Methode?
 *
 * Zwei Stufen, beide muessen zutreffen:
 *
 *   1. Der Dienst-Hostname der API kommt im Code ueberhaupt vor.
 *      Ruft WERKRUF eine API nie auf, kann keine ihrer Methoden
 *      verwendet sein — egal wie die Pfadteile heissen.
 *   2. Ein MARKANTER Bezeichner der Methode kommt im Code vor.
 *      Markant heisst: nicht in NICHTSSAGEND und laenger als fuenf
 *      Zeichen.
 *
 * Bleibt eine Schaetzung, aber eine, die nicht mehr systematisch zu
 * hoch liegt. Der Wert heisst deshalb "vermutlich" — belegen laesst
 * sich die Nutzung nur durch Lesen des Codes.
 */
export function verwendetInWerkruf(code, methodenName, def, dienstHost) {
  if (dienstHost && !code.includes(dienstHost)) return false;

  const letzterTeil = methodenName.split('.').pop();
  const pfadTeile = (def.path ?? '')
    .split(/[/:]/)
    .filter((t) => t && !t.startsWith('{'));

  const markant = [...pfadTeile, letzterTeil]
    .filter((k) => k && k.length > 5 && !NICHTSSAGEND.has(k));

  return markant.some((k) => code.includes(k));
}

/** Dienst-Hostname aus dem Discovery-Dokument. */
export function dienstHostAus(discovery) {
  try {
    return new URL(discovery.rootUrl ?? discovery.baseUrl ?? '').host;
  } catch { return null; }
}

