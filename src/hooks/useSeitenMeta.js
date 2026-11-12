/*
 * Titel, Meta-Description und Canonical für eine öffentliche Seite.
 *
 * Die App hat kein Helmet und kein Prerendering; public/index.html
 * liefert die Startwerte, ThemeInjector setzt den Titel einmal beim
 * Start. Dieser Hook überschreibt die drei Werte, solange die Seite
 * zu sehen ist, und stellt beim Verlassen den vorherigen Stand wieder
 * her — damit die Startseite nicht mit dem Titel einer Hilfeseite
 * weiterläuft.
 */
import { useEffect } from 'react';

export const SEITEN_BASIS = 'https://werkruf.com';

function metaElement(name) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  return el;
}

function canonicalElement() {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  return el;
}

export function useSeitenMeta({ titel, beschreibung, pfad }) {
  useEffect(() => {
    const vorher = {
      titel: document.title,
      beschreibung: metaElement('description').getAttribute('content'),
      canonical: canonicalElement().getAttribute('href'),
    };
    document.title = titel;
    metaElement('description').setAttribute('content', beschreibung);
    canonicalElement().setAttribute('href', `${SEITEN_BASIS}${pfad}`);
    return () => {
      document.title = vorher.titel;
      if (vorher.beschreibung != null) metaElement('description').setAttribute('content', vorher.beschreibung);
      if (vorher.canonical != null) canonicalElement().setAttribute('href', vorher.canonical);
    };
  }, [titel, beschreibung, pfad]);
}
