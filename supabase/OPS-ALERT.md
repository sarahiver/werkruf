# Betriebsalarm einrichten

Stand: 14. September 2026

Anlass: Vom 9. bis 11. September lief zwei Tage lang kein einziger
HTTP-Cronjob, und niemand hat es bemerkt. Sentry hätte nichts gesehen
(kein Frontend-Fehler), UptimeRobot auch nicht (`/health` antwortet
direkt und war gesund). Sichtbar war es ausschließlich in
`cron.job_run_details`.

---

## Reihenfolge

### 1. Migration einspielen

`supabase/migrations/020_ops_alerts.sql` im SQL Editor ausführen.

Prüfen:

```sql
select jsonb_pretty(public.ops_alerts());
```

Gibt `[]` zurück, wenn alles in Ordnung ist. Steht etwas drin, siehst du
gleich, ob die Prüfungen greifen.

### 2. Function deployen

Ordner `supabase/functions/ops-alert/` und die neue `config.toml` ins
Repo, committen. Der Workflow deployt.

### 3. Von Hand testen

Erst ohne Versand:

```sql
select net.http_post(
  url     := 'https://kueoozsfkevmncucrdjd.supabase.co/functions/v1/ops-alert',
  headers := jsonb_build_object(
               'Content-Type',    'application/json',
               'X-Worker-Secret', (select decrypted_secret
                                     from vault.decrypted_secrets
                                    where name = 'gbp_worker_secret')
             ),
  body    := '{"dryRun": true, "force": true}'::jsonb,
  timeout_milliseconds := 20000
);
```

Antwort ansehen:

```sql
select id, status_code, content from net._http_response order by id desc limit 1;
```

Erwartet **200** mit `{"ok":true,"alerts":N,"sent":false,"dryRun":true,...}`.

Dann einmal echt senden — `force` übergeht die Entprellung:

```sql
-- body := '{"force": true}'
```

Kommt keine Mail und `alerts` ist 0, ist gerade nichts kaputt. Zum
Testen des Mailwegs kannst du kurzzeitig einen Alarm erzwingen, indem du
einen inaktiven Cronjob mit Platzhalter anlegst — oder du wartest auf
den ersten echten Fall.

### 4. Cronjob einrichten

```sql
select cron.schedule('ops-alert', '*/15 * * * *', $job$
  select net.http_post(
    url     := 'https://kueoozsfkevmncucrdjd.supabase.co/functions/v1/ops-alert',
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'X-Worker-Secret', (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'gbp_worker_secret')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$job$);
```

**Vollständige URL, kein Platzhalter** — das ist Falle 11 aus dem
Übergabedokument, zweimal passiert.

Gegenprüfen:

```sql
select count(*) as platzhalter from cron.job where command like '%<%';
select jobname, schedule, active from cron.job order by jobname;
```

`platzhalter` muss 0 sein, und es sollten acht Jobs dastehen.

---

## Was geprüft wird

| Kennung | Stufe | Auslöser |
|---|---|---|
| `cron.failed` | kritisch | Fehlgeschlagene Cron-Läufe in der letzten Stunde |
| `cron.placeholder` | kritisch | Nicht ersetzte `<PLATZHALTER>` in einem Kommando |
| `net.silent` | kritisch | HTTP-Jobs feuern, aber seit 30 Min keine Antwort |
| `worker.stalled` | kritisch | Seit einer Stunde kein Eintrag in `sync_runs` |
| `stripe.unprocessed` | kritisch | Stripe-Events älter als 15 Min ohne `processed_at` |
| `sync.exhausted` | Hinweis | Sync-Jobs mit `attempts >= max_attempts` |
| `mail.stuck` | Hinweis | Mails `failed` oder über eine Stunde überfällig |
| `gbp.reauth` | Hinweis | Google-Verbindungen auf `needs_reauth` / `revoked` |

`net.silent` ist der Kern: Genau dieses Muster hatte der Ausfall vom
9.–11. September. pg_cron feuerte weiter und meldete „succeeded", während
kein einziger Request die Datenbank verließ.

---

## Entprellung

Jede Alarmart meldet sich **höchstens einmal pro Stunde**. Ohne das käme
alle 15 Minuten dieselbe Meldung, und ein Alarm, der ständig schreit,
wird nach zwei Tagen ignoriert.

Zustand ansehen:

```sql
select * from public.ops_alert_status;
```

---

## Stummschalten

Für bekannte Zustände, die man nicht täglich gemeldet bekommen will:

```sql
insert into public.ops_alert_mutes (alert_key, reason, muted_until)
values ('gbp.reauth', 'Bekannt, Kunde ist informiert', now() + interval '7 days')
on conflict (alert_key) do update
  set reason = excluded.reason, muted_until = excluded.muted_until;
```

Aufheben:

```sql
delete from public.ops_alert_mutes where alert_key = 'gbp.reauth';
```

`muted_until = null` bedeutet unbefristet.

---

## Eine Ausnahme, die wieder weg muss

`ops_alerts()` schließt Sync-Jobs mit `error_code = 'rate_limited'` aus.
Das ist der Normalzustand, solange die Google-APIs nicht freigegeben
sind — ohne die Ausnahme käme alle 15 Minuten eine Mail.

**Sobald Google freigibt, gehört die Ausnahme entfernt.** Dann ist
`rate_limited` wieder ein echtes Signal, nämlich eine erschöpfte Quota.

Die Stelle steht in `020_ops_alerts.sql`, Abschnitt 5, mit einem
Kommentar markiert.

---

## Warum eine eigene Function

Ursprünglich war eine Route `/ops/alert` in `send-email` geplant. Das
wäre falsch gewesen: `send-email` hängt an `email_queue`, am
`mail-worker`-Cronjob und an `claim_emails` — genau den Dingen, die
kaputtgehen können. Ein Alarm, der die überwachte Maschinerie nutzt,
kann deren Ausfall nicht melden.

Deshalb: eigene Function, direkter Brevo-Aufruf, keine Warteschlange.

Folge davon: Diese Mail taucht **nicht** in `ops_email_queue` auf. Das
ist kein Versehen, sondern die Bedingung dafür, dass sie auch dann
rausgeht, wenn die Warteschlange steht.
