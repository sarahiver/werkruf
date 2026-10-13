# Fremdkundenfälle A–G

Stand: 13. Oktober 2026 (Paket H1, §35). Für diese Analyse wurden keine
Migrationen in Produktion ausgeführt, keine Mails verschickt und keine
Google-Daten verändert.

Die Frage hinter allen sieben Fällen ist die Leitfrage von H1: **Kann ein
Betrieb, der WERKRUF noch nie benutzt hat, heute sauber starten?**

---

## Woher die Aussagen kommen

§36 verlangt, vier Arten von Belegen zu trennen. Jede Zeile der Matrix nennt
ihre Art:

| Art | Bedeutung |
|---|---|
| **automatisierter Test** | läuft in CI, Beweis in einer Testdatei |
| **Codepfad** | am Quelltext nachvollzogen, aber nicht ausführbar getestet (etwa weil Google antworten müsste) |
| **Fremdaccount-Smoke** | braucht einen echten fremden Google-Account — offen, siehe `docs/operations/fremdaccount-smoke.md` |
| **noch nicht reproduzierbar** | lässt sich derzeit mit keinem Mittel herstellen |

Keine Zeile behauptet, real getestet zu sein, wenn nur ein Mock lief.

---

## Der Befund, der die Matrix zusammenzieht

**B, D und G sind für WERKRUF ein einziger Zustand.** Google liefert in allen
drei Fällen dasselbe: eine leere Standortliste, ohne Begründung.

```
B   Profil existiert, Konto darf es nicht verwalten
D   es gibt überhaupt kein Unternehmensprofil          →  locations = []
G   OAuth erfolgreich, aber 0 Locations
```

Drei Ursachen, ein beobachtbarer Zustand. Daraus folgt eine Produktregel, die
in der Engine wortwörtlich steht: *„Woran es liegt, sagt Google uns nicht."*
Wer hier eine Diagnose stellt, rät — und schickt den Kunden auf die Suche nach
einem Fehler, den es vielleicht nicht gibt.

Unterscheiden ließen sich die drei erst über zusätzliche Google-Aufrufe
(`accounts.list`, `verifications`), und auch dann nur teilweise. Das ist kein
H1-Thema, aber ein ehrlicher Restpunkt.

---

## Die Matrix

| Fall | UI-Zustand | Score | Engine | Mail | nächste Aktion | MVP-fähig | Belegart |
|---|---|---|---|---|---|---|---|
| **A** verifiziert + verwaltbar | normales Dashboard, Betrieb benannt | Wert aus den echten Daten | alle Betriebsregeln | Weekly + Alert, wenn Plan berechtigt | was die Engine obenauf legt | **ja** | automatisierter Test; Google-Seite: Fremdaccount-Smoke |
| **B** Profil existiert, Konto darf nicht | „Noch kein Betrieb verbunden" | **kein Score** (`keine_betriebe`), keine 0 | `account.no_locations`, kritisch, nicht wegklickbar | **keine** operative Mail (Weekly `skip`, Alert-Kanal filtert auf Bewertungsereignisse) | „Zugriff auf dein Unternehmensprofil prüfen" → `/dashboard/google` | **ja**, mit der Einschränkung unten | automatisierter Test (Zustand); Ursache: nicht unterscheidbar |
| **C** mehrere Locations | „Welchen Betrieb möchtest du ansehen?" | **kein Score** (`kein_standort`) bis zur Auswahl | Betriebsregeln je Standort, Konto getrennt | Weekly `skip` mit `mehrere_ohne_auswahl` | „Betrieb auswählen" → `/dashboard/google` | **ja** | automatisierter Test |
| **D** kein Google Business Profile | wie B | wie B | wie B | wie B | wie B | **ja** | automatisierter Test (Zustand) |
| **E** Location unvollständig / nicht verifiziert | normales Dashboard; auf `/dashboard/google` **alle Schreibfelder gesperrt** mit Grund; ohne `place_id` kein Bewertungslink, mit eigenem Hinweis | Wert aus den vorhandenen Feldern, fehlende senken ihn | `profile.incomplete`, `profile.photos_missing` usw. — ohne Kenntnis des Verifizierungsstands | wie A | „Angaben ergänzen"; zuerst aber die Bestätigung durch Google | **ja**, siehe Einschränkung | automatisierter Test (Sperre und Zustand); echte Google-Antwort: Fremdaccount-Smoke |
| **F** OAuth abgebrochen / verweigert | „nicht verbunden" plus Klartextmeldung zum Code | kein Score | `connection.missing` | keine | „Google-Profil verbinden" | **ja** | automatisierter Test (Meldungen); echter OAuth-Abbruch: Fremdaccount-Smoke |
| **G** OAuth ok, 0 Locations | wie B | wie B | wie B | wie B | wie B | **ja** | automatisierter Test (Zustand) |

### Zwei Zwischenzustände, die in §35 nicht stehen und trotzdem auftreten

| Lage | UI-Zustand | Warum eigens |
|---|---|---|
| Import läuft noch | „Deine Betriebe werden geladen" | Das ist die erste Minute nach dem Verbinden. „Google hat keinen Betrieb zurückgegeben" wäre dort eine Diagnose über einen Lauf, der noch unterwegs ist. |
| Import gescheitert | „Betriebe konnten nicht geladen werden", WERKRUF wiederholt es | Ein Fehlschlag ist kein Ergebnis. Der Kunde soll nicht in seinen Google-Einstellungen nach einer Ursache suchen, die bei uns liegt. |

---

## Einschränkungen, ausgeschrieben

**B / D / G — die Ursache bleibt offen.** Der Zustand ist sauber, die Aktion
führt zur richtigen Seite, und dort stehen die zwei Dinge, die der Kunde selbst
prüfen kann (richtiges Google-Konto, Inhaber- oder Administratorrolle). Was
WERKRUF nicht leistet: sagen, welches der drei Probleme vorliegt.

**E — unterschieden beim Schreiben, nicht beim Bewerten.** Google liefert in
`metadata` unter anderem `hasVoiceOfMerchant`, und der Sync legt `metadata`
vollständig in `google_locations.google_profile` ab.

Ausgewertet wird es dort, wo es zählt: `istBearbeitbar`
(`src/utils/gbpFieldModel.js`) sperrt bei `hasVoiceOfMerchant === false`
**jedes** Schreibfeld mit dem Grund „Google hat die Kontrolle über dieses
Profil noch nicht bestätigt. Änderungen würden übermittelt, aber nicht
veröffentlicht." Die Oberfläche zeigt ihn einmal oben statt zwanzigmal am
Feld, und `handleLocationUpdate` prüft dieselbe Bedingung noch einmal
verbindlich — ein Aufrufer, der die Oberfläche umgeht, kommt nicht durch.

*Erste Fassung dieser Analyse behauptete, das Feld werde nirgends gelesen. Das
war falsch; der Test dazu hat es gefangen, und die Zeile oben ist korrigiert.*

Die Lücke ist enger, als es zunächst aussah, aber sie ist da: **Score, Engine
und Mails kennen den Verifizierungsstand nicht.** Ein unverifizierter Betrieb
bekommt also einen Wert und Aufgaben, von denen ein Teil erst nach der
Bestätigung durch Google wirkt. Für den MVP vertretbar — der Kunde erfährt es
in dem Moment, in dem er etwas ändern will — aber keine Entscheidung, sondern
eine Lücke.

**F — der echte Abbruch ist nicht automatisiert geprüft.** Die Meldungen zu
`oauth_denied`, `insufficient_scope` und `missing_refresh_token` sind getestet;
dass Google genau diese Fälle so zurückmeldet, steht erst nach dem
Fremdaccount-Smoke fest.

**Alle Fälle — die Google-Seite fehlt.** Jede Zeile der Matrix sagt: *wenn* die
Daten so aussehen, *dann* verhält sich das Produkt so. Dass Google sie in der
jeweiligen Lage tatsächlich so liefert, ist eine Aussage über Google und
gehört in den Smoke-Test.

---

## Wo die Belege liegen

| Fall | Testdatei |
|---|---|
| A, B, C, D, E, F, G (Zustände) | `src/fremdkundenfaelleAG.test.js` |
| kein Score ohne Betrieb | `src/hooks/scoreOhneStandort.test.js` |
| Dashboard-Zustand ohne Betrieb, inkl. Import-Zwischenzustände | `src/hooks/briefingKeineBetriebe.test.js` |
| Engine-Regel `account.no_locations` | `src/utils/kontoRegelOhneBetrieb.test.js` |
| Aufgabenkarte ohne Betrieb | `src/components/dashboard/naechsteSchritte.test.js` |
| Auswahlregel bei mehreren Betrieben | `src/hooks/ausgewaehlterStandort.test.js` |
| Bewertungslink und `place_id` | `src/pages/dashboard/kundenGewinnungPlaceId.test.js` |
| Schreibsperre ohne Voice of Merchant | `src/components/dashboard/googleProfilVerwalten.test.js`, `supabase/tests/gbpFieldModel.server.test.mjs` |
| automatische Auswahl bei genau einem Betrieb | `supabase/tests/autoAuswahl.test.sql` |
| Weekly/Alert nur für berechtigte Pläne | `supabase/tests/operativeMails.test.sql` |
| Wochenmail bei 0 bzw. mehreren Betrieben: `skip` | `supabase/tests/weeklyEngineEvents.test.sql` |

---

## Was dieser Analyse noch fehlt

Der Fremdaccount-Smoke nach §59 ist **nicht durchgeführt**. Er braucht einen
fremden Google-Account mit einem echten Unternehmensprofil; Iver's bestehende
S&I.- und WERKRUF-Konten sind laut §59 ausdrücklich nicht geeignet. Der Ablauf
steht Schritt für Schritt in `docs/operations/fremdaccount-smoke.md`, mit den
Abfragen, an denen jeder Schritt zu belegen ist.
