# Edge Functions ins Repo — Anleitung

Stand: 11. September 2026

Bis heute existierten alle Edge Functions **ausschliesslich** im
Supabase-Dashboard-Editor. Kein Repo, keine Versionierung, kein
Rollback. Diese Struktur beendet das.

---

## 1. Entpacken

Den Inhalt dieses ZIP in die **Wurzel** deines lokalen Repos entpacken —
dorthin, wo `package.json` und `src/` liegen. Es entstehen zwei neue
Verzeichnisse:

```
werkruf/
├── package.json          ← vorhanden
├── src/                  ← vorhanden
├── supabase/             ← NEU
│   ├── config.toml
│   ├── functions/
│   ├── migrations/
│   └── tests/
└── .github/              ← NEU
    └── workflows/deploy.yml
```

Bestehende Dateien werden nicht angefasst.

---

## 2. Fünf Functions fehlen noch

Diese Ordner sind **leer** und müssen von dir befüllt werden. Im
Dashboard die Function öffnen, Code markieren, kopieren, als
`index.ts` in den passenden Ordner einfügen:

| Ordner | Quelle |
|---|---|
| `supabase/functions/google-business/` | Dashboard → google-business |
| `supabase/functions/send-email/` | Dashboard → send-email |
| `supabase/functions/generate-review-reply/` | Dashboard → generate-review-reply |
| `supabase/functions/check-trial-emails/` | Dashboard → check-trial-emails |
| `supabase/functions/send-welcome-email/` | Dashboard → send-welcome-email |

Warum nicht mitgeliefert: Diese fünf sind zusammen über 4.000 Zeilen.
Sie abzutippen statt zu kopieren bringt kein zusätzliches Ergebnis und
schafft die Möglichkeit stiller Abweichungen — und genau die willst du
mit dem Repo ja beenden.

**Der leere Ordner ist ungefährlich.** `supabase functions deploy`
deployt nur, was existiert; eine Function ohne `index.ts` bleibt im
Dashboard unangetastet.

Bereits enthalten sind:

| Ordner | Stand |
|---|---|
| `create-checkout-session/` | **korrigiert** (Metadaten, Trial, Path B raus) |
| `stripe-webhook/` | **korrigiert** (Signaturpflicht, Idempotenz, Path B raus) |
| `create-portal-session/` | unverändert |
| `delete-account/` | unverändert |
| `cloudinary-sign-upload/` | unverändert |

---

## 3. Committen (GitHub Desktop)

1. GitHub Desktop öffnen — die neuen Dateien erscheinen unter "Changes"
2. Prüfen, dass alle zehn `index.ts` dabei sind
3. Commit-Nachricht: `Edge Functions ins Repo — Bestandsaufnahme`
4. "Commit to main", dann "Push origin"

Ab hier existiert die erste Kopie ausserhalb von Supabase. Das
Verlustrisiko ist weg — auch ohne jede Automatisierung.

Falls Vercel am Deno-Code scheitert (sollte nicht passieren, `supabase/`
liegt ausserhalb von `src/`), eine `.vercelignore` mit einer Zeile
`supabase/` anlegen.

---

## 4. Deploy scharfschalten (später)

Erst wenn alle zehn Functions im Repo liegen.

**Token erzeugen:** Supabase → Profilbild oben rechts → Account Settings
→ Access Tokens → Generate new token. Der Wert ist nur einmal sichtbar.

**In GitHub hinterlegen:** Repository → Settings → Secrets and variables
→ Actions → New repository secret. Name: `SUPABASE_ACCESS_TOKEN`.

**Workflow aktivieren:** In `.github/workflows/deploy.yml` die drei
Zeilen unter `# push:` einkommentieren.

Bis dahin startet der Workflow nur von Hand (Actions → Deploy → Run
workflow). Das ist Absicht — der erste automatische Deploy soll kein
Zufall sein.

### Was beim ersten Deploy passiert

**Alle Functions im Repo überschreiben die Fassung im Dashboard.**
Weicht eine Datei ab, gewinnt das Repo. Deshalb Schritt 2 vollständig.

`verify_jwt` kommt danach aus `config.toml`, nicht mehr aus dem
Dashboard. Die Werte dort sind das, was fachlich richtig ist — vorher
gegen die Dashboard-Einstellungen halten und Abweichungen klären.

---

## 5. Migration 019

`supabase/migrations/019_stripe_events.sql` ist **noch nicht
eingespielt**, falls du es nicht bereits getan hast. Sie legt die
Idempotenz-Tabelle für den Stripe-Webhook an.

Von Hand im SQL Editor ausführen. Der Workflow spielt Migrationen
bewusst nicht automatisch ein: Ein fehlerhafter Push würde sonst das
Schema der Produktivdatenbank ändern, ohne dass jemand hinsieht.

---

## 6. Befunde beim Zusammentragen

Beim Durchsehen der zehn Functions sind drei Dinge aufgefallen, die
nichts mit dem Git-Umzug zu tun haben, aber vor dem ersten zahlenden
Kunden geklärt gehören.

### Vier Wege zur Willkommensmail

Es gibt vier unabhängige Pfade, die eine Willkommensmail auslösen
können:

| Pfad | Auslöser |
|---|---|
| Migration 010 `welcome_email_trigger` | Trigger auf `auth.users` → `email_queue` |
| `send-welcome-email` | Datenbank-Webhook auf `auth.users` → direkt an Brevo |
| `send-email` Route `/enqueue` | Frontend nach der Registrierung |
| `stripe-webhook` | nach `checkout.session.completed` |

Die ersten beiden hängen am selben Ereignis. Sind beide aktiv, bekommt
jeder neue Nutzer die Mail doppelt — in zwei verschiedenen Gestaltungen,
weil `send-welcome-email` eine eigene Vorlage mitbringt.

**Zu prüfen:** Supabase → Database → Webhooks. Gibt es dort einen Eintrag
auf `auth.users`? Und existiert der Trigger aus 010?

```sql
select tgname, tgenabled from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal;
```

Meine Empfehlung: **einen Pfad behalten**, den über `email_queue`. Nur
der taucht in `ops_email_queue` auf, respektiert `email_opt_out` und
hat eine Wiederholung. Die anderen drei schicken direkt an Brevo und
sind im Betrieb unsichtbar.

### Zwei Wege zur Trial-Erinnerung

`check-trial-emails` und `send-email` Route `/schedule`
(`schedule_lifecycle_emails`) machen dasselbe: Sie schicken Erinnerungen
vor Ablauf der Testphase. Laufen beide per Cron, bekommt der Kunde jede
Erinnerung zweimal.

`check-trial-emails` enthält ausserdem noch den Path-B-Zweig
(`path_b_day7`, Postkarten-Erinnerung), obwohl Path B laut Übergabe §1
gestrichen ist.

**Zu prüfen:** Steht `check-trial-emails` in `cron.job`?

```sql
select jobname, schedule, active from cron.job order by jobname;
```

Steht es dort nicht, ist die Function tot und kann weg.

### Zwei Functions ohne Zugriffsschutz

`check-trial-emails` und `send-welcome-email` haben **keine eigene
Prüfung** — kein Worker-Secret, keine Signatur, keine Session. Mit
`verify_jwt = false` (nötig für Cron und Datenbank-Webhook) ist beides
offen erreichbar.

Bei `check-trial-emails` heisst das: Wer die URL kennt, kann
Mailversand an alle Nutzer in der Testphase auslösen und deren
`last_notification_step` verstellen. Kein Datenabfluss, aber eine
Möglichkeit, deine Kunden zu belästigen und deine Brevo-Quota zu
verbrennen.

**Behebung:** Entweder `requireWorkerSecret()` einbauen — die
Implementierung steht in `send-email` — oder die Function abschalten,
falls sie ohnehin durch `send-email` ersetzt ist.

### Sechs Orte für dieselben Mailvorlagen

`buildEmailHtml()` steht identisch in `stripe-webhook`,
`check-trial-emails` und `send-welcome-email`. Dazu kommt das
eigenständige Vorlagensystem in `send-email` und die React-Email-Dateien
in `src/templates/`.

Sobald Git deployt, lässt sich das in ein `supabase/functions/_shared/`
ziehen — Deno importiert relativ, ohne Build-Schritt. Das ist der
nächste sinnvolle Schritt nach dem Umzug und gleichzeitig die kleine
Testfläche dafür, ob relative Importe im Deploy sauber durchlaufen,
bevor `google-business` aufgeteilt wird.

---

## 7. Reihenfolge

| Schritt | Aufwand |
|---|---|
| ZIP entpacken, fünf Functions einfügen, committen | 30 min |
| Migration 019 einspielen (falls offen) | 5 min |
| Token, Secret, Workflow scharfschalten | 1 h |
| `_shared/` herausziehen, Mailvorlagen vereinheitlichen | 1 h |
| `google-business` in Module aufteilen | 3–4 h |

Die Aufteilung der 5.000-Zeilen-Datei **nach** dem ersten erfolgreichen
Git-Deploy. Sonst weisst du bei einem Fehler nicht, ob es am Deploy-Weg
oder am Umbau lag.
