# Vertical-Expansion — Architektur und Backlog

**Stand 16.10.2026. Dokumentation, keine Umsetzung.** Nichts aus diesem
Dokument ist gebaut, und nichts davon gehört vor dem Handwerk-MVP gebaut.

---

## 1 — Die Entscheidung

WERKRUF nutzt perspektivisch **eine technische Plattform für mehrere lokale
Branchen**, aber **getrennte Vertriebsfrontends**:

```
GEMEINSAM                           JE BRANCHE EIGEN
───────────────────────             ──────────────────────
eine SaaS-Plattform                 Domain und Marke
eine Decision Engine                Hero- und Nutzen-Copy
ein Dashboard                       Beispielaufgaben
eine Google-Integration             FAQ
eine Billing-Infrastruktur          Bildsprache
eine Mail-Infrastruktur             SEO-Metadaten
ein Datenmodell                     Ads und Creatives
```

| Domain | Branche | Stand |
|---|---|---|
| `werkruf.com` | Handwerk und Gewerbe | live |
| `gastroruf.com` | Gastronomie | Konfiguration vorhanden, **nicht live** |
| Beauty-Vertical | Kosmetik, Friseur, Studio | Starter-Template, **nicht live** |

---

## 2 — Was ausdrücklich NICHT gebaut wird

**Keine generische Landingpage für alle lokalen Unternehmen.** Kein
Branchen-Auswahlfeld, kein „WERKRUF für alle".

Begründung, und sie ist eine Vertriebsentscheidung, keine technische:

- **Andere Kaufmotive.** Ein Dachdecker will gefunden werden, wenn das Dach
  undicht ist. Ein Restaurant will am Freitagabend volle Tische. Das ist
  nicht dieselbe Dringlichkeit und nicht dieselbe Jahreszeit.
- **Andere Sprache.** „Baustelle", „Gewerk", „Meisterbetrieb" gegen
  „Gäste", „Reservierung", „Mittagstisch". Ein Text, der beiden gerecht
  wird, spricht zu keinem.
- **Andere Suchintention.** Wer „Sanitär Notdienst Hamburg" sucht, erwartet
  etwas anderes als wer „Italiener Eppendorf" sucht. Dieselbe Seite kann
  nicht auf beides optimiert sein.
- **Andere Beispiele.** Der ExampleScore zeigt eine Dachdeckerei. Für ein
  Restaurant wäre dieselbe Aufgabenliste falsch gewichtet — dort zählen
  Öffnungszeiten und Fotos stärker als die Antwortquote.
- **Andere Anzeigen.** Keyword-Cluster, Hooks und Creatives trennen sich
  ohnehin. Eine gemeinsame Landingpage würde beide Kampagnen verwässern.

Eine Seite, die jedem gefallen soll, überzeugt niemanden. Das ist der
teuerste Fehler, den eine kleine Marke machen kann.

---

## 3 — Was die Handwerk-Landingpage als Vorlage leistet

Die Struktur aus P4B bleibt wiederverwendbar:

```
Hero  →  So funktioniert's  →  Leistungen  →  Vergleich  →  Preis  →  FAQ  →  Abschluss
```

Diese Reihenfolge ist keine Geschmacksfrage, sie beantwortet Fragen in der
Reihenfolge, in der sie gestellt werden: *Was ist das? Wie arbeitet es? Was
habe ich davon? Was ist die Alternative? Was kostet es? Was ist mit…? Wie
fange ich an?*

**Technisch bereits austauschbar.** Jede Sektion liest ihre Inhalte aus
`src/config/industryConfig.js` und nichts aus sich selbst:

| Komponente | Liest aus der Branchenkonfiguration |
|---|---|
| `Hero.js` | `copy.hero.*`, `pricing.*` |
| `ExampleScore.js` | eigene Beispieldaten (branchenabhängig, siehe unten) |
| `Features.js` | `copy.featureGruppen`, `copy.vertrauen` |
| `Vergleich.js` | `pricing.comparison`, `brand.name` |
| `Preis.js` | `pricing.*` |
| `FAQ.js` | `copy.faq`, `copy.footer.email` |
| `AbschlussCTA.js` | `pricing.*`, `brand.name` |

Farben, Schriften und Formensprache kommen ebenfalls von dort
(`colors`, `typography`, `design`) und werden über `ThemeInjector`
als CSS-Variablen gesetzt. Die Domainerkennung in `IndustryContext`
wählt die Branche anhand des Hostnamens.

**Drei Komponenten haben bereits einen Rückfallpfad**, damit eine Branche
ohne die neue Struktur die Seite nicht zerlegt: `Features` fällt auf die
flache Liste zurück, `Vergleich` und `FAQ` blenden sich aus. Geprüft in
`publicFunnelLanding.test.js`, dessen Attrappe bewusst ohne
`featureGruppen`, `comparison` und `faq` läuft.

**Nicht drei getrennte Anwendungen.** Eine Codebasis, eine Datenbank, ein
Dashboard.

---

## 4 — Was pro Branche wirklich zu tun ist

Nicht „Texte übersetzen". Die ehrliche Liste:

| | Aufwand |
|---|---|
| Product-Truth-Audit für die Branche | Jede Aussage gegen den Code prüfen — dieselbe Arbeit wie P4A |
| Hero, Nutzen, FAQ neu schreiben | Nicht aus der Handwerk-Fassung übersetzen |
| Beispielaufgaben im ExampleScore | Die Gewichtung des Scores ist branchenneutral, die **Beispieldaten** sind es nicht |
| Vergleichstabelle | „Agentur" heisst in der Gastronomie oft etwas anderes |
| Domain, DNS, Brevo-Absender, Stripe-Produkt | Betriebsarbeit, keine Entwicklung |
| SEO und Ads | Eigene Keyword-Cluster, eigene Creatives |

**Die Konfiguration von gastro und beauty ist nicht startbereit.** Beide
Blöcke tragen Aussagen aus der Generation vor dem 16.10.2026 — darunter
„Bewertungs-Autopilot", „Monatliches Reporting", „Google Maps
Top-Platzierung" und ROI-Rechnungen mit +25 % beziehungsweise +20 %. Nichts
davon existiert. Beide Blöcke haben deshalb seit dem 16.10.2026 einen
Warnkopf in `industryConfig.js`. Heute ist das folgenlos, weil
`ACTIVE_INDUSTRY = 'handwerk'` gilt und keine der Domains aufgeschaltet
ist. Es wird in dem Moment gefährlich, in dem eine davon live geht.

---

## 5 — Reihenfolge

```
1  WERKRUF Handwerk: MVP abschliessen, echte Nutzer gewinnen
2  Funnel, Conversion und tatsächliche Produktnutzung validieren
3  GASTRORUF: eigener Product-Truth-Audit
4  Gastro-Copy und Landingpage aus derselben Komponentenbasis
5  Branchenspezifische Ads und SEO
6  Erst danach Beauty
```

Schritt 2 ist der eigentliche Hebel, nicht Schritt 3. Eine zweite Branche
verdoppelt den Pflegeaufwand und halbiert die Aufmerksamkeit. Sie lohnt
sich erst, wenn für die erste belegt ist, dass der Funnel trägt und das
Produkt benutzt wird — sonst skaliert man eine Annahme.

---

## 6 — Marketing-Trennung

| Bereich | Je Branche getrennt |
|---|---|
| SEO | eigene Keyword-Cluster und Inhalte |
| Paid Ads | eigene Anzeigen, Hooks, Creatives |
| Landingpage | eigene Problem- und Ergebnissprache |
| Social | branchenspezifische Beispiele |
| **Technische Plattform** | **gemeinsam** |

---

## 7 — Beispiel: unterschiedliche Botschaften

Nur zur Veranschaulichung der Trennung. **Nicht eingebaut, nicht live.**

**Handwerk** — besser lokal gefunden werden · professionell wirken · mehr
Chancen auf gute Anfragen · weniger Zeit mit Google verbringen

**Gastronomie** — mehr lokale Gäste · aktuelle Öffnungszeiten ·
Bewertungen schnell auffangen · Fotos und Profil aktuell halten

**Beauty** — mehr lokale Buchungen · Vertrauen durch Bewertungen ·
Leistungen und Zeiten aktuell · professioneller Google-Auftritt

Derselbe Produktkern, dreimal anders erzählt. Genau das ist der Grund für
getrennte Frontends.

---

## 8 — Nicht jetzt

Ausdrücklich nicht Teil dieser Phase:

- `gastroruf.com` oder Beauty aufschalten
- Gastro- oder Beauty-Texte bereinigen
- neue Stripe-Produkte anlegen
- eine zweite Google-OAuth-App einrichten
- neue Branchenlogik implementieren

Dieses Dokument hält die Architektur fest. Mehr nicht.

---

## 9 — Offene Fragen für später

Nicht zu beantworten, bevor Branche zwei ansteht — aber jetzt notiert,
damit sie dann nicht neu gefunden werden müssen:

1. **Eine Google-OAuth-App oder mehrere?** Der Zustimmungsbildschirm zeigt
   den App-Namen. Steht dort „WERKRUF", während der Gastronom auf
   gastroruf.com war, bricht das Vertrauen genau an der heikelsten Stelle.
2. **Ein Stripe-Konto oder mehrere?** Auf der Rechnung steht derselbe
   Anbieter. Das ist rechtlich richtig und wirkt auf den Kunden trotzdem
   fremd.
3. **Der WERKRUF Score über Branchen hinweg.** Die fünf Faktoren sind
   neutral, ihre **Gewichtung** ist es nicht: Für ein Restaurant zählen
   Öffnungszeiten und Fotos schwerer als die Antwortquote. Eine zweite
   Gewichtung heisst eine zweite Wahrheit — das gehört entschieden, bevor
   es sich einschleicht.
4. **Eine Mailabsenderadresse je Marke?** Brevo braucht je Domain eigene
   DKIM-Einträge. Die Arbeit ist klein, das Vergessen teuer.
5. **Support unter welchem Namen?** `info@werkruf.com` beantwortet heute
   alles. Bei zwei Marken erwartet ein Gastronom eine Antwort von
   GASTRORUF.
