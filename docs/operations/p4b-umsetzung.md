# P4B — Umsetzung des Product-Truth-Audits

**16.10.2026.** Grundlage: `docs/operations/p4a-product-truth-audit.md`.
Geändert wurden Wahrheit, Conversion und Funnel. Keine neuen Funktionen,
keine Design-Neuerfindung, kein technischer E2E-Smoke.

---

## A. Geänderte Dateien

### Neu

| Datei | Zweck |
|---|---|
| `src/components/Vergleich.js` | Selbst machen / Agentur / WERKRUF nebeneinander |
| `src/components/Preis.js` | Die Preiskarte — auf Landingpage **und** Preisseite |
| `src/components/FAQ.js` | Sieben Fragen vor der Entscheidung |
| `src/components/AbschlussCTA.js` | Der Abschluss der Seite, mit echtem Ziel |
| `src/oeffentlicheWahrheit.test.js` | Regressionstests nach §33 |

### Geändert

| Datei | Was |
|---|---|
| `src/config/industryConfig.js` | ROI-Block, falsche Pro-Features und Free-Vergleich raus; `featureGruppen`, `vertrauen`, `faq`, dreispaltiger `comparison` rein; `copy.check`/`copy.analysis` entfernt (von niemandem gelesen); Warnköpfe für gastro und beauty |
| `src/components/Header.js` | Auth-abhängig, toter Menüpunkt raus, Registrieren-CTA rein |
| `src/components/Hero.js` | Preiszeile, Nutzen-Subline in Normalschrift, CTA-Text, Anmelde-Link nur für Ausgeloggte |
| `src/components/Features.js` | Drei Ergebnisgruppen statt sechs gleicher Kacheln, Vertrauensstreifen, toter Abschluss-CTA raus |
| `src/components/ExampleScore.js` | Anker `beispiel` → `so-gehts` |
| `src/pages/HomePage.js` | Von drei auf sieben Abschnitte |
| `src/pages/Pricing.js` | Vollständig neu: 565 → 185 Zeilen |
| `src/pages/dashboard/DashboardReporting.js` | Platzhalterkarte „Monatliche Reports" entfernt |
| `src/pages/dashboard/DashboardKundenGewinnung.js` | Tipp „Automatische Bewertungsanfragen" ersetzt |
| `src/components/dashboard/GoogleProfilVerwalten.js` | Leere Reiter verlinken statt „nicht eingerichtet" zu behaupten |
| `src/publicFunnelLanding.test.js` | Attrappe um Preisblock erweitert, CTA-Prüfung auf Ziel statt Text |
| `src/kreditkartenZusage.test.js` | Prüft jetzt Preisseite **und** Preiskarte |
| `src/billingAudit.test.js` | dito |
| `src/components/dashboard/googleProfilVerwalten.test.js` | Prüft Verweisziele statt der alten Fehlanzeige |

---

## B. Neue Landingpage-Struktur

```
1  Hero          Was ist das, was bringt es, was kostet es, was tue ich jetzt
2  so-gehts      Beispielprofil → Aufgaben → vier Nutzenpunkte
3  leistungen    Drei Ergebnisse (A besser gefunden, B professioneller
                 wirken, C weniger Arbeit) + Vertrauensstreifen
4  vergleich     Selbst machen / Agentur / WERKRUF, sechs Zeilen
5  preis         49 €, acht echte Leistungen, Einordnung ohne Rechnung
6  faq           Sieben Fragen
7  start         Abschluss-CTA, dasselbe Ziel wie im Hero
```

Jeder Menüpunkt im Kopf hat ein Gegenstück auf der Seite — geprüft durch
einen Test, der die Anker aus `Header.js` gegen die `id`-Attribute der
Sektionen hält.

---

## C. Finale Positionierung

> WERKRUF behält deinen Google-Auftritt im Blick, damit du lokal besser
> gefunden wirst, professioneller wirkst und keine Bewertung und kein
> Profilproblem verpasst.
>
> Du musst dich nicht darum kümmern. WERKRUF sagt dir, was wichtig ist —
> in wenigen Minuten erledigt.

Die Abgrenzung steht als Satz am Ende des Vergleichs:

> WERKRUF ist für Betriebe, die **keine Agentur brauchen** — aber auch
> nicht jede Woche an Google denken wollen.

**Eine Abweichung von deinem Entwurf, mit Begründung:** Du hattest für den
Hero drei Nutzenzeilen vorgeschlagen — „Mehr lokale Sichtbarkeit / Mehr
Vertrauen / Minimaler Zeitaufwand". Die stehen jetzt nicht im Hero, sondern
als Überschriften der drei Leistungsgruppen. Grund: Diese drei Zeilen
könnten über jedem SEO-Angebot stehen; sie sind austauschbar und damit das
Gegenteil des handwerklichen, direkten Tons, den du behalten willst (§30).
Im Hero stehen stattdessen die drei konkreten Punkte, die das Produkt
unterscheiden — einmal verbinden, Antwortvorschläge freigeben, Meldung wenn
etwas nicht stimmt. Als Gliederung der Leistungen leisten deine drei
Ergebnisse dagegen genau das, was sie sollen: Sie ordnen.

---

## D. Finale Pricing-Aussage

```
49 € / Monat
30 Tage kostenlos
monatlich kündbar
keine Einrichtungsgebühr
```

Dazu die Einordnung, die keine Zahl erfindet:

> WERKRUF kostet 49 € im Monat, also 588 € im Jahr. Wenn dein besserer
> lokaler Auftritt im Jahr auch nur zu einem zusätzlichen Auftrag beiträgt,
> kann sich der Monatsbeitrag bereits rechnen. Versprechen können wir das
> nicht — entscheiden tut am Ende dein Kunde.

Der Preis steht an **einer** Stelle im Code (`industryConfig.monthlyPrice`)
und wird überall von dort gelesen. Der Test prüft das: keine
handgeschriebene 49 auf einer Seite.

**Enthalten laut Preiskarte**, alles gebaut und in Betrieb:
Wochenmail · Sofortmeldung bei 1–2 Sternen · Antwortvorschläge ·
Profilangaben ändern · Fotos hochladen · Bewertungslink und QR-Code ·
laufende Überwachung · monatlich kündbar.

---

## E. Entfernte Altversprechen

| Versprechen | Wo es stand | Warum es weg ist |
|---|---|---|
| „Bewertungs-Autopilot (SMS + E-Mail)" | Pro-Liste | Keine Zeile Code im Repository |
| „Monatliches PDF-Reporting" | Pro-Liste | Existiert nicht |
| „Profil-Check ohne Anmeldung" | Free-Vergleich | Seit 28.09.2026 abgeschaltet |
| „Befund als PDF" | Free-Vergleich | Abgeschaltet, dazu Rechte-Gate zu |
| Free-Tarif „Sichtbarkeits-Check, 0 €" | Preiskarte | Gibt es nicht |
| ROI-Rechner (7247 %) | Preisseite | Keine der drei Zahlen belegt, Anruf ≠ Auftrag |
| „3× mehr Anfragen" | Preis-Hero | Widersprach den +30 % sechs Zeilen tiefer |
| „bis zu 9.120 € zurück" | Preis-Hero | Widersprach dem eigenen Rechner (18.000 €) |
| „Wenn du nach 30 Tagen nicht mehr Anfragen hast, zahlst du nichts" | Abschluss | Erfolgsgarantie ohne Messung und ohne Erstattungsweg |
| „Bereit, die falschen Kunden loszuwerden?" | Leistungen | Passt nicht zum Versprechen |
| „Monatliche Reports" mit Badge „PRO-Feature" | Dashboard | Pro-Zusage an zahlende Kunden ohne Funktion |
| „Mit WERKRUF PRO: Automatische Bewertungsanfragen" | Dashboard | dito |
| „Dieser Bereich ist noch nicht eingerichtet" | Dashboard | Falsch — beide Bereiche sind gebaut, nur woanders |

---

## F. CTA-Matrix

| Ort | Text | Ziel ausgeloggt | Ziel angemeldet |
|---|---|---|---|
| Kopf, Knopf | 30 Tage kostenlos testen / **Zum Dashboard** | `/signup` | `/dashboard` |
| Kopf, Textlink | Einloggen | `/login` | *wird nicht gezeigt* |
| Hero, Hauptknopf | Jetzt 30 Tage kostenlos testen / **Google-Unternehmensprofil verbinden** | `/signup` | `/dashboard/google` |
| Hero, Fusszeile | Anmelden | `/login` | *wird nicht gezeigt* |
| Preissektion | Jetzt 30 Tage kostenlos testen / **Zum Dashboard** | `/signup` | `/dashboard` |
| Abschluss | 30 Tage kostenlos testen / **Zum Dashboard** | `/signup` | `/dashboard` |
| Kopf, Navigation | So funktioniert's · Leistungen · Preis · Fragen | Anker auf der Landingpage | identisch |
| Fusszeile | AGB · Impressum · Datenschutz · Hilfe | eigene Seiten | identisch |

**Warum der Hero ein anderes Ziel hat als der Rest:** Für einen
angemeldeten Nutzer ist die Testphase keine Frage mehr — offen ist die
Google-Verbindung. Deshalb führt dort der Knopf direkt dorthin. Alle
anderen führen ins Dashboard, das selbst zur Verbindung leitet, wenn sie
fehlt.

**Warum „Jetzt 30 Tage kostenlos testen" und nicht „Google-Profil
verbinden"** (du hattest beides zur Wahl gestellt): Der Knopf muss sagen,
worauf man sich einlässt, nicht was im zweiten Schritt passiert.
„Verbinden" klingt nach Arbeit und nach Berechtigung — zwei Hürden auf
einmal, bevor der Besucher weiss, was es kostet. Für Angemeldete dreht es
sich um, deshalb dort der andere Text.

---

## G. Agentur-Abgrenzung

Umgesetzt an drei Stellen, jeweils ohne Wettbewerber zu nennen und ohne
fremde Preise zu behaupten:

1. **Vergleichssektion** (`Vergleich.js`) — sechs Zeilen, drei Spalten. Die
   Agenturspalte sagt „Monatspaket" statt einer Zahl: Es gibt Anbieter mit
   49 € netto und zwölf Monaten Laufzeit und solche mit dreistelligen
   Paketen; eine Zahl hineinzuschreiben hiesse, eine Spanne als Tatsache
   auszugeben. Wo Anbieter sich unterscheiden, steht „je nach Anbieter".
2. **Der Satz darunter**, als Fazit hervorgehoben: „WERKRUF ist für
   Betriebe, die keine Agentur brauchen — aber auch nicht jede Woche an
   Google denken wollen."
3. **Vertrauensstreifen** unter den Leistungen: „Keine Agentur. Kein
   Beratungstermin, keine Laufzeit. WERKRUF bereitet vor, du entscheidest
   und gibst frei."

Die Agenturspalte wertet nicht ab. Für einen Betrieb, der gar nichts selbst
machen will, ist eine Agentur die richtige Wahl — und dieser Betrieb ist
nicht die Zielgruppe.

---

## H. Backlog

| Idee | Priorität | MVP? |
|---|---|---|
| Automatische Bewertungsanfragen nach Auftrag (WhatsApp / Mail / SMS) | **HIGH** | Nein |
| Bestehende Google-Fotos anzeigen — Leseroute existiert bereits, wird nur nie aufgerufen | **HIGH** | Nein |
| `trial_reminder` und `trial_ended` reparieren (filtern auf `plan = 'trial'`, ein Wert, den der Constraint verbietet) | **HIGH** | Nein, Stripe deckt es derzeit ab |
| Website-Upsell / WERKRUF WEB | MEDIUM | Nein |
| Website-Qualitätscheck als Upsell-Auslöser | MEDIUM | Nein |
| PDF-Reporting | LOW | Nein |
| Quartals- und Jahrespreis | LOW | Nein |

**Website-Upsell, Weg wie besprochen:**

```
Google websiteUri  →  Website-Audit  →  technische und Conversion-Signale
                   →  website_opportunity  →  optionaler Upsell
```

Prüfkriterien später: Website vorhanden · HTTPS · mobiler Viewport · Title ·
Description · H1 · Kontaktmöglichkeit · Telefon · strukturierte Daten ·
Ladezeit · Konsistenz mit dem Google-Profil. Noch nicht gebaut.

---

## I. Tests

```
74 Suiten, 1203 Tests — alle grün
CI=true npm run build → Compiled successfully
```

Neu in `src/oeffentlicheWahrheit.test.js`, 18 Prüfungen in fünf Gruppen:

- keine Funktion, die es nicht gibt (Autopilot, PDF-Reporting, Check,
  Dashboard-Platzhalter)
- keine unbelegten Zahlen (ROI-Mechanik, 3×, +30 %, 9.120, Erfolgsgarantie)
- der Preis steht vor der Registrierung (Hero und Landingpage, aus der
  Konfiguration statt handgeschrieben)
- alle öffentlichen CTAs haben ein Ziel (`/register` weg, `#check` weg,
  jeder Anker im Kopf hat ein Gegenstück)
- der Kopf kennt den Anmeldezustand

**Zwei Dinge, die diese Tests bewusst nicht tun:** Sie frieren keinen
Marketingtext ein — geprüft wird, was *nicht* behauptet werden darf, und ob
CTAs ein Ziel haben. Und sie entfernen vor jeder Textprüfung die
Kommentare. Das ist kein Detail: Die korrigierten Dateien zitieren die
falschen Sätze in den Kommentaren, die erklären, warum sie weg sind. Ohne
Filter wären die Tests blind — genau daran sind in diesem Projekt schon
zwei Prüfungen gescheitert.

**Drei bestehende Tests angepasst, jeweils an ihrer Absicht entlang:**

| Test | Vorher | Jetzt |
|---|---|---|
| `kreditkartenZusage` / `billingAudit` | lasen nur `pages/Pricing.js` | lesen Preisseite **und** Preiskarte — sonst wären sie grün geblieben, nur weil der Satz in die andere Datei gewandert ist |
| `publicFunnelLanding`, Hero-CTA | suchte den Knopf über seinen Text | sucht ihn über sein Ziel; der Text darf sich ändern |
| `googleProfilVerwalten` | prüfte, dass „noch nicht eingerichtet" erscheint | prüft, dass der Reiter auf die richtige Seite führt |

Die Attrappe in `publicFunnelLanding` hat jetzt einen Preisblock, aber
bewusst **keine** `featureGruppen`, `comparison` und `faq`. Damit läuft
dieser Test über die Rückfallpfade — und prüft nebenbei, dass gastro und
beauty die Seite nicht zerlegen.

---

## J. Bekannte Restpunkte

| Punkt | Klasse | Anmerkung |
|---|---|---|
| **Gastro und Beauty tragen die alten Behauptungen** — Bewertungs-Autopilot, Monatliches Reporting, „Google Maps Top-Platzierung", ROI mit +25 % / +20 % | P2 | Nicht live, `ACTIVE_INDUSTRY = 'handwerk'`. Beide Blöcke haben jetzt einen Warnkopf. Vor einem Start derselbe Abgleich |
| `src/Pricing.js` (538 Zeilen, tot) existiert weiter | P3 | Steht als Stolperdraht in `kreditkartenZusage.test.js` — dort wird geprüft, dass sie **nicht** eingebunden ist. Nicht angefasst |
| 14 unerreichbare Dateien, 4.771 Zeilen | P3 | Löschen erst nach der Entscheidung zum öffentlichen Check |
| Ankerlinks im Kopf sind `<a href>` statt Router-Links | P3 | Voller Seitenneuaufbau. React Router springt nicht von selbst zu einem Hash, und der Anker muss auch von `/impressum` aus funktionieren |
| `quarterPrice` und `annualPrice` stehen weiter in der Konfiguration | P3 | Von keiner Datei gelesen, kommentiert als „nicht beworben" |
| Nach dem Veröffentlichen einer Antwort fehlt das Polling | P1 UX | Kein Text, sondern Entwicklung — Post-MVP |
| Fotogalerie widerspricht dem Score (Google-Fotos zählen, werden aber nie gezeigt) | P1 UX | Backlog HIGH |
| Löschen eines Fotos entfernt es nicht bei Google | P1 | Backlog |
| Sieben Namen für zwei Begriffe | P2 | Öffentlich bereinigt — intern bleibt „Health Score" in drei Dateien und „Autorisierter Health Score" im Onboarding |
| AGB und AVV weiterhin anwaltlich ungeprüft | — | unverändert offen |

---

## K. Empfehlung für den nächsten Schritt

**Browser- und Conversion-Review, nicht der technische E2E-Smoke.**

Was ich schon gemessen habe: Vier Breiten (375, 390, 768, 1280 px), beide
öffentlichen Seiten, **0 px waagerechter Überlauf**, alle sieben Anker
vorhanden. Gesehen habe ich Hero, Leistungen, Vergleich und Preis in
Desktop und auf dem Telefon.

Was eine Maschine nicht beantworten kann und du im Review prüfen solltest:

1. **Der Zehn-Sekunden-Test aus §36.** Lies den Hero wie ein Malermeister,
   der zwischen zwei Terminen aufs Handy schaut. Beantwortet er alle fünf
   Fragen, oder nur vier?
2. **Die Überschrift ist auf dem Telefon fünf Zeilen hoch.** Sie ist stark,
   aber sie drückt die Preiszeile weit nach unten. Das wäre der erste
   Punkt, an dem ich kürzen würde — wenn du es auch so siehst.
3. **Reihenfolge Vergleich vor Preis.** Meine Annahme: Wer erst die drei
   Wege gesehen hat, liest 49 € anders. Das ist begründet, nicht gemessen.
4. **Der Vertrauensstreifen** mit „Keine Agentur" steht vor der
   Vergleichssektion und nimmt ihr vielleicht die Pointe.

Danach erst der E2E-Smoke. Die Reihenfolge ist richtig herum: Ein Durchlauf
durch eine Seite, die danach umgebaut wird, ist ein Durchlauf, den man
wiederholen muss.
