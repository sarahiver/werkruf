#!/usr/bin/env node
/**
 * Erzeugt die Bestandsaufnahme der Google-Business-Profile-APIs.
 *
 *   node scripts/google-api-inventory.mjs            Inventur schreiben
 *   node scripts/google-api-inventory.mjs --check    nur pruefen, nichts schreiben
 *
 * Warum ein Skript und keine handgepflegte Liste: Google veroeffentlicht
 * maschinenlesbare Discovery-Dokumente. Eine abgeschriebene Tabelle ist
 * am Tag nach dem Abschreiben veraltet und niemand merkt es. Dieses
 * Skript ist ausserdem die Grundlage fuer das API-Monitoring — beide
 * benutzen dieselbe Normalisierung, sonst vergleicht das Monitoring
 * etwas anderes als die Inventur beschreibt.
 *
 * Schreibt:
 *   docs/google-api-inventory.generated.json   maschinenlesbar, fuer Diffs
 *   docs/google-api-inventory.generated.md  lesbar, fuer Menschen
 *
 * Die kuratierte, von Hand geprueste Fassung liegt daneben in
 * docs/google-api-inventory.md und wird NICHT ueberschrieben.
 *
 * Ruft ausschliesslich oeffentliche, unauthentifizierte Endpunkte auf.
 * Keine Kundendaten, keine Schreibzugriffe, keine Anmeldedaten.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    url: 'https://mybusiness.googleapis.com/$discovery/rest?version=v4',
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
const CODE_DATEIEN = [
  'supabase/functions/google-business/index.ts',
  'supabase/functions/google-business/google-api-helpers.ts',
];

function ladeCode() {
  return CODE_DATEIEN
    .map((rel) => {
      const abs = path.join(wurzel, rel);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    })
    .join('\n');
}

/** Sucht nach dem markantesten Bestandteil des Methodenpfads. */
export function verwendetInWerkruf(code, methodenName, def) {
  const letzterTeil = methodenName.split('.').pop();
  const pfadTeile = (def.path ?? '').split('/').filter((t) => t && !t.startsWith('{') && t !== 'v1' && t !== 'v4');
  const kandidaten = [...pfadTeile, letzterTeil].filter(Boolean);
  return kandidaten.some((k) => code.includes(k));
}

/* ─────────────────────────────────────────────
   HAUPTLAUF
───────────────────────────────────────────── */
async function main() {
  const nurPruefen = process.argv.includes('--check');
  const code = ladeCode();
  const ergebnis = { erstelltAm: new Date().toISOString(), apis: [] };

  for (const quelle of QUELLEN) {
    process.stderr.write(`  ${quelle.id} … `);
    const antwort = await hole(quelle);

    if (!antwort.ok) {
      process.stderr.write(`nicht erreichbar (${antwort.fehler})\n`);
      ergebnis.apis.push({ ...quelle, erreichbar: false, fehler: antwort.fehler });
      continue;
    }

    const norm = normalisiere(antwort.discovery);
    const summe = await pruefsumme(norm);

    const methoden = Object.entries(norm.ressourcen).map(([name, def]) => ({
      name,
      httpMethod: def.httpMethod,
      path: def.path,
      deprecated: def.deprecated,
      schreibend: ['POST', 'PATCH', 'PUT', 'DELETE'].includes(def.httpMethod),
      inWerkruf: verwendetInWerkruf(code, name, def),
    }));

    const felder = [];
    for (const [schema, props] of Object.entries(norm.schemata)) {
      for (const [feld, def] of Object.entries(props)) {
        felder.push({
          schema, feld,
          typ: def.ref ? `${def.ref}${def.array ? '[]' : ''}` : (def.type ?? '?'),
          schreibbar: !def.readOnly,
          deprecated: def.deprecated,
          enumWerte: def.enum?.length ?? 0,
        });
      }
    }

    process.stderr.write(`ok  rev ${norm.revision}  ${methoden.length} Methoden, ${felder.length} Felder\n`);
    ergebnis.apis.push({
      ...quelle, erreichbar: true,
      revision: norm.revision, pruefsumme: summe,
      methoden, felder, normalisiert: norm,
    });
  }

  if (nurPruefen) {
    const fehlend = ergebnis.apis.filter((a) => !a.erreichbar);
    console.log(fehlend.length === 0
      ? 'Alle Quellen erreichbar.'
      : `Nicht erreichbar: ${fehlend.map((a) => a.id).join(', ')}`);
    process.exit(fehlend.length === 0 ? 0 : 1);
  }

  fs.mkdirSync(path.join(wurzel, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(wurzel, 'docs/google-api-inventory.generated.json'),
    JSON.stringify(ergebnis, null, 2) + '\n');
  fs.writeFileSync(path.join(wurzel, 'docs/google-api-inventory.generated.md'), alsMarkdown(ergebnis));
  console.log('Geschrieben: docs/google-api-inventory.generated.json und .md');
}

function alsMarkdown(ergebnis) {
  const geprueft   = ergebnis.apis.filter((a) => a.erreichbar);
  const ungeprueft = ergebnis.apis.filter((a) => !a.erreichbar);

  const zeilen = [
    '# Google-Business-Profile-APIs — Bestandsaufnahme',
    '',
    '> Erzeugt von `scripts/google-api-inventory.mjs`. **Nicht von Hand bearbeiten.**',
    '> Die kuratierte Fassung liegt in `docs/google-api-inventory.md`.',
    `> Stand: ${ergebnis.erstelltAm}`,
    '',
    `**${geprueft.length} von ${ergebnis.apis.length} Quellen geprüft.**`,
    '',
  ];

  if (ungeprueft.length > 0) {
    zeilen.push(
      '> **Ungeprüft:** ' + ungeprueft.map((a) => `\`${a.id}\` (${a.fehler})`).join(', '),
      '>',
      '> Ein Abrufversagen sagt NICHTS darüber aus, ob die API im',
      '> Google-Cloud-Projekt aktiviert ist. Discovery-Dokumente sind',
      '> öffentlich und unabhängig von der Projektfreigabe. Ein HTTP 403',
      '> kann auch von einem Egress-Proxy der ausführenden Umgebung',
      '> stammen.',
      '',
    );
  }

  zeilen.push(
    '## Überblick',
    '',
    '',
    '| API | Spezifikation abrufbar | Revision | Methoden | davon schreibend | in WERKRUF | Felder |',
    '|---|---|---|---|---|---|---|',
  );

  for (const a of ergebnis.apis) {
    if (!a.erreichbar) {
      zeilen.push(`| ${a.titel} | **UNGEPRÜFT** (${a.fehler}) | — | — | — | — | — |`);
      continue;
    }
    const schreibend = a.methoden.filter((m) => m.schreibend).length;
    const genutzt = a.methoden.filter((m) => m.inWerkruf).length;
    zeilen.push(`| ${a.titel} | ja | ${a.revision} | ${a.methoden.length} | ${schreibend} | ${genutzt} | ${a.felder.length} |`);
  }

  for (const a of ergebnis.apis) {
    if (!a.erreichbar) continue;
    zeilen.push('', `## ${a.titel}`, '',
      `Discovery: ${a.url}`, `Dokumentation: ${a.doku}`,
      `Revision: \`${a.revision}\` · Prüfsumme: \`${a.pruefsumme.slice(0, 16)}…\``, '',
      '### Methoden', '',
      '| Methode | HTTP | Pfad | schreibend | veraltet | in WERKRUF |',
      '|---|---|---|---|---|---|');
    for (const m of a.methoden) {
      zeilen.push(`| \`${m.name}\` | ${m.httpMethod} | \`${m.path}\` | ${m.schreibend ? 'ja' : '—'} | ${m.deprecated ? '**ja**' : '—'} | ${m.inWerkruf ? 'ja' : '—'} |`);
    }

    const schreibbar = a.felder.filter((f) => f.schreibbar);
    const nurLesbar  = a.felder.filter((f) => !f.schreibbar);
    const veraltet   = a.felder.filter((f) => f.deprecated);

    zeilen.push('', `### Felder — ${schreibbar.length} schreibbar, ${nurLesbar.length} nur lesbar, ${veraltet.length} veraltet`, '',
      '| Schema | Feld | Typ | schreibbar | veraltet | Enum-Werte |',
      '|---|---|---|---|---|---|');
    for (const f of a.felder) {
      zeilen.push(`| ${f.schema} | \`${f.feld}\` | ${f.typ} | ${f.schreibbar ? 'ja' : '—'} | ${f.deprecated ? '**ja**' : '—'} | ${f.enumWerte || '—'} |`);
    }
  }

  zeilen.push('', '---', '',
    '## Was dieser Bericht NICHT aussagt', '',
    'Er prüft ausschließlich die **öffentlichen Spezifikationen**. Er sagt nichts darüber,',
    'ob eine API im Google-Cloud-Projekt aktiviert ist, ob eine Quota vergeben wurde oder',
    'ob ein Aufruf mit echtem Token funktioniert. Das beantwortet nur die Cloud Console',
    'oder ein authentifizierter Funktionstest — siehe `docs/google-api-inventory.md`,',
    'Abschnitt „Google-Cloud-Freigaben".');

  return zeilen.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
