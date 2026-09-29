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
/* node:-Praefix statt blanker Spezifizierer.
   Deno verweigert "import fs from 'fs'" mit
   "Relative import path not prefixed with / or ./ or ../" — genau
   daran ist der Deploy am 29.09. gescheitert, weil die Edge Function
   damals noch von hier importierte. Sie tut es nicht mehr (die reine
   Logik liegt in gbp-api-schema.mjs), aber mit dem Praefix kann diese
   Datei auch kuenftig keine Deno-Pruefung mehr brechen.
   Node unterstuetzt node: seit 16. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

import {
  QUELLEN, normalisiere, pruefsumme, hole,
  verwendetInWerkruf, dienstHostAus,
} from './gbp-api-schema.mjs';

/* Re-Export, damit bestehende Aufrufer und Tests unveraendert
   weiterfunktionieren. Die Definitionen liegen in gbp-api-schema.mjs —
   dort, wo auch die Edge Function sie holt. */
export { QUELLEN, normalisiere, pruefsumme, hole, verwendetInWerkruf, dienstHostAus };

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

/*
 * Bezeichner, die in jedem Google-Code vorkommen und deshalb nichts
 * ueber die Nutzung einer bestimmten API aussagen. Ohne diese Liste
 * meldete der Abgleich fuer Place Actions "6 von 6 in WERKRUF",
 * obwohl der Code diese API nie aufruft — "locations", "accounts" und
 * "get" stehen nun einmal ueberall.
 */

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

    const host = dienstHostAus(antwort.discovery);
    const hostImCode = host ? code.includes(host) : false;

    const methoden = Object.entries(norm.ressourcen).map(([name, def]) => ({
      name,
      httpMethod: def.httpMethod,
      path: def.path,
      deprecated: def.deprecated,
      schreibend: ['POST', 'PATCH', 'PUT', 'DELETE'].includes(def.httpMethod),
      vermutlichInWerkruf: verwendetInWerkruf(code, name, def, host),
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
      dienstHost: host, hostImCode,
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
    '| API | Spezifikation abrufbar | Revision | Methoden | davon schreibend | vermutlich in WERKRUF | Felder |',
    '|---|---|---|---|---|---|---|',
  );

  for (const a of ergebnis.apis) {
    if (!a.erreichbar) {
      zeilen.push(`| ${a.titel} | **UNGEPRÜFT** (${a.fehler}) | — | — | — | — | — |`);
      continue;
    }
    const schreibend = a.methoden.filter((m) => m.schreibend).length;
    const genutzt = a.hostImCode
      ? String(a.methoden.filter((m) => m.vermutlichInWerkruf).length)
      : '**0** (Host nicht im Code)';
    zeilen.push(`| ${a.titel} | ja | ${a.revision} | ${a.methoden.length} | ${schreibend} | ${genutzt} | ${a.felder.length} |`);
  }

  for (const a of ergebnis.apis) {
    if (!a.erreichbar) continue;
    zeilen.push('', `## ${a.titel}`, '',
      `Discovery: ${a.url}`,
      ...(a.ersatzFuer ? [`Ersatz für: ${a.ersatzFuer} — ${a.hinweis}`] : []),
      `Dokumentation: ${a.doku}`,
      `Dienst-Host: \`${a.dienstHost}\` — im WERKRUF-Code ${a.hostImCode ? 'vorhanden' : '**nicht vorhanden**'}`,
      `Revision: \`${a.revision}\` · Prüfsumme: \`${a.pruefsumme.slice(0, 16)}…\``, '',
      '### Methoden', '',
      '| Methode | HTTP | Pfad | schreibend | veraltet | vermutlich in WERKRUF |',
      '|---|---|---|---|---|---|');
    for (const m of a.methoden) {
      zeilen.push(`| \`${m.name}\` | ${m.httpMethod} | \`${m.path}\` | ${m.schreibend ? 'ja' : '—'} | ${m.deprecated ? '**ja**' : '—'} | ${m.vermutlichInWerkruf ? 'ja' : '—'} |`);
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
    'Abschnitt „Google-Cloud-Freigaben".', '',
    'Die Spalte „vermutlich in WERKRUF" ist eine Textsuche im Quelltext, keine Analyse.',
    'Sie zaehlt nur, wenn der Dienst-Host der API im Code vorkommt, und trifft danach',
    'auf markante Bezeichner. Sie kann daneben liegen — gepruefte Aussagen zur Nutzung',
    'stehen in `docs/google-api-inventory.md`.');

  return zeilen.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
