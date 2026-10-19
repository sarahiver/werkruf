-- docs/operations/pre-smoke-inventur.sql
--
-- Phase 0A — Nutzer- und Dateninventur vor dem MVP-E2E-Smoke
--
-- ═══════════════════════════════════════════════════════════════
-- SICHERHEIT
-- ═══════════════════════════════════════════════════════════════
--
-- Ausschließlich lesend. Kein insert, update, delete, alter, drop.
-- Wiederholbar, beliebig oft, ohne Nebenwirkung.
--
-- Es werden KEINE Tokenwerte, Passwortdaten oder Secrets ausgegeben.
-- Wo Tokens eine Rolle spielen (Abfrage 4), wird ausschließlich
-- geprüft, OB einer da ist — nie sein Inhalt.
--
-- Ausführen im Supabase SQL Editor. auth.users ist nur für die Rolle
-- postgres lesbar; mit einer anderen Rolle liefert Abfrage 1 nichts.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIESE ABFRAGEN UND NICHT WENIGER
-- ═══════════════════════════════════════════════════════════════
--
-- Der Zielzustand verlangt für ivergentz@gmail.com einen Account,
-- der wie ein frischer Kunde startet. "Wie frisch" lässt sich nicht
-- schätzen — in 16 Tabellen können Altzeilen hängen, und drei davon
-- (leads, email_queue, audit_logs) hängen NICHT am Nutzer, sondern
-- an der E-Mail-Adresse oder an gar nichts. Wer nur user_profiles
-- ansieht, hält einen Account für leer, der es nicht ist.
--
-- Abfrage 3 sucht sich die Tabellen deshalb selbst aus dem Katalog,
-- statt einer von Hand gepflegten Liste zu folgen. Eine Liste altert
-- still; der Katalog nicht.
--
-- ═══════════════════════════════════════════════════════════════
-- REIHENFOLGE
-- ═══════════════════════════════════════════════════════════════
--
--   1  Nutzerbestand           Wer existiert überhaupt?
--   2  Zielnutzer im Detail    Plan, Stripe, Consent, Founding
--   3  Abhängige Zeilen        Was hängt je Nutzer in welcher Tabelle?
--   4  Google und Tokens       Verbindung ja/nein, ohne Werte
--   5  Mail                    operativ vs. Historie getrennt
--   6  Events                  offen vs. erledigt
--   7  Leads                   hängen an der E-Mail, nicht am Nutzer
--   8  Tabellen ohne Bezug     Kontrollliste: was NICHT betroffen ist
--
-- Jede Abfrage einzeln markieren und ausführen (Strg+Enter), sonst
-- zeigt der Editor nur das Ergebnis der letzten.


-- ═══════════════════════════════════════════════════════════════
-- 1 — NUTZERBESTAND
-- ═══════════════════════════════════════════════════════════════
--
-- Beantwortet: "Welche anderen Nutzer existieren aktuell überhaupt?"
--
-- admin_rolle liest raw_app_meta_data. Das ist die Quelle, die das
-- Produkt auswertet: src/utils/authRoles.js, authorization.js und
-- adminOps.js lesen app_metadata.role, und die RLS-Policies lesen
-- auth.jwt() -> 'app_metadata' ->> 'role'. user_metadata wird
-- bewusst NICHT gelesen — es ist vom Client beschreibbar.

select
  u.id                                              as auth_user_id,
  u.email,
  u.created_at,
  u.email_confirmed_at                              as bestaetigt_am,
  coalesce(u.raw_app_meta_data ->> 'role', '—')     as admin_rolle,
  case when p.id is null then 'FEHLT' else 'vorhanden' end as user_profile,
  p.plan,
  p.founding_partner_since,
  p.accepted_terms_version,
  p.accepted_terms_at,
  u.last_sign_in_at
from auth.users u
left join public.user_profiles p on p.id = u.id
order by u.created_at;


-- ═══════════════════════════════════════════════════════════════
-- 2 — DIE BEIDEN ZIELNUTZER IM DETAIL
-- ═══════════════════════════════════════════════════════════════
--
-- Stripe steht hier so, wie die WERKRUF-Datenbank es glaubt. Das ist
-- NICHT der Stripe-Realzustand — den kennt nur Stripe selbst. Beide
-- Werte gehören nebeneinandergelegt, bevor irgendetwas entschieden
-- wird; sie können auseinanderlaufen.
--
-- founding_partner ist kein Boolean, sondern ein Wert der Spalte
-- plan. user_profiles_plan_check erlaubt seit dem 13.10.2026:
-- free, starter, pro, founding_partner.

select
  u.email,
  u.id                                    as auth_user_id,
  p.plan,
  (p.plan = 'founding_partner')           as ist_founding_partner,
  p.founding_partner_since,
  p.founding_partner_note,
  p.stripe_customer_id,
  p.stripe_subscription_id,
  p.stripe_subscription_status,
  p.setup_fee_paid,
  p.trial_started_at,
  p.trial_ends_at,
  p.accepted_terms_version,
  p.accepted_terms_at,
  p.industry_key,
  p.company_name,
  p.email_opt_out
from auth.users u
left join public.user_profiles p on p.id = u.id
where lower(u.email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
order by u.email;


-- ═══════════════════════════════════════════════════════════════
-- 3 — ABHÄNGIGE ZEILEN JE NUTZER UND TABELLE
-- ═══════════════════════════════════════════════════════════════
--
-- Die eigentliche Inventur. Sucht alle Basistabellen in public mit
-- einer uuid-Spalte user_id, dazu die zwei Sonderfälle:
--
--   user_profiles    verknüpft über id (nicht user_id)
--   business_photos  verknüpft über profile_id
--
-- query_to_xml, weil der Tabellenname erst zur Laufzeit feststeht.
-- Rein lesend.
--
-- SO IST ES RICHTIG nach der Bereinigung: in der Spalte
-- kunde_ivergentz steht überall 0, außer bei user_profiles (1), wenn
-- Variante A gewählt wird.
--
-- gesamt zeigt, wie viele Zeilen die Tabelle insgesamt hat. Steht
-- dort dieselbe Zahl wie beim Zielnutzer, gehört die Tabelle ihm
-- allein — dann ist ein Fehler beim Löschen nur sein Problem. Steht
-- dort mehr, hängen fremde Daten darin.

with ziel as (
  select id, lower(email) as email
    from auth.users
   where lower(email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
),
kandidat as (
  select c.table_name, 'user_id'::text as spalte
    from information_schema.columns c
    join information_schema.tables t
      on  t.table_schema = c.table_schema
      and t.table_name   = c.table_name
      and t.table_type   = 'BASE TABLE'
   where c.table_schema = 'public'
     and c.column_name  = 'user_id'
     and c.data_type    = 'uuid'
  union all select 'user_profiles',   'id'
  union all select 'business_photos', 'profile_id'
),
gemessen as (
  select
    k.table_name,
    z.email,
    (xpath('/row/c/text()',
      query_to_xml(
        format('select count(*) as c from public.%I where %I = %L',
               k.table_name, k.spalte, z.id),
        false, true, '')))[1]::text::bigint as zeilen
  from kandidat k
  cross join ziel z
),
summe as (
  select
    k.table_name,
    (xpath('/row/c/text()',
      query_to_xml(format('select count(*) as c from public.%I', k.table_name),
                   false, true, '')))[1]::text::bigint as gesamt
  from kandidat k
)
select
  g.table_name                                                       as tabelle,
  max(case when g.email = 'iverbohnes@gmail.com' then g.zeilen end)  as admin_iverbohnes,
  max(case when g.email = 'ivergentz@gmail.com'  then g.zeilen end)  as kunde_ivergentz,
  s.gesamt                                                           as zeilen_gesamt
from gemessen g
join summe s on s.table_name = g.table_name
group by g.table_name, s.gesamt
order by
  (max(case when g.email = 'ivergentz@gmail.com' then g.zeilen end) > 0) desc,
  g.table_name;


-- ═══════════════════════════════════════════════════════════════
-- 4 — GOOGLE-VERBINDUNG UND TOKENS
-- ═══════════════════════════════════════════════════════════════
--
-- KEINE Tokenwerte. Geprüft wird ausschließlich, ob einer da ist,
-- wann er abläuft und ob die letzte Erneuerung scheiterte.
--
-- deleted_at ist gesetzt, wenn ein Standort bei Google verschwunden
-- ist — die Zeile bleibt dann als Leiche liegen. Für den Zielzustand
-- zählt die Zeile, nicht ihr deleted_at.
--
-- is_primary = true ist der ausgewählte Standort. Eine eigene Spalte
-- "selected" gibt es nicht; select_google_location setzt is_primary.

select
  u.email,
  ga.id                                   as google_account_id,
  ga.provider_email                       as verbundenes_google_konto,
  ga.status,
  ga.deleted_at                           as konto_geloescht_am,
  ga.granted_scopes,
  ga.refresh_failure_count,
  ga.last_error_code,
  (ot.refresh_token_encrypted is not null) as refresh_token_vorhanden,
  (ot.access_token_encrypted  is not null) as access_token_vorhanden,
  ot.access_token_expires_at,
  ot.last_refreshed_at,
  (select count(*) from public.google_locations gl
    where gl.account_id = ga.id)                     as standorte,
  (select count(*) from public.google_locations gl
    where gl.account_id = ga.id and gl.deleted_at is null) as standorte_aktiv,
  (select string_agg(gl.title, ' | ') from public.google_locations gl
    where gl.account_id = ga.id and gl.is_primary)   as ausgewaehlter_standort
from auth.users u
left join public.google_accounts ga on ga.user_id = u.id
left join public.oauth_tokens   ot on ot.account_id = ga.id
where lower(u.email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
order by u.email, ga.connected_at;


-- ═══════════════════════════════════════════════════════════════
-- 5 — MAIL: OPERATIVER ZUSTAND VS. HISTORIE
-- ═══════════════════════════════════════════════════════════════
--
-- Die Unterscheidung, die der Auftrag verlangt:
--
--   operativ   queued, sending, failed mit Restversuchen
--              → beeinflusst den Smoke, darf weg
--   historie   sent, endgültig failed
--              → Nachweis, dass eine Mail rausging; nicht blind löschen
--
-- email_queue.user_id ist nullable. Mails an eine Adresse, die zu
-- keinem Nutzer gehört (Report-Mails an Leads), haben dort NULL —
-- deshalb zusätzlich über to_email gesucht.

select
  eq.to_email,
  eq.template,
  eq.status,
  case
    when eq.status in ('queued', 'sending')                  then 'OPERATIV'
    when eq.status = 'failed' and eq.attempts < eq.max_attempts then 'OPERATIV (Wiederholung offen)'
    when eq.status = 'sent'                                  then 'HISTORIE'
    else                                                          'HISTORIE (endgültig gescheitert)'
  end                                     as art,
  count(*)                                as anzahl,
  min(eq.created_at)                      as aelteste,
  max(eq.created_at)                      as neueste,
  (eq.user_id is not null)                as haengt_an_nutzer
from public.email_queue eq
where lower(eq.to_email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
   or eq.user_id in (select id from auth.users
                      where lower(email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com'))
group by eq.to_email, eq.template, eq.status, eq.attempts, eq.max_attempts, (eq.user_id is not null)
order by art, eq.to_email, eq.template;


-- ═══════════════════════════════════════════════════════════════
-- 6 — EVENTS: OFFEN VS. ERLEDIGT
-- ═══════════════════════════════════════════════════════════════
--
-- Ziel: Der Kundenaccount startet ohne offene Alt-Events. Ein Event
-- gilt als offen, solange weder resolved_at noch dismissed_at gesetzt
-- ist und es nicht abgelaufen ist.
--
-- in_weekly_email zeigt, ob das Event in die nächste Wochenmail
-- liefe. Genau das würde den Smoke verfälschen.

-- OFFEN zuerst, nicht alphabetisch: Das ist der Befund, auf den es
-- ankommt. "order by zustand" hätte "erledigt" nach oben gestellt und
-- den einzigen Wert verborgen, der den Smoke stört. Der Ausdruck lässt
-- sich in ORDER BY nicht über seinen Alias ansprechen, deshalb die
-- Hülle: so steht die Fallunterscheidung genau einmal da.
select *
from (
  select
    u.email,
    e.category,
    e.type,
    e.lifecycle,
    case
      when e.resolved_at  is not null then 'erledigt'
      when e.dismissed_at is not null then 'weggeklickt'
      when e.expires_at   < now()     then 'abgelaufen'
      else                                 'OFFEN'
    end                                   as zustand,
    count(*)                              as anzahl,
    count(*) filter (where e.in_weekly_email) as davon_in_wochenmail,
    min(e.created_at)                     as aeltestes,
    max(e.created_at)                     as neuestes
  from public.events e
  join auth.users u on u.id = e.user_id
  where lower(u.email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
  group by u.email, e.category, e.type, e.lifecycle,
           case
             when e.resolved_at  is not null then 'erledigt'
             when e.dismissed_at is not null then 'weggeklickt'
             when e.expires_at   < now()     then 'abgelaufen'
             else                                 'OFFEN'
           end
) s
order by (s.zustand <> 'OFFEN'), s.email, s.anzahl desc;


-- ═══════════════════════════════════════════════════════════════
-- 7 — LEADS
-- ═══════════════════════════════════════════════════════════════
--
-- leads hat KEINE Spalte user_id. Die Verknüpfung läuft allein über
-- die E-Mail-Adresse — deshalb findet Abfrage 3 diese Tabelle nicht,
-- und deshalb steht sie hier gesondert.
--
-- Genau daran hängt auch anonymise_user_on_delete(): Die Funktion
-- sucht per WHERE email = OLD.email und überschreibt die Zeile mit
-- 'deleted@werkruf.com'. Sie löscht den Lead also NICHT, sie
-- anonymisiert ihn. Nach einer Kontolöschung bleibt die Zeile mit
-- Firmenname, Gewerk, Stadt und Sichtbarkeitswert bestehen.

select
  l.email,
  l.company_name,
  l.status,
  l.source,
  l.needs_manual_setup,
  l.created_at,
  l.visibility_score
from public.leads l
where lower(l.email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
   or l.email = 'deleted@werkruf.com'
order by l.created_at;


-- ═══════════════════════════════════════════════════════════════
-- 8 — KONTROLLLISTE: TABELLEN OHNE NUTZERBEZUG
-- ═══════════════════════════════════════════════════════════════
--
-- Was eine Nutzerbereinigung NICHT anfassen darf und auch nicht
-- anfassen kann, weil keine Spalte zum Konto führt.
--
-- Erwartet werden hier Betriebstabellen: sync_runs, engine_versions,
-- engine_thresholds, ops_alert_log, ops_alert_mutes,
-- gbp_category_metadata, gbp_api_snapshots, gbp_api_changes,
-- rate_limits, sync_locks, stripe_events.
--
-- Steht in dieser Liste etwas Unerwartetes mit Nutzerdaten darin,
-- ist das ein Befund: Daten ohne Weg zum Konto können bei einer
-- Löschung nicht mitgehen.

select
  t.table_name                            as tabelle,
  (xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from public.%I', t.table_name),
                 false, true, '')))[1]::text::bigint as zeilen
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_type   = 'BASE TABLE'
  and not exists (
        select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name   = t.table_name
           and c.column_name in ('user_id', 'profile_id')
      )
  and t.table_name not in ('user_profiles', 'leads')
order by t.table_name;
