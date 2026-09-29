# Google-API-Monitoring — Einrichtung und Betrieb

Stand: 29. September 2026

Erkennt täglich, ob Google an den von WERKRUF verwendeten
Business-Profile-APIs etwas geändert hat, und meldet es über das
bestehende Betriebsalarmsystem.

**Das Monitoring ändert nichts.** Es erkennt und benachrichtigt. Ob und
wann WERKRUF angepasst wird, entscheidest du nach Erhalt der Mail.

---

## Zwei getrennte Prüfwege

| | Schema | Change Log |
|---|---|---|
| Quelle | Discovery-Dokumente aller acht APIs | `developers.google.com/my-business/content/change-log` |
| Verglichen wird | Prüfsumme der normalisierten Struktur | Normalisierter Inhalt je datiertem Eintrag |
| Erkennt | Felder, Typen, Methoden, Parameter, Enum-Werte, Abkündigungen | Neue **und nachträglich geänderte** Einträge |
| Alarmschlüssel | je API | eigener |
| `revision` | wird gespeichert, ersetzt aber **nicht** den Strukturvergleich | keine vorhanden |

**Warum `revision` den Vergleich nicht ersetzt:** Google My Business v4
trägt dauerhaft `revision: "0"`. Wer sich auf das Feld verließe, würde
dort nie etwas erkennen. Der Strukturvergleich läuft deshalb bei jedem
Lauf, für jede Quelle.

---

## Eingeschränkte Überwachung bei Google My Business v4

**Das ist die wichtigste Einschränkung dieses Monitorings.**

Der von Google dokumentierte Discovery-Endpunkt
`https://mybusiness.googleapis.com/$discovery/rest?version=v4`
antwortet mit **404**. Google veröffentlicht stattdessen eine statische
Beispieldatei unter `developers.google.com/static/my-business/samples/`.

Daraus folgen zwei Lücken:

| | |
|---|---|
| **Kein Revisionssignal** | `revision: "0"`, dauerhaft |
| **Veraltet** | Die Datei ist älter als die Referenzdokumentation. Bekannt fehlen unter anderem Felder auf `accounts.locations.reviews` |

**Was das praktisch heißt:** Ändert Google die v4-API, ohne die
statische Datei zu aktualisieren, erkennt der Schema-Vergleich das
**nicht**. Das Change Log fängt einen Teil davon auf — aber nur, wenn
Google die Änderung dort auch beschreibt.

Statische Datei und Change Log **ergänzen einander, garantieren aber
keine vollständige Erkennung aller v4-Änderungen.**

Das trifft ausgerechnet die API, über die WERKRUF Bewertungen,
Antworten und Medien abwickelt — 47 schreibende Methoden, 983 Felder.

**Empfehlung:** Bei Arbeiten an Bewertungen oder Medien nicht allein auf
das Monitoring verlassen, sondern die Referenzdokumentation
gegenprüfen.

---

## Was die öffentlichen Quellen NICHT abdecken

Discovery-Dokumente beschreiben die **Struktur** der APIs. Sie enthalten
keine dynamischen Inhalte. Folgendes ändert sich ohne jede
Schema-Änderung und bleibt damit unsichtbar:

| Metadatum | Endpunkt | Warum unsichtbar |
|---|---|---|
| **Unternehmenskategorien** | `categories.list` | Google fügt Kategorien laufend hinzu und entfernt sie. Das Schema von `Category` bleibt dabei unverändert |
| **Verfügbare Attribute** | `attributes.list` | Das Schema sagt ausdrücklich: „Available attributes are determined by Google and may be added and removed **without API changes**" |
| **Attributwerte und Gruppen** | `attributes.list` | Anzeigenamen, Wertelisten und Gruppierung je Kategorie und Region |
| **Service-Typen** | `categories.batchGet` mit `view=FULL` | Je Kategorie unterschiedlich, laufend ergänzt |
| **Zusätzliche Öffnungszeitentypen** | `categories.batchGet` | `moreHoursTypes` je Kategorie |
| **Unterstützte Aktionstypen** | Place Actions | Je Standort und Region unterschiedlich |

**Alle sechs brauchen authentifizierten Zugriff** mit `business.manage`
und verbrauchen Quota. Das Monitoring ruft sie deshalb **nicht** ab —
es arbeitet ausschließlich mit öffentlichen, unauthentifizierten
Quellen.

### Was eine spätere Erweiterung kosten würde

Wollte man diese Metadaten überwachen, wäre das ein eigener Prüfweg mit
eigenen Regeln:

- **Beschränkung auf das Nötige.** Keine weltweite Kategorienabfrage.
  Für WERKRUF: `regionCode=DE`, `languageCode=de`, und nur die
  Kategorien, die bei verbundenen Betrieben tatsächlich vorkommen.
- **Eigene Taktung.** Täglich wäre Verschwendung; wöchentlich reicht.
- **Getrennte Alarmschlüssel.** Eine neue Google-Kategorie ist kein
  API-Schema-Befund und darf nicht so gemeldet werden.
- **Eigene Quota-Rechnung.** `attributes.list` je Standort und
  `categories.batchGet` je Kategorie summieren sich.

Nicht Teil von Paket 3. Die Spezifikation verlangt die Trennung von
Schema und dynamischen Katalogen ausdrücklich — sie ist hier so
umgesetzt, dass die Kataloge gar nicht erst mit erfasst werden.

---

## Einrichtung

### 1. Migration einspielen

`supabase/migrations/20260929160000_gbp_api_monitor.sql` im SQL Editor.

```sql
select count(*) from information_schema.tables
 where table_schema = 'public' and table_name like 'gbp_api%';
-- erwartet: 2
```

### 2. ops_alerts() ergänzen

Damit wiederholte Monitoring-Ausfälle im Betriebsalarm erscheinen, den
Abschnitt aus dem Kommentar am Ende der Migration in `ops_alerts()`
einfügen — vor dem `return`. Bewusst nicht automatisch: `ops_alerts()`
wird an mehreren Stellen gepflegt, und ein blindes `create or replace`
würde spätere Änderungen überschreiben.

### 3. Function deployen

Ordner `supabase/functions/gbp-api-monitor/` und die ergänzte
`config.toml` ins Repo, committen.

### 4. Probelauf ohne Speichern

```sql
select net.http_post(
  url     := 'https://kueoozsfkevmncucrdjd.supabase.co/functions/v1/gbp-api-monitor',
  headers := jsonb_build_object(
               'Content-Type',    'application/json',
               'X-Worker-Secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'gbp_worker_secret')),
  body    := '{"dryRun": true}'::jsonb,
  timeout_milliseconds := 60000);
```

```sql
select id, status_code, content from net._http_response order by id desc limit 1;
```

Erwartet: `{"ok":true,"dryRun":true,"befunde":[…]}` mit neun Einträgen
— acht Schema-Quellen plus Change Log — und `"ergebnis":"basis"` bei
jedem, weil noch kein Schnappschuss existiert.

### 5. Ausgangsbasis anlegen

Denselben Aufruf ohne `dryRun`. **Der erste erfolgreiche Lauf legt die
Ausgangsbasis an und meldet nichts** — es gibt nichts zu vergleichen.

```sql
select * from public.ops_gbp_api_monitor;
```

Erwartet: neun Zeilen, `fehlversuche = 0`, `offene_meldungen = 0`.

### 6. Cronjob einrichten

**Nicht produktiv ausführen, bevor Schritt 5 sauber durchgelaufen ist.**

```sql
select cron.schedule('gbp-api-monitor', '30 5 * * *', $job$
  select net.http_post(
    url     := 'https://kueoozsfkevmncucrdjd.supabase.co/functions/v1/gbp-api-monitor',
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'X-Worker-Secret', (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'gbp_worker_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000);
$job$);
```

**Zur Uhrzeit:** `pg_cron` arbeitet in der Zeitzone der Datenbank.
Supabase-Instanzen laufen in **UTC**. `30 5 * * *` ist also 05:30 UTC —
in Deutschland 07:30 MESZ beziehungsweise 06:30 MEZ. Der Lauf findet
damit ganzjährig vor Arbeitsbeginn statt, und die Mail liegt morgens im
Postfach.

Prüfen:

```sql
select jobname, schedule, active from cron.job where jobname = 'gbp-api-monitor';
select count(*) as platzhalter from cron.job where command like '%<%';
```

`platzhalter` muss 0 sein — Falle 11 aus dem Übergabedokument.

---

## Empfänger der Alarmmail

Die Function verwendet dieselbe Umleitung wie alle anderen Mailwege:

| `EMAIL_DELIVERY_MODE` | Empfänger |
|---|---|
| `test` | `EMAIL_TEST_RECIPIENT` |
| `production` | `ADMIN_EMAIL` |
| alles andere | Fehler, kein Versand |

**Für die Abnahme auf `test` lassen.** Erst nach einem beobachteten
echten Lauf auf `production` umstellen.

---

## Was keinen Alarm auslöst

| Fall | Verhalten |
|---|---|
| Erster erfolgreicher Lauf | Ausgangsbasis, kein Alarm |
| Unveränderte Prüfsumme | nichts |
| Bereits gemeldete Änderung | nichts — Signatur über Art und Pfad aller Unterschiede |
| Fehlgeschlagener Abruf | **kein** Änderungsalarm. Der Schnappschuss bleibt unangetastet, nur `fehlversuche` steigt |
| Change Log nicht lesbar | Ausfall, keine Änderung. Sonst meldete ein Layoutumbau eine geleerte Historie |
| Layoutänderung, Fußzeile, „Last updated" | nichts — die Auswertung schneidet sie ab |

**Eine spätere, andere Änderung meldet wieder.** Die Signatur ist dann
eine andere.

**Wiederholte Ausfälle sind ein eigener Befund.** Ab drei Fehlversuchen
erscheint die Quelle in `gbp_monitor_failures(3)` und über die
Ergänzung aus Schritt 2 als `gbp_monitor.stalled` im Betriebsalarm —
getrennt von jedem API-Befund.

---

## Einstufung der Meldungen

| Stufe | Wann |
|---|---|
| **Kritisch** | Brechende Änderung oder Abkündigung in einer API, die WERKRUF **produktiv aufruft** |
| **Handlungsbedarf** | Brechende Änderung in einer ungenutzten API, oder Neuerung in einer genutzten |
| **Information** | Neuerung in einer API, die WERKRUF nicht aufruft |

Die Einstufung stützt sich auf zwei Tatsachen: die Art der Änderung und
ob der Dienst-Hostname im WERKRUF-Code vorkommt. Keine Behauptung
darüber hinaus.

Change-Log-Einträge werden zurückhaltender eingestuft — ein Text ist
kein Schema-Diff. **Kritisch** nur, wenn der Eintrag selbst eine
Abschaltung ankündigt (`sunset`, `deprecated`, `will be removed`,
`no longer`, `discontinued`, `shut down`, `end of life`).

---

## Nachsehen

```sql
-- Zustand je Quelle
select * from public.ops_gbp_api_monitor;

-- Offene Meldungen
select jsonb_pretty(public.gbp_monitor_pending());

-- Historie einer Quelle
select erkannt_am, stufe, anzahl, gemeldet_am
from public.gbp_api_changes
where quelle = 'businessinformation'
order by erkannt_am desc;

-- Ausfälle
select * from public.gbp_monitor_failures(1);
```

---

## Tests

| Was | Wie |
|---|---|
| Vergleich, Einstufung, Change-Log-Auswertung, Signaturen | `src/monitoring/gbpApiDiff.test.js` — 31 Tests in Jest |
| Ausgangsbasis, Ausfallverhalten, Signatur-Entprellung, getrennte Prüfwege | `supabase/tests/gbpApiMonitor.test.sql` — 11 Szenarien **gegen echten Postgres** |

Der SQL-Test braucht die Rollen `anon`, `authenticated`, `service_role`:

```bash
psql -c "create role anon; create role authenticated; create role service_role;"
psql -f supabase/migrations/20260929160000_gbp_api_monitor.sql
psql -f supabase/tests/gbpApiMonitor.test.sql
```

---

## Verifikationsstand

| Prüfung | Art |
|---|---|
| Migration läuft und ist wiederholbar | **gegen echten Postgres 16 ausgeführt** |
| Ausgangsbasis ohne Alarm | **gegen echten Postgres ausgeführt** |
| Ausfall überschreibt Schnappschuss nicht | **gegen echten Postgres ausgeführt** |
| Signatur verhindert Doppelmeldung, neue Änderung meldet wieder | **gegen echten Postgres ausgeführt** |
| Schema-Vergleich, Einstufung, Change-Log-Zerlegung | **in Jest ausgeführt (31 Tests)** |
| Abruf der acht Discovery-Quellen | **im GitHub-Workflow ausgeführt (8/8)** |
| Edge Function gegen die echten Quellen | **ungeprüft** — braucht Deployment |
| Alarmmail tatsächlich empfangen | **ungeprüft** — braucht einen echten Lauf |
| Cronjob | **nicht eingerichtet** — SQL liegt oben zur Prüfung bereit |
