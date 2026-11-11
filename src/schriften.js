/*
 * Schriften selbst ausgeliefert (statt fonts.googleapis.com).
 *
 * Vorher lud GlobalStyle die Schriften per @import direkt von Google —
 * bei jedem Seitenaufruf, ohne Einwilligung, mit der IP-Adresse des
 * Besuchers (LG Muenchen I, 20.01.2022, 3 O 17493/20). Jetzt kommen die
 * Dateien aus dem eigenen Build (Vercel), kein Request an Google.
 *
 * Familien und Schnitte genau wie im alten @import, fuer alle drei
 * Branchen (ThemeInjector waehlt je Domain).
 */
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/900.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
