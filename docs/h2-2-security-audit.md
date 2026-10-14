# H2.2 A und B — EXECUTE-Rechte

Stand: 14.10.2026.

**A ist gemessen, der P0 ist in Produktion bestätigt. B (Schreibseite)
und die Leseseite sind gebaut und nicht angewandt.** C–F sind nicht
begonnen (§2).

Ablauf: Abschnitt 1 ist die Abfrage, die in Produktion gelaufen ist.
Abschnitt 3 ist ihr Ergebnis. Abschnitt 4 bis 7 ist die Klassifikation,
auf der alles Weitere beruht. Abschnitt 9 ist die Schreibseite,
Abschnitt 10 die Leseseite, Abschnitt 11 das Anwenden.

---

## 1. Die Messabfrage

Supabase Dashboard → SQL Editor. Die Abfrage ist lesend; sie verändert
nichts. Gelaufen am 14.10.2026; Ergebnis in Abschnitt 3. Dieselbe
Abfrage dient nach dem Apply als Abnahme (Abschnitt 10).

Die Auftrags-Abfrage aus §3 liefert eine Tabelle, die der SQL-Editor
nicht vollständig anzeigt, wenn mehrere Statements hintereinander
stehen. Deshalb unten **ein** Statement, das alles als Textzeilen
zurückgibt — fachlich identisch zur Auftrags-Abfrage, plus zwei
Spalten, die §3 offen lässt (Rechte-Herkunft, Trigger).

```sql
with f as (
  select
    p.oid,
    p.proname                                                 as name,
    pg_get_function_identity_arguments(p.oid)                 as args,
    p.provolatile                                             as vola,
    p.proacl is null                                          as vorgabe,
    has_function_privilege('public',        p.oid, 'execute')  as pub,
    has_function_privilege('anon',          p.oid, 'execute')  as anon,
    has_function_privilege('authenticated', p.oid, 'execute')  as auth,
    has_function_privilege('service_role',  p.oid, 'execute')  as svc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
),
z as (
  select
    count(*) filter (where vola = 'v')                          as v_alle,
    count(*) filter (where vola = 'v' and pub)                  as v_pub,
    count(*) filter (where vola = 'v' and not pub and auth)     as v_auth,
    count(*) filter (where vola = 'v' and not pub and not auth) as v_zu,
    count(*) filter (where vola = 'v' and vorgabe)              as v_vorgabe,
    count(*) filter (where vola = 's')                          as s_alle,
    count(*) filter (where vola = 's' and pub)                  as s_pub,
    count(*) filter (where vola = 's' and not pub and auth)     as s_auth
  from f
)
select '1 ZUSAMMENFASSUNG' as block, 'definer+volatile gesamt: '      || v_alle    as zeile from z
union all select '1 ZUSAMMENFASSUNG', 'davon PUBLIC offen: '          || v_pub     from z
union all select '1 ZUSAMMENFASSUNG', 'davon nur authenticated: '     || v_auth    from z
union all select '1 ZUSAMMENFASSUNG', 'davon geschlossen: '           || v_zu      from z
union all select '1 ZUSAMMENFASSUNG', 'davon ACL = Vorgabe (null): '  || v_vorgabe from z
union all select '1 ZUSAMMENFASSUNG', 'definer+stable gesamt: '       || s_alle    from z
union all select '1 ZUSAMMENFASSUNG', 'definer+stable PUBLIC offen: ' || s_pub     from z
union all select '1 ZUSAMMENFASSUNG', 'definer+stable nur auth: '     || s_auth    from z
union all
select '2 VOLATILE OFFEN',
       name || '(' || args || ')'
         || ' | pub=' || pub || ' anon=' || anon || ' auth=' || auth || ' svc=' || svc
         || ' | ' || case when vorgabe then 'vorgabe' else 'ausdruecklich' end
from f where vola = 'v' and (pub or anon or auth)
union all
select '3 STABLE OFFEN',
       name || '(' || args || ')'
         || ' | pub=' || pub || ' anon=' || anon || ' auth=' || auth || ' svc=' || svc
         || ' | ' || case when vorgabe then 'vorgabe' else 'ausdruecklich' end
from f where vola = 's' and (pub or anon or auth)
union all
select '4 TRIGGER',
       t.tgname || ' auf ' || tn.nspname || '.' || c.relname || ' -> ' || p.proname
from pg_trigger t
join pg_proc p       on p.oid = t.tgfoid
join pg_class c      on c.oid = t.tgrelid
join pg_namespace tn on tn.oid = c.relnamespace
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal and pn.nspname = 'public' and p.prosecdef
order by 1, 2;
```

### 1.1 Wirkungsprobe statt Katalogwert

Auftrag §11: „Nicht nur Quelltext nach `revoke` durchsuchen.
Tatsächliche DB-Rechte messen." Der Katalog sagt, welches Recht
eingetragen ist. Die folgenden drei Blöcke sagen, was eine fremde Rolle
tatsächlich ausführen darf. Jeder Block einzeln ausführen.

Die UUID `00000000-0000-0000-0000-000000000000` trifft keine Zeile. Die
Funktionen sind reine `update`/`select`-Pfade, also passiert auch bei
einem Commit nichts — es gibt keine Zeile zum Ändern.

```sql
-- Probe 1: darf anon den Plan fremder Nutzer setzen?
begin;
set local role anon;
select public.update_user_plan('00000000-0000-0000-0000-000000000000'::uuid, 'free');
rollback;
```

```sql
-- Probe 2: darf ein eingeloggter Kunde das?
begin;
set local role authenticated;
select public.update_user_plan('00000000-0000-0000-0000-000000000000'::uuid, 'free');
rollback;
```

```sql
-- Probe 3: darf anon fremde Score-Daten lesen? (ausserhalb §3, siehe 7.)
begin;
set local role anon;
select public.compute_health_score('00000000-0000-0000-0000-000000000000'::uuid);
rollback;
```

So liest sich das Ergebnis:

| Ausgabe | Bedeutung |
| --- | --- |
| `ERROR: permission denied for function …` | Recht fehlt, Funktion ist zu |
| Ergebniszeile ohne Fehler | **Recht vorhanden, Funktion ist offen** |
| anderer Fachfehler (z. B. „ist nicht veröffentlicht") | Recht vorhanden, nur die Daten passen nicht |

**Nicht proben:** `run_sync_maintenance`, `prune_*`, `release_stuck_*`,
`purge_unconfirmed_accounts`, `cleanup_stripe_events`. Diese Funktionen
löschen echte Zeilen, unabhängig von der übergebenen UUID. Ihre Rechte
stehen in der Messabfrage; eine Wirkungsprobe darf hier nicht laufen.

---

## 2. Warum `has_function_privilege` und nicht nur `aclexplode`

Das ist der Punkt, an dem eine Prüfung lautlos falsch wird.

Bei 46 der gemessenen Funktionen ist `pg_proc.proacl` **null**. Null
heißt nicht „keine Rechte", sondern „die PostgreSQL-Vorgabe gilt" — und
die Vorgabe für Funktionen ist `EXECUTE` für `PUBLIC`. `PUBLIC` schließt
`anon` und `authenticated` ein.

Eine Abfrage, die nur `aclexplode(proacl)` auswertet, liefert für diese
46 Funktionen **null Zeilen** und sieht damit aus wie „nichts offen".
Genau die kritischen Fälle fehlen dann.

`has_function_privilege('public', oid, 'execute')` löst die Vorgabe
korrekt auf und gibt für diese Funktionen `true`. Deshalb steht in der
Abfrage oben beides: der Rechte-Wert **und** die Herkunft
(`vorgabe` / `ausdruecklich`).

Zweiter lautloser Fehler, derselbe Mechanismus: `sync_events` existiert
in drei Überladungen. Nur die 4-Argument-Fassung ist gehärtet, die
beiden alten sind offen. Eine Härtung oder Prüfung **nach Namen** statt
nach vollständiger Signatur übersieht das.

---

## 3. Ergebnis — Produktion, gemessen am 14.10.2026

| Messgröße | Produktion | Testdatenbank |
| --- | --- | --- |
| `SECURITY DEFINER` + `VOLATILE` in `public` | 82 | 82 |
| davon für `PUBLIC` ausführbar | **46** | 46 |
| davon nur für `authenticated` | 5 | 4 |
| davon geschlossen | 31 | 32 |
| davon mit `proacl is null` (Vorgabe) | **0** | 46 |
| `SECURITY DEFINER` + `STABLE` in `public` | 29 | 29 |
| davon für `PUBLIC` ausführbar | 14 | 14 |
| davon nur für `authenticated` | 9 | 6 |

Die 46 Signaturen sind Zeichen für Zeichen identisch mit der
Testdatenbank — 46 von 46, maschinell verglichen. Die Migration in
Abschnitt 9 steht damit auf Produktionssignaturen, nicht auf
Testwerten (§6).

Drei Abweichungen, alle erklärbar:

- **`proacl is null`: 0 statt 46.** In Produktion steht bei allen 46 ein
  ausdrücklicher ACL-Eintrag mit leerem Empfänger, also `=X/postgres`,
  und das ist PUBLIC. Fachlich derselbe Befund, nur anders eingetragen:
  die Rechte sind da. Praktische Folge für B: ein `revoke … from anon,
  authenticated` allein würde nichts bewirken, weil das Recht über
  PUBLIC weiter ankommt. Die Migration entzieht deshalb zuerst PUBLIC.
- **`resolve_stale_events(uuid, jsonb, uuid)`** ist in Produktion für
  `authenticated` offen, in der Testdatenbank zu. Kein
  Frontend-Aufrufer, keine `auth.uid()`-Prüfung, Aufrufer ist die Edge
  Function mit `service_role`. Kommt in B mit.
- **Drei weitere `STABLE`-Funktionen** sind in Produktion für
  `authenticated` offen: `build_location_evaluation_context`,
  `weekly_mail_events`, `weekly_payload_for`. Sie gehören zum offenen
  Lesebefund in Abschnitt 7.

### 3.1 Wirkungsproben — Produktion

| Probe | Ergebnis |
| --- | --- |
| `anon` → `update_user_plan(0000…, 'free')` | **ausgeführt, kein `permission denied`** |
| `authenticated` → dasselbe | **ausgeführt** |
| `anon` → `compute_health_score(0000…)` | `{"grund": "kein_standort", "score": null, "scoreVersion": 1}` |

Damit ist der P0 nicht mehr Vermutung. Die Null-UUID traf keine Zeile,
also hat keine der Proben etwas verändert. Probe 3 belegt zusätzlich
den Lesebefund aus Abschnitt 7: `SECURITY DEFINER` umgeht RLS auch beim
Lesen, und `anon` bekommt eine Antwort.

### 3.2 Trigger — Produktion

Alle vier erwarteten Trigger existieren:

```text
on_auth_user_created              auf auth.users  -> handle_new_user
on_user_confirmed_send_welcome    auf auth.users  -> on_user_confirmed_send_welcome
on_user_deleted                   auf auth.users  -> anonymise_user_on_delete
recommendation_events_location    auf public.recommendation_events
                                                  -> recommendation_events_set_location
```

Das ist der Punkt, an dem B Produktion brechen könnte. Siehe 9.3.

---

## 4. Klassifikation der 46 offenen Funktionen

Kategorien nach Auftrag §4. „Aufrufer" heißt: im Repo belegt, nicht
vermutet. Gesucht wurde in `src/**` (`rpc('name')`), in
`supabase/functions/**`, in allen Migrationen und in den
`cron.schedule`-Kommandos.

Wichtig für §5: **alle** Edge-Function-Aufrufe dieser Funktionen laufen
über `adminClient()` bzw. `supabaseAdmin`, also mit
`SUPABASE_SERVICE_ROLE_KEY`. Geprüft in `google-business`, `send-email`,
`ops-alert`, `gbp-api-monitor`, `request-profile-report`,
`generate-review-reply`, `smartcheck-lead`, `stripe-webhook`,
`create-checkout-session`, `admin-ops`, `delete-account`,
`create-portal-session`, `cloudinary-sign-upload`.

Fünf Functions legen zusätzlich einen Client mit dem Anon-Key an
(`create-checkout-session`, `admin-ops`, `delete-account`,
`create-portal-session`, `cloudinary-sign-upload`). Dieser Client wird
ausschließlich für `auth.getUser()` benutzt; kein einziges `.rpc(` läuft
darüber. In `admin-ops` ruft `admin.rpc('compute_health_score', …)` über
den Service-Role-Client. Keine dieser 46 Funktionen braucht also `anon`
oder `authenticated`.

| Funktion | Kategorie | Aufrufer (belegt) | fremde ID als Argument | Wirkung |
| --- | --- | --- | --- | --- |
| `anonymise_user_on_delete` | Trigger/internal | kein Trigger in der Testdatenbank gefunden; in Produktion auf auth.users erwartet | nein | loescht/anonymisiert Profildaten |
| `begin_sync_run` | service-only | Edge google-business (service_role) | nein | schreibt sync_runs |
| `check_rate_limit` | service-only | Edge google-business, generate-review-reply, smartcheck-lead (service_role) | nein | verbraucht Rate-Limit-Zaehler fremder Schluessel |
| `claim_reply_for_publishing` | service-only | Edge google-business (service_role) | ja (reply_id) | setzt fremde Antwort auf publishing |
| `claim_sync_jobs` | service-only | Edge google-business (service_role) | nein | zieht Jobs aus der Warteschlange |
| `cleanup_expired_oauth_states` | service-only | Edge google-business + run_sync_maintenance | nein | loescht OAuth-States |
| `cleanup_stripe_events` | unklar | kein Aufrufer im Repo | nein | loescht die Stripe-Idempotenztabelle |
| `complete_recommendations_for` | service-only | Edge google-business (service_role) | ja (user_id) | schliesst Empfehlungen fremder Nutzer ueber record_recommendation_action |
| `complete_reply_publication` | service-only | Edge google-business (service_role) | ja (reply_id) | markiert fremde Antwort als veroeffentlicht |
| `enqueue_sync_job` | service-only | Edge google-business (service_role) | ja (user_id) | legt Google-Sync-Jobs fuer fremde Nutzer an |
| `fail_reply_publication` | service-only | Edge google-business (service_role) | ja (reply_id) | setzt fremde Antwort auf fehlgeschlagen |
| `finish_sync_job` | service-only | Edge google-business (service_role) | ja (job_id) | beendet fremde Jobs |
| `finish_sync_run` | service-only | Edge google-business (service_role) | ja (run_id) | beendet fremde Sync-Laeufe |
| `handle_new_user` | Trigger/internal | kein Trigger in der Testdatenbank gefunden; in Produktion auf auth.users erwartet | nein | legt user_profiles an |
| `mark_events_delivered` | Cron/internal | schedule_communications und Weekly-Pfade (SQL) | ja (event_ids) | markiert fremde Events als zugestellt |
| `mark_recommendations_seen` | service-only | Edge google-business (service_role) | ja (user_id) | schreibt ueber record_recommendation_action |
| `measure_recommendation_impact` | Cron/internal | run_sync_maintenance | nein | schreibt Impact-Messungen |
| `on_user_confirmed_send_welcome` | Trigger/internal | kein Trigger in der Testdatenbank gefunden; in Produktion auf auth.users erwartet | nein | stellt Willkommensmail in die Queue |
| `ops_alert_mark_sent` | service-only | Edge ops-alert (service_role) | nein | markiert Alarme als gesendet |
| `ops_alerts` | service-only | Edge ops-alert (service_role) | nein | liest Betriebslage |
| `ops_alerts_pending` | service-only | Edge ops-alert (service_role) | nein | schreibt Alarmzustand |
| `ops_cron_failures` | Cron/internal | ops_alerts | nein | liest Cron-Fehler |
| `ops_health_check` | service-only | Edge google-business (service_role) | nein | liest Betriebslage |
| `ops_http_errors` | Cron/internal | ops_alerts | nein | liest HTTP-Fehler |
| `ops_placeholder_check` | Cron/internal | ops_alerts | nein | liest Platzhalter-Pruefung |
| `prune_email_queue` | Cron/internal | run_sync_maintenance | nein | loescht Mail-Queue-Zeilen; mit kleinem Intervall gehen Dedupe-Belege verloren |
| `prune_rate_limits` | Cron/internal | run_sync_maintenance | nein | loescht Rate-Limit-Zeilen |
| `prune_sync_jobs` | Cron/internal | run_sync_maintenance | nein | loescht Job-Historie |
| `prune_sync_runs` | Cron/internal | run_sync_maintenance | nein | loescht Lauf-Historie |
| `purge_unconfirmed_accounts` | Cron/internal | run_sync_maintenance | nein | loescht pending google_accounts und deren oauth_tokens |
| `recommendation_events_set_location` | Trigger/internal | Trigger recommendation_events_location | nein | setzt NEW.location_id, direkt aufrufbar wirkungslos |
| `record_recommendation_action` | service-only | Edge google-business (service_role) | ja (user_id) | schreibt Empfehlungsaktionen fremder Nutzer |
| `release_lock` | unklar | kein Aufrufer im Repo, nur Kommentare | nein | gibt eine Sync-Sperre frei |
| `release_stuck_emails` | Cron/internal | run_sync_maintenance | nein | setzt sending-Mails zurueck auf queued |
| `release_stuck_publications` | Cron/internal | run_sync_maintenance | nein | setzt haengende Veroeffentlichungen zurueck |
| `release_stuck_sync_jobs` | Cron/internal | run_sync_maintenance | nein | setzt haengende Jobs zurueck |
| `release_stuck_sync_runs` | Cron/internal | run_sync_maintenance | nein | setzt haengende Laeufe zurueck |
| `retract_reply` | service-only | Edge google-business (service_role) | ja (reply_id) | zieht eine veroeffentlichte Antwort zurueck |
| `run_sync_maintenance` | Cron | cron.schedule gbp-maintenance, alle 15 Minuten | nein | ruft alle prune_/release_/purge_-Funktionen |
| `schedule_all_syncs` | service-only | Edge google-business (service_role) | nein | legt Sync-Jobs fuer alle Nutzer an |
| `schedule_review_syncs` | unklar | kein Aufrufer im Repo | nein | legt Review-Sync-Jobs an |
| `snapshot_impact_baseline` | unklar | kein Aufrufer im Repo | ja (event_id) | schreibt Impact-Basislinie |
| `sync_events(2 Argumente)` | tote Altueberladung | kein Aufrufer; Edge nutzt die 4-Argument-Fassung | ja (user_id) | schreibt Engine-Events fremder Nutzer |
| `sync_events(3 Argumente)` | tote Altueberladung | kein Aufrufer; Edge nutzt die 4-Argument-Fassung | ja (user_id) | schreibt Engine-Events fremder Nutzer |
| `try_acquire_lock` | unklar | kein Aufrufer im Repo, nur Kommentare | nein | nimmt eine Sync-Sperre |
| `update_user_plan` | unklar / P0 | kein Aufrufer in src, supabase/functions, Migrationen oder cron.job | ja (user_id) | setzt plan und trial_ends_at fremder Nutzer |

Zusammengefasst:

| Kategorie | Anzahl |
| --- | --- |
| service-only intern (Edge mit `service_role`) | 19 |
| Cron/internal (pg_cron oder nur von anderer SQL-Funktion) | 15 |
| Trigger/internal | 4 |
| unklar (kein Aufrufer gefunden) | 6 |
| tote Altüberladung | 2 |
| öffentlicher Client-RPC bewusst | **0** |
| authenticated Client-RPC bewusst | **0** |

Keine einzige der 46 hat einen Frontend-Aufrufer. Keine ist als
öffentliches RPC gedacht.

---

## 5. Die bewussten Client-RPCs (§8)

Diese drei werden wirklich aus dem Browser gerufen. Sie sind heute schon
richtig gesetzt (`ausdruecklich`, `pub=false`, `anon=false`,
`auth=true`) und dürfen nicht angefasst werden:

| RPC | Aufrufer | Eigentumsprüfung |
| --- | --- | --- |
| `accept_terms(p_version text)` | `src/pages/Onboarding.js` | nimmt **keine** user_id, liest `auth.uid()`, wirft ohne Session |
| `claim_own_lead()` | `src/hooks/useAuth.js`, `src/pages/Signup.js` | nimmt keine Argumente, arbeitet über `auth.uid()` |
| `touch_dashboard_visit(p_user_id uuid)` | `src/hooks/useEvents.js` | nimmt eine user_id, vergleicht sie aber mit `auth.uid()` |

Dazu `current_terms_version()` (immutable, kein Schreibpfad) und
`events_feed` / `werkruf_score_location` — letztere beide siehe 7.

Zwei weitere sind für `authenticated` offen, ohne dass sie es brauchen.
Beide werden nur von der Edge Function über `service_role` gerufen und
prüfen `auth.uid()` **nicht**:

- `events_mark_seen(p_user_id uuid, p_ids uuid[])`
- `resolve_stale_events(p_user_id uuid, p_events jsonb, p_location_id uuid)`
  — in Produktion offen, in der Testdatenbank zu

Das sind keine Frontend-RPCs. Sie sind in B geschlossen.

---

## 6. P0-Kandidaten mit realer Wirkung

Nicht „offen" allein macht einen P0, sondern was ein Fremder damit
auslösen kann. Die Spalte „Wirkung" ist aus dem Funktionsrumpf gelesen,
nicht geraten.

| Funktion | Was ein Unbekannter mit dem anon-Key auslösen kann | Einstufung |
| --- | --- | --- |
| `update_user_plan(uuid, text, timestamptz)` | setzt `plan` jedes Nutzers auf `pro` oder `free`, inklusive `trial_ends_at`. Kein Eigentumscheck, kein Aufrufer. `user_profiles_plan_check` erlaubt `free`, `starter`, `pro`, `founding_partner`; die Funktion erlaubt `free`, `trial`, `pro`, `cancelled`. Die Schnittmenge `free` und `pro` geht durch — ein Founding Partner lässt sich damit auf `free` setzen und verliert seinen Zugang. | **P0** |
| `run_sync_maintenance()` | ein Aufruf löst alle `prune_*`, `release_stuck_*`, `purge_unconfirmed_accounts` und `cleanup_expired_oauth_states` aus. | **P0** |
| `prune_email_queue(interval)` | mit `interval '0'` werden alle `sent`/`cancelled`-Zeilen gelöscht. Die `dedupe_key`-Belege sind damit weg — der Kommentar in der Funktion sagt selbst: „Zu früh gelöscht, geht sie ein zweites Mal raus." Mailverdopplung an echte Kunden. | **P0** |
| `release_stuck_emails(interval)` | mit negativem Intervall werden alle `sending`-Mails auf `queued` zurückgesetzt. Gleicher Effekt: Doppelversand. | **P0** |
| `purge_unconfirmed_accounts(interval)` | mit `interval '0'` werden alle `pending` google_accounts und deren `oauth_tokens` gelöscht. Trifft jeden Nutzer, der gerade im OAuth-Flow steht. | **P0** |
| `try_acquire_lock` / `release_lock` | Sperre nehmen und nicht freigeben: alle gesperrten Hintergrundläufe bleiben stehen, ohne Fehlermeldung. Sperre fremd freigeben: Doppelausführung. | hoch |
| `retract_reply(uuid)` | zieht eine veröffentlichte Google-Antwort eines fremden Betriebs zurück. | hoch |
| `enqueue_sync_job(…, p_user_id, …)` | legt beliebig viele Google-Sync-Jobs für fremde Nutzer an — Google-Quota und Kosten. | hoch |
| `sync_events(uuid, jsonb)` und `(uuid, jsonb, text)` | schreibt Engine-Events in fremde Konten. Zwei tote Überladungen, die die Härtung der 4-Argument-Fassung unterlaufen. | hoch |
| `check_rate_limit(text, int, interval)` | verbraucht fremde Rate-Limit-Zähler; der Schlüssel ist ableitbar. Sperrt Smartcheck/Report für andere. | mittel |
| `complete_recommendations_for`, `mark_recommendations_seen`, `record_recommendation_action`, `mark_events_delivered`, `snapshot_impact_baseline`, `measure_recommendation_impact` | schreiben Empfehlungs- und Event-Zustände fremder Nutzer. Keine Kundendaten nach außen, aber fremde Dashboards manipulierbar. | mittel |
| `begin_sync_run`, `claim_sync_jobs`, `finish_sync_job`, `finish_sync_run`, `claim_reply_for_publishing`, `complete_reply_publication`, `fail_reply_publication`, `release_stuck_*`, `prune_sync_*`, `cleanup_stripe_events`, `ops_*`, `schedule_all_syncs`, `schedule_review_syncs` | Worker-Protokoll und Betriebsfunktionen von außen bedienbar. `cleanup_stripe_events` löscht die Idempotenztabelle des Stripe-Webhooks. | mittel |
| `handle_new_user`, `anonymise_user_on_delete`, `on_user_confirmed_send_welcome`, `recommendation_events_set_location` | Trigger-Funktionen. PostgREST veröffentlicht `returns trigger` nicht, und ein direkter Aufruf ohne Trigger-Kontext scheitert. Praktisch kein Angriffspfad, aber unnötig offen. | niedrig |

Der Unterschied zu H2.1: dort stand `update_user_plan` als einziger
Kandidat. Die Messung zeigt, dass der Mailversand-Doppelversand und
`run_sync_maintenance` in derselben Klasse liegen.

---

## 7. Befund außerhalb des §3-Umfangs — Entscheidung nötig

§3 begrenzt die Prüfung auf `VOLATILE`. Dabei fällt eine Gruppe heraus,
die ich melde statt zu schließen (G2 §39: melden vor reparieren).

29 Funktionen sind `SECURITY DEFINER` + `STABLE`. 14 davon sind für
`PUBLIC` offen, 6 weitere für `authenticated`. `SECURITY DEFINER`
umgeht RLS auch beim Lesen. Diese nehmen eine fremde `user_id` und
prüfen `auth.uid()` nicht:

| Funktion | offen für | liest |
| --- | --- | --- |
| `compute_health_score(uuid)` | `anon` | Score fremder Betriebe |
| `build_evaluation_context(uuid)` | `anon` | kompletten Bewertungskontext eines fremden Kontos |
| `top_events(uuid, text, int)` | `anon` | Events fremder Nutzer |
| `weekly_recommendation_summary(uuid, timestamptz)` | `anon` | Wochenzusammenfassung fremder Nutzer |
| `top_recommendations_for_email(uuid, int)` | `anon` | Empfehlungen fremder Nutzer |
| `read_impact_metric(uuid, text)` | `anon` | Impact-Zahlen fremder Nutzer |
| `last_email_sent(uuid, text)` | `anon` | Mailhistorie fremder Nutzer |
| `plan_communications(uuid, timestamptz)` | `anon` | geplante Kommunikation fremder Nutzer |
| `is_in_cooldown`, `completed_this_week`, `sync_failure_resolved`, `explain_recommendation`, `wants_notification` | `anon` | Teilzustände fremder Konten |
| `events_feed(uuid, …)` | `authenticated` | **Event-Feed fremder Nutzer**, wird so aus dem Frontend gerufen |
| `werkruf_score_location(uuid)` | `authenticated` | Score fremder Nutzer, wird so aus dem Frontend gerufen |
| `compute_location_health_score`, `previous_location_health`, `read_location_impact_metric` | `authenticated` | Standortdaten fremder Nutzer |
| `has_paid_access(uuid)` | `authenticated` | Zahlstatus fremder Nutzer. Das Grant stammt aus meiner H1-Migration `20261013130000`; es gibt keinen Frontend-Aufrufer, es war unnötig. |
| `build_location_evaluation_context`, `weekly_mail_events`, `weekly_payload_for` | `authenticated` | nur in Produktion offen, in der Testdatenbank zu — Standort- und Wochenmaildaten fremder Nutzer |

Das ist Kundenisolation auf der Leseseite, also DSGVO-relevant und
sachlich schwerer als `update_user_plan`. Es steht aber nicht im H2.2-
Auftrag, und §7 verbietet Massen-Revoke ohne Aufrufer-/Wirkungsprüfung.

`events_feed` und `werkruf_score_location` brauchen `authenticated`
wirklich, aber mit Eigentumsprüfung — nicht mit freier `user_id`. Das
ist ein kleiner Eingriff in zwei Funktionsrümpfe, kein Umbau.

Probe 3 aus Abschnitt 3.1 belegt es in Produktion: `anon` ruft
`compute_health_score` mit fremder UUID und bekommt eine Antwort.

Drei Wege standen zur Wahl. **Entschieden wurde Weg 3**, umgesetzt in
Abschnitt 10:

1. nur den §3-Umfang (volatile) schließen, Leseseite als eigenes
   Paket — saubere Auftragstreue, Leseleck bleibt offen
2. zusätzlich die 14 `anon`-offenen Lesefunktionen (reines
   Grant-Thema, kein Rumpf wird angefasst, kein Aufrufer betroffen) und
   `has_paid_access`
3. wie 2, plus Eigentumsprüfung in `events_feed`,
   `werkruf_score_location`, `compute_location_health_score`,
   `previous_location_health`, `read_location_impact_metric`

Meine Empfehlung war 2, entschieden wurde 3 — und das war richtig: die
Gegenprobe zu Weg 3 hat einen Fehler gefunden, den ein reiner
Grant-Entzug nie gezeigt hätte (Abschnitt 10.4).

---

## 8. Sollmatrix

| Gruppe | PUBLIC | anon | authenticated | service_role |
| --- | --- | --- | --- | --- |
| service-only, Cron/internal, Trigger/internal, unklar (46 Signaturen) | nein | nein | nein | ja |
| `events_mark_seen`, `resolve_stale_events` | nein | nein | nein | ja |
| `accept_terms`, `claim_own_lead`, `touch_dashboard_visit` | nein | nein | **ja** | ja |

Die beiden toten `sync_events`-Überladungen sind in der ersten Gruppe:
geschlossen, nicht gelöscht. Löschen wäre sauberer, ist aber ein
Schemaeingriff und nicht freigegeben.

---

## 9. B — was gebaut ist

Zwei neue Dateien, nichts Bestehendes verändert außer einer
Testkorrektur (11.5).

### 9.1 `supabase/migrations/20261014120000_execute_rechte_kanonisch.sql`

- 48 Signaturen verlieren `EXECUTE` für PUBLIC, `anon` und
  `authenticated` und bekommen es ausdrücklich für `service_role`
- die drei Client-RPCs bekommen `authenticated` ausdrücklich und
  verlieren PUBLIC und `anon`
- die Signaturen stammen aus der Produktionsmessung; eine fehlende
  wird gemeldet, nicht übergangen
- wiederholbar, ändert keine Daten, kein Schema, keinen
  Funktionsrumpf
- **kein Massen-Revoke nach Namensliste** (§7): jede der 48 hat in
  Abschnitt 4 einen belegten oder ausdrücklich fehlenden Aufrufer

Selbstprüfung nach dem Setzen, fail closed (§9):

| Prüfung | Bedingung |
| --- | --- |
| A | keine `definer`+`volatile`-Funktion in `public` ist für PUBLIC, `anon` oder `authenticated` erreichbar, außer den drei Client-RPCs |
| B | die drei Client-RPCs haben `authenticated`, nicht PUBLIC, nicht `anon` |
| B2 | die drei existieren überhaupt |
| C | `service_role` erreicht alle 82 |
| D | der Eigentümer behält sein `EXECUTE` |

Prüfung A ist die wichtige: findet sie eine Funktion, die ich nicht
gesehen habe, **bricht die Migration ab und nennt den Namen**. Sie wird
nicht stillschweigend offen gelassen und auch nicht blind revoked.

### 9.2 `supabase/tests/securityDefinerPrivileges.test.sql`

Policy statt Liste. Der Test prüft nicht „sind diese 48 zu", sondern:
jede `definer`+`volatile`-Funktion in `public` ist für Clients
unerreichbar, außer den drei auf der Allowlist. Eine 49. neu angelegte
offene Funktion fällt damit auf, eine Liste hätte sie übersehen.

| Abschnitt | prüft |
| --- | --- |
| 0 | die Allowlist zeigt auf existierende Funktionen — sonst prüft B eine leere Menge |
| A | die Policy |
| B | die Client-RPCs haben genau `authenticated` |
| C | `service_role` erreicht alles (fängt eine zu scharfe Härtung) |
| D | **Wirkung**: Rollenwechsel auf `anon` und `authenticated`, Aufruf von `update_user_plan`, erwartet `42501` |
| E | **Gegenprobe**: `grant execute … to anon`, dieselbe Abfrage wie A muss ihn finden |

### 9.3 Was brechen könnte, und gemessen nicht bricht

Drei der 48 hängen an Triggern auf `auth.users`: Registrierung,
Mailbestätigung, Kontolöschung. Würde PostgreSQL `EXECUTE` beim Feuern
prüfen, wäre diese Migration ein Ausfall des Signups.

Nachgemessen statt nachgelesen: Probetabelle, `SECURITY DEFINER`-Trigger,
`revoke execute from public`, dann Insert unter einer Rolle ohne jedes
Recht an der Funktion. Der Trigger lief und schrieb seine Zeile.
`EXECUTE` wird bei `CREATE TRIGGER` geprüft, nicht beim Feuern.

Zweiter Pfad: `pg_cron`. Der Job `gbp-maintenance` ruft
`select public.run_sync_maintenance();` und läuft unter der Rolle, die
ihn eingeplant hat — `postgres`. Alle 82 Funktionen gehören `postgres`,
und ein Eigentümer behält sein `EXECUTE`, solange es ihm nicht
ausdrücklich entzogen wird. Prüfung D der Migration hält das fest.

Dritter Pfad: die Edge Functions. Alle rufen über `service_role`,
geprüft in allen zwölf. Prüfung C hält das fest.

### 9.4 Belege

| Beweis | Ergebnis |
| --- | --- |
| Migration auf die Testdatenbank angewandt | `PUBLIC offen: 46 → 0`, `anon: 46 → 0`, `authenticated: 7 → 3`, `service_role: 82` |
| Wirkungsprobe danach | `anon → update_user_plan` ergibt `permission denied for function update_user_plan` |
| zweiter Lauf derselben Migration | Exit 0, wiederholbar |
| **Gegenprobe Migration**: neue offene Funktion angelegt, `grant execute … to anon` | Migration bricht ab und nennt `gegenprobe_offen(p_user_id uuid) \| public=false anon=true auth=false` |
| **Gegenprobe Test**: Datenbank ohne die neue Migration aufgebaut | `securityDefinerPrivileges.test.sql` rot, listet alle 48 |
| alle SQL-Tests, Datenbank mit Migration | 26 Dateien, 26 ausgeführt, 0 rot |
| Jest | 1048 Tests in 67 Suites grün |
| `CI=true npm run build` | grün |

### 9.5 Ein Fehler in meinem eigenen H2.1-Test

`src/billingAudit.test.js` behauptet im Kommentar „Nur echte Aufrufe,
keine Erwähnung im Kommentar" und prüfte den Dateitext unverändert.
Aufgefallen ist das, weil die neue Migration in ihrem Kopf die
Wirkungsprobe zitiert:

```text
select public.update_user_plan('0000…0000'::uuid, 'free');
```

Der Test wurde rot und meldete die Migration als Aufrufer, die die
Funktion gerade zumacht. Falschmeldung — aber die richtige Art davon:
die Behauptung im Kommentar war nicht eingelöst. Jetzt werden SQL- und
JS-Kommentare vor dem Vergleich entfernt. Gegenprobe gemacht: ein
echter `perform public.update_user_plan(…)` in einer Migration macht
den Test weiterhin rot.

---

## 10. Leseseite — was gebaut ist

`supabase/migrations/20261014130000_lesezugriff_eigentumspruefung.sql`
und `supabase/tests/lesezugriffIsolation.test.sql`.

### 10.1 Zwei Mittel, nicht eines

| Mittel | wofür | Umfang |
| --- | --- | --- |
| Grant entzogen | alles ohne Client-Aufrufer | 14 `PUBLIC`-offene + `has_paid_access` + 6 Lesefunktionen ohne Frontend-Aufrufer |
| Eigentumsprüfung im Rumpf | alles, was ein Client erreicht oder erreichen könnte | 8 Funktionen mit `p_user_id` |

Aus dem Browser gerufen werden von allen 23 genau zwei:
`events_feed` (`src/hooks/useEvents.js`) und `werkruf_score_location`
(`src/hooks/useHealthScore.js`), beide mit `p_user_id: user.id`. Im
ganzen Frontend gibt es keine Stelle, die ein `p_user_id` übergibt, das
nicht die eigene Sitzung ist — nachgesehen über alle `src/**`.

Die sechs inneren Funktionen bekommen beides: kein Grant mehr **und**
die Prüfung. Sie laufen nur innerhalb der beiden Client-RPCs, dort als
Eigentümer; die Prüfung ist die zweite Reihe, falls jemand später ein
Grant vergibt oder eine fremde ID durchreicht.

### 10.2 Warum nicht `current_user`

Die Falle, gemessen statt vermutet. In einer `SECURITY DEFINER`-Funktion
ist `current_user` der **Eigentümer**, nicht der Aufrufer. Gemessen am
14.10.2026 unter `set local role authenticated`:

```text
current_user=postgres  session_user=postgres  guc_role=authenticated
```

Eine Prüfung `if current_user = 'authenticated'` wäre also immer falsch
— Sicherheit, die nur im Text steht. Was überlebt, ist die Rollen-GUC:
PostgREST setzt je Anfrage `set local role <Rolle aus dem JWT>`.

`public.assert_eigener_zugriff(p_user_id)` prüft deshalb zweierlei:

1. Ist eine Sitzung da (`auth.uid()` nicht null), muss sie zur
   angefragten `p_user_id` passen — unabhängig von der Rolle.
2. Ruft eine Clientrolle (`authenticated`/`anon`), **muss** eine
   Sitzung da sein. Ein JWT mit `role`, aber ohne `sub`, kommt damit
   nicht durch.

Serverpfade haben weder Sitzung noch Clientrolle: Cron läuft mit role
`none`, die Edge Functions mit `service_role`. Beide kommen durch — das
ist Absicht, sie arbeiten für alle Nutzer.

### 10.3 Wie die Rümpfe geändert werden, ohne sie zu kopieren

Sechs der acht sind plpgsql. Für sie liest die Migration die bestehende
Definition mit `pg_get_functiondef` aus dem Katalog, setzt eine Zeile
hinter das Toplevel-`begin` und führt das Ergebnis aus.

Das ist Absicht, nicht Bequemlichkeit: ein einkopierter Rumpf wäre der
Rumpf, den **das Repo** für richtig hält. G2.1 hat gemessen, dass Repo
und Produktion auseinanderlaufen können. Ein einkopierter Rumpf würde
so einen Unterschied stillschweigend überschreiben; der Katalog ist
das, was wirklich läuft.

Abgesichert in beide Richtungen: der Einfügepunkt muss hinter
`AS $function$` liegen, sonst Abbruch; ohne Toplevel-`begin` Abbruch mit
Namen; ist die Prüfung schon drin, passiert nichts.

Die zwei `language sql`-Funktionen haben keinen `begin`-Block. Ihre
Rümpfe stehen ausgeschrieben, als plpgsql gefasst — die Abfrage ist
dieselbe, sie steht nur in einem `return`. Davor prüft die Migration die
Prüfsumme des bestehenden Rumpfes und bricht bei Abweichung ab, statt
eine abweichende Produktionsfassung zu überschreiben.

### 10.4 Was die Gegenprobe gefunden hat

Der Grund, warum Weg 3 die richtige Entscheidung war.

Nach dem ersten Lauf waren alle acht Prüfzeilen im Rumpf, die
Selbstprüfung grün — und der A/B-Test meldete trotzdem, dass A die
Daten von B lesen kann, bei `compute_location_health_score` und
`build_location_evaluation_context`.

Der Grund: beide enden mit

```sql
exception when others then
  return jsonb_build_object('score', null, 'grund', 'fehler',
                            'error', sqlerrm, 'scoreVersion', 1);
```

`when others` fängt auch `42501`. Die Prüfung lief, warf — und der
Handler machte daraus ein freundliches JSON. Bei
`compute_location_health_score` stand die Fehlermeldung sogar im
Ergebnis. Eine Härtung, die aussieht wie eine Härtung und keine ist.

Die Migration setzt deshalb in einen solchen Handler als erste Zeile
`if sqlstate = '42501' then raise; end if;`. Alles andere fängt er
weiterhin ab — das ist seine Aufgabe.

**Zweiter Fehler, in meiner eigenen Erkennung:** der erste Entwurf
suchte im ganzen Funktionstext nach `when others` und brach bei
`previous_location_health` ab — dort steht der Ausdruck in einem
**Kommentar** („Bewusst NUR undefined_column: Ein weiter gefasstes
`when others` …"). Genau die Textmuster-Falle, vor der G2.2 §29 warnt,
diesmal in meiner Prüflogik. Erkannt wird der Handler jetzt am
Zeilenanfang, nicht am Wort.

Was offen bleibt und nicht hierher gehört: der Handler von
`compute_location_health_score` gibt weiterhin `sqlerrm` an den
Aufrufer zurück. Für `42501` nicht mehr, für andere Fehler schon. Das
ist ein eigener Befund, kein P0, und keine Zeile dieses Pakets.

### 10.5 Die A/B-Gegenproben

`lesezugriffIsolation.test.sql`, zwei echte Nutzer mit je einem
Betrieb, echter Rollenwechsel und echtes `request.jwt.claim.sub` wie
bei PostgREST. Die Produktionsfassung von `auth.uid()` wird in der
Transaktion installiert — gegen den Stub (liefert immer null) wäre
jede Eigentumsprüfung grün, ohne etwas geprüft zu haben.

| Abschnitt | prüft |
| --- | --- |
| A | A liest seine eigenen Daten über beide Client-RPCs, mit echtem Ergebnis |
| A2 | die sechs inneren Funktionen laufen mit eigener ID durch |
| B | alle acht weisen eine fremde `user_id` ab — mit `42501` **und** dem Text der Eigentumsprüfung |
| B2 | dasselbe für die zwei Client-RPCs unter `role authenticated` |
| C | Clientrolle ohne Sitzung bekommt `42501` |
| D | Serverpfad (`role none`, keine Sitzung) liest weiterhin alles |
| E | ohne Grant kommt der Aufruf gar nicht erst an (`permission denied`) |
| F | **Gegenprobe**: ohne die Prüfzeile liest A den Betrieb von B |
| G | Policy über alle 29 `definer`+`stable`: nur die zwei Client-RPCs erreichbar |
| H | **Gegenprobe zu G**: `grant execute … to anon` wird gefunden |

Abschnitt B läuft bewusst mit `role none` und gesetzter Sitzung. Mit
`authenticated` wäre er auch dann grün, wenn es gar keine
Eigentumsprüfung gäbe — die sechs inneren hätten ohnehin `permission
denied` geworfen, mit demselben SQLSTATE. Deshalb prüft B zusätzlich
den Meldungstext. Das ist der Unterschied zwischen einem Test, der
etwas prüft, und einem, der nur grün ist.

### 10.6 Belege

| Beweis | Ergebnis |
| --- | --- |
| nach beiden Migrationen, `definer` + `volatile` | gesamt 82, PUBLIC 0, anon 0, authenticated 3, service_role 82 |
| nach beiden Migrationen, `definer` + `stable` | gesamt 29, PUBLIC 0, anon 0, authenticated 2, service_role 29 |
| zweiter Lauf der Lesemigration | Exit 0, genau eine Prüfzeile je Funktion |
| **Gegenprobe**: Datenbank ohne die Lesemigration | `lesezugriffIsolation.test.sql` rot in Abschnitt B |
| alle SQL-Tests | 27 Dateien, 27 ausgeführt, 0 rot |
| Jest | 1048 Tests in 67 Suites grün |
| `CI=true npm run build` | `Compiled successfully.` |

---

## 11. Anwenden — was du tun musst

Nicht von mir angewandt (§35). **Reihenfolge zählt**: erst die
Schreibseite, dann die Leseseite. Beide sind wiederholbar, beide
brechen bei Abweichung ab.

1. **GitHub → Actions → „Apply Supabase migrations" → Modus
   `vorschau`.** Liest nur. Erwartet: genau
   `20261014120000_execute_rechte_kanonisch.sql` und
   `20261014130000_lesezugriff_eigentumspruefung.sql` stehen als
   offen, in dieser Reihenfolge. Stehen dort plötzlich alle
   Migrationen, ist `verlauf-nachtragen` der erste Schritt und nicht
   `anwenden` — siehe der Kopf des Workflows.
2. **Derselbe Workflow, Modus `anwenden`.** Der Workflow lässt vorher
   die SQL-Tests laufen; `securityDefinerPrivileges.test.sql` und
   `lesezugriffIsolation.test.sql` sind dabei.
3. **Danach die Messabfrage aus Abschnitt 1 erneut ausführen.** Soll:

   ```text
   davon PUBLIC offen: 0
   davon nur authenticated: 3
   definer+stable PUBLIC offen: 0
   definer+stable nur auth: 2
   ```

4. **Und die drei Wirkungsproben aus 1.1.** Soll: Probe 1 und 2
   `ERROR: permission denied for function update_user_plan`, Probe 3
   `ERROR: permission denied for function compute_health_score`.
5. **Dashboard einmal öffnen.** Score und Aufgabenliste müssen
   erscheinen — sie laufen über die zwei Funktionen, die
   `authenticated` behalten haben.

Falls Schritt 2 abbricht, nennt die Meldung die Ursache:

| Meldung | Bedeutung |
| --- | --- |
| „Noch offen nach dem Setzen: …" | eine Funktion, die nicht in meiner Liste stand. Nicht nachtragen — den Namen schicken, §5 und §7 verlangen vorher die Aufrufer- und Wirkungsprüfung. |
| „Rumpf weicht von der gelesenen Fassung ab …" | Produktion hat eine andere Fassung von `werkruf_score_location` oder `weekly_mail_events`. Nichts wurde geändert. Bitte den Rumpf schicken, statt die Prüfsumme anzupassen. |
| „hat einen when-others-Handler in einer Form, die diese Migration nicht kennt" | eine Handler-Schreibweise, die ich nicht geprüft habe. Nichts wurde geändert. |
| „when-others verschluckt die Zugriffsprüfung: …" | die Prüfzeile ist drin, aber der Handler fängt sie. Siehe 10.4 — diesen Zustand darf es nicht geben. |

Erst wenn Produktion in Schritt 3 vier Nullen beziehungsweise 3 und 2
zeigt, sind beide Befunde geschlossen.

---

## 12. Offen und entscheidungsbedürftig

1. **Beide Migrationen sind nicht angewandt.** Reihenfolge zählt:
   erst `20261014120000`, dann `20261014130000`.
2. **C–F** sind nicht begonnen. C ist der nächste Schritt.
3. Kein P0, aber notiert: `compute_location_health_score` gibt im
   `when others`-Handler weiterhin `sqlerrm` an den Aufrufer zurück
   (Abschnitt 10.4).

Entschieden und umgesetzt: die zwei toten
`sync_events`-Überladungen bleiben geschlossen und werden nicht
gelöscht.

---

## 13. Was in diesem Paket nicht passiert ist

- keine Migration angewandt, kein Deploy
- keine Stripe-Konfiguration angefasst, kein Webhook ausgelöst
- keine Mail verschickt
- kein fremder Nutzer verändert
- keine bestehende Migration editiert
- keine Daten, keine Tabellen, keine Policies, keine Signatur, kein
  Rückgabetyp geändert
- keine fachliche Logik geändert: die acht Rümpfe haben eine Zeile
  davor bekommen, zwei zusätzlich eine im Fehlerzweig
- die zwei toten `sync_events`-Überladungen nur geschlossen, nicht
  gelöscht
- C–F nicht begonnen
