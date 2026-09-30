#!/usr/bin/env node
/**
 * prerender.js — Post-build script for S&I Marketing
 *
 * Problem: Als React-SPA liefern alle Routen dasselbe leere index.html.
 * Crawler ohne JavaScript (Bing, AI-Crawler, SEO-Tools) sehen: kein H1,
 * keinen Inhalt, keine internen Links. Google muss jede Seite erst rendern,
 * was Indexierung verzögert ("Discovered - currently not indexed").
 *
 * Lösung: Nach `react-scripts build` erzeugt dieses Script pro Route eine
 * eigene HTML-Datei mit korrektem <title>, Meta-Tags, Canonical, JSON-LD
 * UND — für Blog-Artikel und die Blog-Übersicht — dem vollständigen
 * Artikelinhalt als statisches HTML in <div id="root">.
 *
 * React (createRoot().render) ersetzt den statischen Inhalt beim Laden
 * vollständig — kein Hydration-Konflikt, keine sichtbare Änderung für User
 * mit JavaScript. Crawler sehen sofort echten Inhalt und echte Links.
 *
 * Datenquelle: src/content/blog/blogPosts.js wird als ES-Modul importiert
 * (kein Regex-Parsing mehr) — Titles, Descriptions, Content und das
 * optionale Feld `seoTitle` bleiben damit immer synchron zur Runtime.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_URL = 'https://www.sarahiver.com';
const BUILD_DIR = path.join(__dirname, '..', 'build');
const TITLE_SUFFIX = ' | S&I.';

// ============================================
// HELPERS
// ============================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inline-Markdown → HTML (gleiches Feature-Set wie renderMarkdown in BlogArticle.js)
function inlineMd(text) {
  return escapeHtml(text)
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// Block-Markdown → HTML (Headings, Listen, Tabellen, Bilder, Absätze —
// exakt die Syntax, die der React-Renderer unterstützt)
function renderMarkdownToHtml(content) {
  if (!content) return '';
  const lines = content.trim().split('\n');
  const out = [];
  let i = 0;
  let tableRows = [];
  let inTable = false;

  const flushTable = () => {
    if (!tableRows.length) return;
    const [head, ...body] = tableRows;
    out.push('<table><thead><tr>' + head.map(c => `<th>${inlineMd(c)}</th>`).join('') + '</tr></thead>');
    out.push('<tbody>' + body.map(r => '<tr>' + r.map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
    tableRows = [];
    inTable = false;
  };

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) { flushTable(); i++; continue; }

    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      flushTable();
      out.push(`<img src="${escapeHtml(imgMatch[2])}" alt="${escapeHtml(imgMatch[1])}" loading="lazy" style="max-width:100%;height:auto;border-radius:8px;" />`);
      i++; continue;
    }

    if (line.startsWith('|') && line.endsWith('|')) {
      if (line.match(/^\|[\s\-:|]+\|$/)) { i++; continue; }
      tableRows.push(line.split('|').filter(Boolean).map(c => c.trim()));
      inTable = true;
      i++; continue;
    } else if (inTable) {
      flushTable();
    }

    if (line.startsWith('### ')) {
      out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
    } else if (line.startsWith('- ')) {
      const items = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('- ')) {
        i++;
        items.push(lines[i].trim().slice(2));
      }
      out.push('<ul>' + items.map(it => `<li>${inlineMd(it)}</li>`).join('') + '</ul>');
    } else {
      out.push(`<p>${inlineMd(line)}</p>`);
    }
    i++;
  }
  flushTable();
  return out.join('\n');
}

// Related Posts: gleiche Logik wie in BlogArticle.js (Kategorie +3, geteilte Tags +1)
function getRelatedPosts(post, allPosts) {
  return allPosts
    .filter(p => p.slug !== post.slug)
    .map(p => {
      let score = 0;
      if (p.category === post.category) score += 3;
      const sharedTags = (p.tags || []).filter(t => (post.tags || []).includes(t));
      score += sharedTags.length;
      return { ...p, _score: score };
    })
    .sort((a, b) => b._score - a._score || new Date(b.date) - new Date(a.date))
    .slice(0, 3);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ============================================
// STATIC BODY GENERATION (in <div id="root">)
// ============================================
const ROOT_STYLE = 'max-width:720px;margin:0 auto;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;line-height:1.7;color:#1a1a1a;';

function articleBodyHtml(post, allPosts) {
  const related = getRelatedPosts(post, allPosts);
  const relatedHtml = related.length
    ? `<nav aria-label="Verwandte Artikel">
        <h2>Das könnte euch auch interessieren</h2>
        <ul>
          ${related.map(p => `<li><a href="/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></li>`).join('\n          ')}
        </ul>
      </nav>`
    : '';

  return `
    <div style="${ROOT_STYLE}">
      <nav aria-label="Breadcrumb">
        <a href="/">S&amp;I. — Premium Hochzeitswebsites</a> · <a href="/blog">Ratgeber</a>
      </nav>
      <article>
        <p>${escapeHtml(post.category || 'Ratgeber')} · ${escapeHtml(formatDate(post.date))}${post.readTime ? ' · ' + escapeHtml(post.readTime) : ''}</p>
        <h1>${escapeHtml(post.title)}</h1>
        ${post.image ? `<img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.imageAlt || post.title)}" style="max-width:100%;height:auto;border-radius:8px;" />` : ''}
        ${renderMarkdownToHtml(post.content)}
      </article>
      <p><a href="/#themes">Unsere Hochzeitswebsite-Themes ansehen</a> · <a href="/blog">Alle Ratgeber-Artikel</a></p>
      ${relatedHtml}
      ${LEGAL_FOOTER}
    </div>`;
}

function blogIndexBodyHtml(allPosts) {
  const sorted = [...allPosts].sort((a, b) => new Date(b.date) - new Date(a.date));
  return `
    <div style="${ROOT_STYLE}">
      <nav aria-label="Breadcrumb"><a href="/">S&amp;I. — Premium Hochzeitswebsites</a></nav>
      <h1>Hochzeitswebsite Ratgeber &amp; Tipps</h1>
      <p>Alles rund um Hochzeitswebsites: Tipps, Trends, Checklisten und Inspiration für eure Hochzeitsplanung.</p>
      ${sorted.map(p => `
      <article>
        <h2><a href="/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></h2>
        <p>${escapeHtml(p.description)}</p>
      </article>`).join('\n')}
      <p><a href="/#themes">Unsere Hochzeitswebsite-Themes ansehen</a></p>
      ${LEGAL_FOOTER}
    </div>`;
}

// Preise aus src/lib/pricing.js lesen statt hier zu wiederholen.
// Der Prerender läuft als CommonJS-Skript und kann das ESM-Modul nicht
// importieren; deshalb der Umweg über den Dateiinhalt. Ändert sich ein Preis
// in pricing.js, zieht das Schema automatisch mit.
const PACKAGE_PRICES = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'pricing.js'), 'utf8');
  const out = [];
  const re = /name: '([^']+)',[\s\S]*?price: (\d+),[\s\S]*?tagline: '([^']*)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (Number(m[2]) > 0) out.push({ name: m[1], price: Number(m[2]), tagline: m[3] });
  }
  return out;
})();

function homeBodyHtml(allPosts) {
  const latest = [...allPosts].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  return `
    <div style="${ROOT_STYLE}">
      <h1>Premium-Hochzeitswebsite individuell erstellen lassen</h1>
      <p>S&amp;I. erstellt individuelle Premium-Hochzeitswebsites als persönliche Dienstleistung — kein Baukasten und kein Abo. Wir stimmen Design, Farben und Aufbau gemeinsam mit euch ab, richten die Website ein und begleiten euch bis zum Go-Live. Aus Hamburg, für Paare in Deutschland, Österreich und der Schweiz.</p>
      <h2>Zwei Wege zu eurer Hochzeitswebsite</h2>
      <ul>
        <li><strong>Website — ${PACKAGE_PRICES[0] ? PACKAGE_PRICES[0].price : 990}&nbsp;€:</strong> Wir gestalten das Design gemeinsam, ihr pflegt eure Inhalte über euer Dashboard ein, wir prüfen alles und geben den letzten Feinschliff.</li>
        <li><strong>All In — ${PACKAGE_PRICES[1] ? PACKAGE_PRICES[1].price : 1490}&nbsp;€:</strong> Ihr liefert Texte und Bilder, wir übernehmen Aufbau, Inhaltspflege, Bildplatzierung und Feinschliff vollständig. Save the Date und Wedding Archive sind enthalten.</li>
      </ul>
      <p>In beiden Paketen sind alle Website-Bereiche enthalten: digitales RSVP, Tagesablauf, Location und Anfahrt, Unterkünfte, Galerie mit Foto-Upload, Gästebuch und QR-Code. Die Website ist bis drei Monate nach der Hochzeit online.</p>
      <h2>Acht Designs, alle live erlebbar</h2>
      <p>Classic, Botanical, Contemporary, Editorial, Luxe, Modern, Neon und Video — jedes Design ist eine vollständige Live-Demo, die ihr vor der Anfrage durchklicken könnt.</p>
      <nav aria-label="Hauptnavigation">
        <ul>
          <li><a href="/blog">Hochzeitswebsite Ratgeber</a></li>
        </ul>
      </nav>
      <h2>Kostenlose Hochzeits-Tools</h2>
      <ul>
        <li><a href="/hochzeitsbudget-rechner">Hochzeitsbudget-Rechner</a></li>
        <li><a href="/hochzeitsdatum-finder">Hochzeitsdatum-Finder 2027 &amp; 2028</a></li>
        <li><a href="/brautpaar-quiz">Brautpaar-Quiz-Generator</a></li>
      </ul>
      <h2>Neueste Ratgeber-Artikel</h2>
      <ul>
        ${latest.map(p => `<li><a href="/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></li>`).join('\n        ')}
      </ul>
      <h2>Über S&amp;I.</h2>
      <p>Hinter S&amp;I. stehen Sarah und Iver aus Hamburg. Die Idee entstand bei der Planung der eigenen Hochzeit: Statt Baukasten-Vorlagen gestaltet S&amp;I. individuelle Premium-Hochzeitswebsites — mit digitalem RSVP, Gästemanagement, Foto-Upload und persönlicher Betreuung von der Einrichtung bis zum großen Tag, für Paare in Deutschland, Österreich und der Schweiz.</p>
      ${LEGAL_FOOTER}
    </div>`;
}

// Statischer Footer mit Links auf Impressum/Datenschutz — behebt Orphan Pages:
// die beiden Seiten waren nur im React-Footer verlinkt, den Crawler ohne JS nicht sehen.
const LEGAL_FOOTER = '<p><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></p>';

function toolBodyHtml({ h1, paragraphs, sections, links }) {
  return `
    <div style="${ROOT_STYLE}">
      <nav aria-label="Breadcrumb"><a href="/">S&amp;I. — Premium Hochzeitswebsites</a></nav>
      <h1>${escapeHtml(h1)}</h1>
      ${paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('\n      ')}
      ${(sections || []).map(s => `<h2>${escapeHtml(s.h2)}</h2>\n      <p>${escapeHtml(s.p)}</p>`).join('\n      ')}
      <h2>Passende Ratgeber &amp; Tools</h2>
      <ul>
        ${links.map(([href, label]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join('\n        ')}
      </ul>
      ${LEGAL_FOOTER}
    </div>`;
}

function legalBodyHtml({ h1, paragraphs }) {
  return `
    <div style="${ROOT_STYLE}">
      <nav aria-label="Breadcrumb"><a href="/">S&amp;I. — Premium Hochzeitswebsites</a></nav>
      <h1>${escapeHtml(h1)}</h1>
      ${paragraphs.map(p => `<p>${p}</p>`).join('\n      ')}
      ${LEGAL_FOOTER}
    </div>`;
}

// ============================================
// HTML GENERATION (head + body)
// ============================================
function generateHtml(template, route) {
  let html = template;
  const canonicalUrl = `${BASE_URL}${route.path === '/' ? '/' : route.path}`;
  const ogType = route.type || 'website';

  html = html.replace(/<title>.*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${escapeHtml(route.description)}"`);
  html = html.replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${canonicalUrl}"`);
  html = html.replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${escapeHtml(route.title)}"`);
  html = html.replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${escapeHtml(route.description)}"`);
  html = html.replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${canonicalUrl}"`);
  html = html.replace(/<meta property="og:type" content="[^"]*"/, `<meta property="og:type" content="${ogType}"`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${escapeHtml(route.title)}"`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${escapeHtml(route.description)}"`);

  if (route.image) {
    html = html.replace(/<meta property="og:image" content="[^"]*"/, `<meta property="og:image" content="${escapeHtml(route.image)}"`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*"/, `<meta name="twitter:image" content="${escapeHtml(route.image)}"`);
  }

  if (route.noIndex) {
    html = html.replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>');
  }

  // JSON-LD Schema (Artikel)
  if (route.schema) {
    const schemaJson = JSON.stringify(route.schema).replace(/</g, '\\u003c');
    html = html.replace('</head>', `    <script type="application/ld+json">${schemaJson}</script>\n  </head>`);
  }

  // Statischer Inhalt in <div id="root"> — React ersetzt ihn beim Mount.
  //
  // Damit Besucher ihn nicht kurz aufblitzen sehen: Das Inline-Skript im
  // <head> setzt sofort die Klasse js-enabled auf <html>. Die zugehörige
  // Regel blendet den statischen Block dann aus, BEVOR der Browser das
  // erste Mal zeichnet. Ohne JavaScript (Crawler ohne JS-Rendering) bleibt
  // er sichtbar — dafür ist er ja da.
  if (route.bodyHtml) {
    html = html.replace(
      /<div id="root">\s*<\/div>/,
      `<div id="root"><div data-prerender="1">${route.bodyHtml}</div></div>`
    );
    html = html.replace(
      '</head>',
      '    <style>.js-enabled [data-prerender="1"]{display:none}</style>\n'
      + '    <script>document.documentElement.className+=" js-enabled";</script>\n'
      + '  </head>'
    );
  }

  return html;
}

// ============================================
// MAIN
// ============================================
async function main() {
  // blogPosts.js als ES-Modul laden (Datei ist reine Daten ohne JSX):
  // Kopie als .mjs in ein Temp-Verzeichnis, dann dynamischer Import.
  const srcPath = path.join(__dirname, '..', 'src', 'content', 'blog', 'blogPosts.js');
  const tmpPath = path.join(os.tmpdir(), `blogPosts-${Date.now()}.mjs`);
  fs.copyFileSync(srcPath, tmpPath);
  let allPosts;
  try {
    const mod = await import('file://' + tmpPath);
    allPosts = mod.default;
  } finally {
    fs.unlinkSync(tmpPath);
  }
  if (!Array.isArray(allPosts) || allPosts.length === 0) {
    throw new Error('prerender: keine Blog-Posts aus blogPosts.js importiert!');
  }
  console.log(`   ${allPosts.length} Blog-Artikel aus blogPosts.js importiert`);

  const routes = [
    {
      path: '/',
      title: 'Premium-Hochzeitswebsite individuell erstellen lassen | S&I.',
      description: 'Individuelle Hochzeitswebsites mit persönlicher Betreuung. S&I. gestaltet und erstellt eure Hochzeitswebsite als Premium-Service ab 990 €.',
      schema: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': `${BASE_URL}/#organization`,
            name: 'S&I.',
            alternateName: ['sarahiver', 'Sarah & Iver', 'S&I. Premium Hochzeitswebsites'],
            url: `${BASE_URL}/`,
            logo: `${BASE_URL}/logo512.png`,
            description: 'S&I. erstellt Premium-Hochzeitswebsites mit individuellem Design, eigener Domain, digitalem RSVP, Gästemanagement und Foto-Upload. Aus Hamburg, für Paare im gesamten DACH-Raum.',
            email: 'wedding@sarahiver.de',
            address: {
              '@type': 'PostalAddress',
              streetAddress: 'Große Freiheit 82',
              postalCode: '22767',
              addressLocality: 'Hamburg',
              addressCountry: 'DE',
            },
            founder: [
              { '@type': 'Person', name: 'Sarah' },
              { '@type': 'Person', name: 'Iver' },
            ],
            areaServed: ['DE', 'AT', 'CH'],
            knowsLanguage: 'de',
            sameAs: [
              'https://www.instagram.com/sarah.iver.wedding/',
              'https://www.pinterest.com/sarahiverwedding/',
              'https://www.sarahiver.de/',
            ],
          },
          {
            '@type': 'WebSite',
            '@id': `${BASE_URL}/#website`,
            url: `${BASE_URL}/`,
            name: 'S&I. — Premium Hochzeitswebsites',
            inLanguage: 'de',
            publisher: { '@id': `${BASE_URL}/#organization` },
          },
          {
            // Hauptentität der Startseite: eine Dienstleistung, kein Produkt.
            // Preise stammen aus lib/pricing.js (siehe PACKAGE_PRICES unten),
            // damit es keine zweite Preiswahrheit gibt.
            '@type': 'Service',
            '@id': `${BASE_URL}/#service`,
            name: 'Individuelle Premium-Hochzeitswebsite',
            serviceType: 'Individuelle Erstellung einer Hochzeitswebsite',
            description: 'S&I. gestaltet und erstellt individuelle Hochzeitswebsites als persönliche Dienstleistung: gemeinsame Designabstimmung, Einrichtung, Prüfung und Go-Live. Auf Wunsch übernehmen wir den kompletten Aufbau inklusive Inhaltspflege.',
            url: `${BASE_URL}/`,
            provider: { '@id': `${BASE_URL}/#organization` },
            areaServed: [
              { '@type': 'Country', name: 'Deutschland' },
              { '@type': 'Country', name: 'Österreich' },
              { '@type': 'Country', name: 'Schweiz' },
            ],
            availableChannel: {
              '@type': 'ServiceChannel',
              serviceUrl: `${BASE_URL}/#contact`,
            },
            offers: PACKAGE_PRICES.map(pkg => ({
              '@type': 'Offer',
              name: pkg.name,
              description: pkg.tagline,
              price: String(pkg.price),
              priceCurrency: 'EUR',
              priceValidUntil: '2027-12-31',
              availability: 'https://schema.org/InStock',
              url: `${BASE_URL}/#pricing`,
              seller: { '@id': `${BASE_URL}/#organization` },
            })),
          },
        ],
      },
      bodyHtml: homeBodyHtml(allPosts),
    },
    {
      path: '/blog',
      title: 'Hochzeitswebsite Ratgeber & Tipps | S&I. Blog',
      description: 'Alles rund um Hochzeitswebsites: Tipps, Trends, Checklisten und Inspiration. Der S&I. Ratgeber hilft euch bei der Planung eures großen Tages.',
      bodyHtml: blogIndexBodyHtml(allPosts),
    },
    // Kostenlose Tools (Linkable Assets) — mit statischem Inhalt fürs Crawling
    {
      path: '/hochzeitsbudget-rechner',
      title: 'Hochzeitsbudget-Rechner: Was kostet eure Hochzeit wirklich?',
      description: 'Gästezahl wählen, 8 kurze Fragen beantworten – realistische Kostenschätzung erhalten. Vom Gartenfest bis zur Premium-Hochzeit. Kostenlos, ohne Anmeldung.',
      bodyHtml: toolBodyHtml({
        h1: 'Der Hochzeitsbudget-Rechner',
        paragraphs: [
          'Beantwortet 8 kurze Fragen zu eurer Feier und erhaltet einen realistischen Kosten-Richtwert – vom selbst organisierten Gartenfest bis zur Premium-Hochzeit. Basierend auf DACH-Erfahrungswerten, Stand 2026. Kostenlos und ohne Anmeldung.',
        ],
        sections: [
          {
            h2: 'Was der Rechner berücksichtigt',
            p: 'Der Rechner deckt die großen Kostenblöcke einer Hochzeit ab: Location und Catering, Fotografie und Video, Musik, Blumen und Dekoration, Outfits sowie Papeterie und Extras. Ihr wählt Gästezahl, Anspruch und Rahmen eurer Feier – und seht sofort, wie sich jede Entscheidung auf das Gesamtbudget auswirkt.',
          },
          {
            h2: 'Richtwert statt Angebot',
            p: 'Das Ergebnis ist eine Orientierung, kein Kostenvoranschlag: Reale Preise schwanken je nach Region, Saison und Wochentag deutlich. Als Faustregel gilt: Location und Catering machen meist 40 bis 50 Prozent des Gesamtbudgets aus – wer hier spart, etwa mit einem Termin unter der Woche, spart am meisten.',
          },
          {
            h2: 'Budget im Blick behalten',
            p: 'Der Richtwert ist der Startpunkt eurer Planung: Legt danach fest, welche Posten euch wichtig sind und wo ihr flexibel seid. Plant außerdem einen Puffer von etwa 10 Prozent für Unvorhergesehenes ein – von der zweiten Anprobe bis zum spontanen Mitternachtssnack.',
          },
        ],
        links: [
          ['/blog/hochzeit-2027-planen-checkliste', 'Hochzeit 2027 planen: Die komplette Checkliste'],
          ['/blog/hochzeitswebsite-kosten-was-kostet', 'Hochzeitswebsite Kosten: Alle Preismodelle'],
          ['/hochzeitsdatum-finder', 'Zum Hochzeitsdatum-Finder'],
        ],
      }),
    },
    {
      path: '/hochzeitsdatum-finder',
      title: 'Hochzeitsdatum-Finder 2027 & 2028: Die besten Termine',
      description: 'Findet euer Hochzeitsdatum: Schnapszahl-Termine, lange Wochenenden und Brückentage 2027 & 2028 – für jedes Bundesland, Österreich und die Schweiz.',
      bodyHtml: toolBodyHtml({
        h1: 'Der Hochzeitsdatum-Finder',
        paragraphs: [
          'Alle Schnapszahl-Termine, langen Wochenenden und Brückentage für 2027 und 2028 – für jedes Bundesland, Österreich und die Schweiz. Kostenlos und ohne Anmeldung.',
        ],
        sections: [
          {
            h2: 'Beliebte Termine früh sichern',
            p: 'Der Finder zeigt auf einen Blick, welche Termine besonders gefragt sind: Schnapszahlen wie der 07.07.2027, Samstage an Feiertags-Wochenenden und Brückentage, die aus eurer Hochzeit ein langes Wochenende machen. Beliebte Termine sind bei Locations und Standesämtern früh vergeben – plant dafür 12 bis 18 Monate Vorlauf ein.',
          },
          {
            h2: 'Feiertage nach Bundesland',
            p: 'Feiertage unterscheiden sich regional: Was in Bayern ein Brückentag ist, ist in Hamburg ein normaler Arbeitstag. Deshalb filtert der Finder nach Bundesland und zeigt zusätzlich die Termine für Österreich und die Schweiz – so plant ihr auch mit Gästen aus dem ganzen DACH-Raum.',
          },
          {
            h2: 'Datum gefunden – und dann?',
            p: 'Steht das Datum, folgen die ersten großen Entscheidungen: Standesamt oder freie Trauung, Location anfragen, Save-the-Date verschicken. Mit dem Budget-Rechner bekommt ihr direkt im Anschluss ein Gefühl dafür, was eure Wunschfeier kosten wird.',
          },
        ],
        links: [
          ['/blog/hochzeitsdatum-2027', 'Hochzeitsdatum 2027: Die besten Termine'],
          ['/blog/hochzeit-unter-der-woche', 'Hochzeit unter der Woche: Warum der Mittwoch boomt'],
          ['/hochzeitsbudget-rechner', 'Zum Hochzeitsbudget-Rechner'],
        ],
      }),
    },
    {
      path: '/brautpaar-quiz',
      title: 'Brautpaar-Quiz-Generator für Polterabend, JGA & Hochzeit',
      description: 'Erstellt euer Brautpaar-Quiz in 2 Minuten: 50 Fragen nach Kategorien, eigene Fragen ergänzen, drucken oder im Präsentationsmodus zeigen. Kostenlos.',
      bodyHtml: toolBodyHtml({
        h1: 'Der Brautpaar-Quiz-Generator',
        paragraphs: [
          'Stellt euer persönliches Brautpaar-Quiz in 2 Minuten zusammen: 50 Fragen nach Kategorien, eigene Fragen ergänzen, drucken oder im Präsentationsmodus zeigen. Kostenlos und ohne Anmeldung.',
        ],
        sections: [
          {
            h2: 'So funktioniert der Generator',
            p: 'Wählt aus 50 vorbereiteten Fragen in Kategorien wie Kennenlernen, Alltag, Zukunft und Peinliches – oder ergänzt eigene Fragen über das Brautpaar. Das fertige Quiz könnt ihr als Druckversion mitnehmen oder direkt im Präsentationsmodus auf Beamer oder Fernseher zeigen.',
          },
          {
            h2: 'Für Polterabend, JGA und Hochzeitsfeier',
            p: 'Das Brautpaar-Quiz funktioniert überall: als Programmpunkt auf dem Polterabend, als Spiel beim Junggesellenabschied oder als Unterhaltung zwischen Dinner und Party auf der Hochzeit selbst. Tipp: 15 bis 20 Fragen reichen für eine gute halbe Stunde Unterhaltung.',
          },
          {
            h2: 'So bleibt das Quiz unterhaltsam',
            p: 'Mischt leichte und schwere Fragen, damit alle Gäste mitraten können – von der Trauzeugin bis zum Großonkel. Persönliche Fragen aus eurer Kennenlerngeschichte kommen am besten an. Und: Ein kleiner Preis für die Gewinner macht aus dem Quiz einen echten Wettbewerb.',
          },
        ],
        links: [
          ['/blog/hochzeitsquiz-fragen-vorlage', 'Hochzeitsquiz: Die 40 besten Fragen für eure Gäste'],
          ['/blog/uebereinstimmungsspiel-hochzeit-fragen', 'Übereinstimmungsspiel: 35 Fragen & Anleitung'],
          ['/blog/brautpaar-quiz-polterabend', 'Brautpaar-Quiz: 30 Fragen für den Polterabend'],
        ],
      }),
    },
    // Embed-Varianten: noindex (laufen nur im iframe auf fremden Seiten)
    {
      path: '/embed/hochzeitsbudget-rechner',
      title: 'Hochzeitsbudget-Rechner (Embed)',
      description: 'Einbettbare Version des Hochzeitsbudget-Rechners von S&I.',
      noIndex: true,
    },
    {
      path: '/embed/hochzeitsdatum-finder',
      title: 'Hochzeitsdatum-Finder (Embed)',
      description: 'Einbettbare Version des Hochzeitsdatum-Finders von S&I.',
      noIndex: true,
    },
    {
      path: '/embed/brautpaar-quiz',
      title: 'Brautpaar-Quiz-Generator (Embed)',
      description: 'Einbettbare Version des Brautpaar-Quiz-Generators von S&I.',
      noIndex: true,
    },
    {
      // Kooperationen: eigene Seite, indexierbar — richtet sich an
      // Dienstleister, nicht an Paare.
      path: '/kooperationen',
      title: 'Kooperationen & Partner | S&I.',
      description: 'Ihr seid Hochzeitsdienstleister, Fotografin, Location oder Planerin? Lasst uns über eine Zusammenarbeit mit S&I. sprechen.',
      bodyHtml: '<h1>Kooperationen &amp; Partner</h1>'
        + '<p>S&amp;I. gestaltet individuelle Hochzeitswebsites aus Hamburg. '
        + 'Für Fotografinnen und Fotografen, Locations, Planerinnen, Papeterie '
        + 'und andere Hochzeitsdienstleister bieten wir Kooperationen an — '
        + 'schreibt uns, dann besprechen wir, was zusammenpasst.</p>'
        + '<p><a href="/">Zur Startseite</a> · <a href="/blog">Ratgeber</a></p>',
    },
    {
      path: '/impressum',
      title: 'Impressum | S&I.',
      description: 'Impressum von S&I. — Premium Hochzeitswebsites aus Hamburg: Anbieterkennzeichnung, Kontakt und rechtliche Hinweise gemäß § 5 TMG.',
      noIndex: true,
      bodyHtml: legalBodyHtml({
        h1: 'Impressum',
        paragraphs: [
          '<strong>Angaben gemäß § 5 TMG</strong><br />S&amp;I.<br />Iver Gentz<br />Große Freiheit 82<br />22767 Hamburg',
          '<strong>Kontakt</strong><br />E-Mail: wedding@sarahiver.de',
          '<strong>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</strong><br />Iver Gentz, Große Freiheit 82, 22767 Hamburg',
          'Vollständige Angaben zu Streitschlichtung, Haftung für Inhalte und Links sowie Urheberrecht findet ihr auf dieser Seite.',
        ],
      }),
    },
    {
      path: '/datenschutz',
      title: 'Datenschutzerklärung | S&I.',
      description: 'Datenschutzerklärung von S&I. — wie wir personenbezogene Daten erheben, verwenden und schützen: Hosting, Cookies, Analyse und eure Rechte.',
      noIndex: true,
      bodyHtml: legalBodyHtml({
        h1: 'Datenschutzerklärung',
        paragraphs: [
          'Diese Datenschutzerklärung informiert darüber, was mit personenbezogenen Daten passiert, wenn ihr diese Website besucht: welche Daten erhoben werden, wie wir sie nutzen und welche Rechte ihr habt.',
          'Themen auf dieser Seite: Datenschutz auf einen Blick, Hosting, allgemeine Hinweise und Pflichtinformationen, Datenerfassung auf dieser Website (Cookies, Kontaktanfragen), Analyse-Tools sowie eure Rechte auf Auskunft, Berichtigung und Löschung.',
          '<strong>Verantwortlicher</strong><br />Iver Gentz, Große Freiheit 82, 22767 Hamburg<br />E-Mail: wedding@sarahiver.de',
        ],
      }),
    },
  ];

  allPosts.forEach(post => {
    routes.push({
      path: `/blog/${post.slug}`,
      // seoTitle (optional, ≤53 Zeichen empfohlen) überschreibt den langen Titel
      title: `${post.seoTitle || post.title}${TITLE_SUFFIX}`,
      description: post.description,
      type: 'article',
      image: post.image || null,
      schema: post.schema
        ? {
            ...post.schema,
            '@context': 'https://schema.org',
            url: `${BASE_URL}/blog/${post.slug}`,
            image: post.image,
            dateModified: post.date,
          }
        : null,
      bodyHtml: articleBodyHtml(post, allPosts),
    });
  });

  const indexPath = path.join(BUILD_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('❌ build/index.html not found! Run `npm run build` first.');
    process.exit(1);
  }

  const template = fs.readFileSync(indexPath, 'utf-8');

  // Guard: Template muss ein LEERES #root haben (frischer CRA-Build).
  // Verhindert, dass ein zweiter Lauf ohne Rebuild bereits injizierten
  // Inhalt als Template weiterverwendet.
  if (!/<div id="root">\s*<\/div>/.test(template)) {
    console.error('\u274c build/index.html enth\u00e4lt bereits injizierten Inhalt.');
    console.error('   Erst `react-scripts build` ausf\u00fchren, dann prerender.js (macht `npm run build` automatisch).');
    process.exit(1);
  }
  let created = 0;

  routes.forEach(route => {
    const html = generateHtml(template, route);
    if (route.path === '/') {
      fs.writeFileSync(indexPath, html, 'utf-8');
      console.log('  ✅ / (updated index.html)');
    } else {
      const dirPath = path.join(BUILD_DIR, route.path);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, 'index.html'), html, 'utf-8');
      console.log(`  ✅ ${route.path}`);
    }
    created++;
  });

  // llms.txt — Markdown-Überblick für AI-Crawler (GPTBot, ClaudeBot, PerplexityBot)
  const llmsTxt = `# S&I. — Premium Hochzeitswebsites

> S&I. erstellt Premium-Hochzeitswebsites mit individuellem Design, eigener Domain, digitalem RSVP, Gästemanagement und Foto-Upload. Gegründet von Sarah und Iver in Hamburg, für Paare in Deutschland, Österreich und der Schweiz. Persönlich gestaltet statt Baukasten-Vorlage.

## Angebot

- [Startseite mit Designs und Preisen](${BASE_URL}/): individuelle Hochzeitswebsites ab 990 €, persönlich begleitet und in wenigen Tagen live

## Kostenlose Hochzeits-Tools

- [Hochzeitsbudget-Rechner](${BASE_URL}/hochzeitsbudget-rechner): Realistische Kostenschätzung in 8 Fragen
- [Hochzeitsdatum-Finder 2027 & 2028](${BASE_URL}/hochzeitsdatum-finder): Schnapszahlen, Feiertage und Brückentage für DE, AT und CH
- [Brautpaar-Quiz-Generator](${BASE_URL}/brautpaar-quiz): 50 Fragen für Polterabend, JGA und Hochzeitsfeier

## Ratgeber

${[...allPosts].sort((a, b) => new Date(b.date) - new Date(a.date)).map(p => `- [${p.title}](${BASE_URL}/blog/${p.slug}): ${p.description}`).join('\n')}

## Kontakt & Profile

- E-Mail: wedding@sarahiver.de
- Instagram: https://www.instagram.com/sarah.iver.wedding/
- Pinterest: https://www.pinterest.com/sarahiverwedding/
`;
  fs.writeFileSync(path.join(BUILD_DIR, 'llms.txt'), llmsTxt, 'utf-8');
  console.log('  ✅ /llms.txt');

  console.log(`\n🎉 Prerendered ${created} routes (Head-Metas + statischer Inhalt).`);
  console.log('   Crawler sehen jetzt H1, Artikeltext und interne Links ohne JavaScript.\n');
}

main().catch(err => {
  console.error('❌ prerender failed:', err);
  process.exit(1);
});
