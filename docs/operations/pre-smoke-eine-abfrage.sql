-- docs/operations/pre-smoke-eine-abfrage.sql
--
-- Phase 0A — alles in EINER Abfrage
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESE DATEI GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Der Supabase SQL Editor führt zwar alles aus, was im Fenster
-- steht, zeigt aber nur das Ergebnis der LETZTEN Anweisung. Wer
-- loeschung-beleg.sql oder pre-smoke-inventur.sql hineinkopiert und
-- auf Run drückt, sieht deshalb nur den jeweils letzten Abschnitt —
-- und hält ihn für das ganze Ergebnis.
--
-- Diese Datei ist deshalb EINE einzige Anweisung. Alles hineinkopieren,
-- einmal Run, fertig. Das Ergebnis ist eine lange Liste.
--
-- ═══════════════════════════════════════════════════════════════
-- SICHERHEIT
-- ═══════════════════════════════════════════════════════════════
--
-- Ausschließlich lesend. Kein insert, update, delete, alter, drop.
-- Keine Tokenwerte, keine Secrets, keine Passwortdaten.
-- Beliebig oft wiederholbar.
--
-- Rolle postgres nötig: auth.users ist für andere Rollen nicht lesbar.
--
-- ═══════════════════════════════════════════════════════════════
-- SO LIEST MAN DAS ERGEBNIS
-- ═══════════════════════════════════════════════════════════════
--
-- Drei Spalten:
--   bereich     welcher Teil der Inventur
--   gegenstand  worum es geht
--   wert        das Gemessene
--
-- Die wichtigsten Zeilen stehen oben: zuerst die Kaskadenregeln,
-- dann verwaiste Zeilen, dann der Nutzerbestand.

with ziel as (
  select id, lower(email) as email
    from auth.users
   where lower(email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
),

/* ── Kandidatentabellen für die Zeilenzählung ───────────────────
   Aus dem Systemkatalog, nicht aus einer gepflegten Liste. Eine
   Liste altert still, der Katalog nicht. */
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

/* ── 1 — Fremdschlüsselregeln auf auth.users / user_profiles ─── */
teil_fk as (
  select
    1 as nr,
    'A KASKADENREGEL'::text as bereich,
    (c.conrelid::regclass::text) as gegenstand,
    (case c.confdeltype
       when 'c' then 'CASCADE — wird mitgeloescht'
       when 'n' then 'SET NULL — Zeile bleibt ohne Besitzer'
       when 'd' then 'SET DEFAULT — Zeile bleibt'
       when 'r' then 'RESTRICT — Loeschen scheitert'
       when 'a' then 'NO ACTION — Loeschen scheitert'
       else          'unbekannt: ' || c.confdeltype::text
     end)
    || '  (zeigt auf ' || c.confrelid::regclass::text || ')' as wert
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid in ('auth.users'::regclass, 'public.user_profiles'::regclass)
),

/* ── 2 — Verwaiste Zeilen: Besitzer existiert nicht mehr ─────── */
teil_waisen as (
  select
    2 as nr,
    'B VERWAISTE ZEILEN'::text as bereich,
    k.table_name as gegenstand,
    (xpath('/row/c/text()',
      query_to_xml(
        format('select count(*) as c from public.%I t
                 where t.%I is not null
                   and not exists (select 1 from auth.users u where u.id = t.%I)',
               k.table_name, k.spalte, k.spalte),
        false, true, '')))[1]::text || ' verwaist' as wert
  from kandidat k
),

/* ── 3 — Nutzerbestand, alle Konten ──────────────────────────── */
teil_nutzer as (
  select
    3 as nr,
    'C NUTZERBESTAND'::text as bereich,
    u.email as gegenstand,
    'Rolle=' || coalesce(u.raw_app_meta_data ->> 'role', '-')
      || ' | Profil=' || (case when p.id is null then 'FEHLT' else 'ja' end)
      || ' | plan='   || coalesce(p.plan, '-')
      || ' | bestaetigt=' || (case when u.email_confirmed_at is null then 'nein' else 'ja' end)
      || ' | erstellt=' || to_char(u.created_at, 'YYYY-MM-DD') as wert
  from auth.users u
  left join public.user_profiles p on p.id = u.id
),

/* ── 4 — Zielnutzer: Stripe, Consent, Founding Partner ───────── */
teil_detail as (
  select
    4 as nr,
    'D ZIELNUTZER'::text as bereich,
    u.email as gegenstand,
    'founding=' || (case when p.plan = 'founding_partner' then 'JA' else 'nein' end)
      || ' | seit='        || coalesce(to_char(p.founding_partner_since, 'YYYY-MM-DD'), '-')
      || ' | stripe_cust=' || (case when p.stripe_customer_id is null then 'keine' else 'VORHANDEN' end)
      || ' | stripe_sub='  || coalesce(p.stripe_subscription_status, 'keine')
      || ' | consent='     || coalesce(p.accepted_terms_version, 'keiner')
      || ' | trial_ends='  || coalesce(to_char(p.trial_ends_at, 'YYYY-MM-DD'), '-') as wert
  from auth.users u
  left join public.user_profiles p on p.id = u.id
  where lower(u.email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
),

/* ── 5 — Abhängige Zeilen je Zielnutzer ──────────────────────── */
teil_zeilen as (
  select
    5 as nr,
    'E ABHAENGIGE ZEILEN'::text as bereich,
    k.table_name || ' / ' || z.email as gegenstand,
    (xpath('/row/c/text()',
      query_to_xml(
        format('select count(*) as c from public.%I where %I = %L',
               k.table_name, k.spalte, z.id),
        false, true, '')))[1]::text || ' Zeilen' as wert
  from kandidat k
  cross join ziel z
),

/* ── 6 — Google-Verbindung. Keine Tokenwerte, nur ob vorhanden ─ */
teil_google as (
  select
    6 as nr,
    'F GOOGLE'::text as bereich,
    u.email as gegenstand,
    'konto='      || coalesce(ga.provider_email, 'keines')
      || ' | status='   || coalesce(ga.status, '-')
      || ' | refresh_token=' || (case when ot.refresh_token_encrypted is null then 'nein' else 'ja' end)
      || ' | standorte='     || (select count(*)::text from public.google_locations gl where gl.account_id = ga.id)
      || ' | ausgewaehlt='   || coalesce((select string_agg(gl.title, '+')
                                            from public.google_locations gl
                                           where gl.account_id = ga.id and gl.is_primary), 'keiner') as wert
  from auth.users u
  left join public.google_accounts ga on ga.user_id = u.id
  left join public.oauth_tokens    ot on ot.account_id = ga.id
  where lower(u.email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
),

/* ── 7 — Mail: operativ vs. Historie ─────────────────────────── */
teil_mail as (
  select
    7 as nr,
    'G MAIL'::text as bereich,
    eq.to_email || ' / ' || eq.template as gegenstand,
    (case
       when eq.status in ('queued', 'sending') then 'OPERATIV'
       when eq.status = 'failed' and eq.attempts < eq.max_attempts then 'OPERATIV (Wiederholung offen)'
       when eq.status = 'sent' then 'Historie'
       else 'Historie (endgueltig gescheitert)'
     end) || ' — status=' || eq.status || ', ' || count(*)::text || 'x' as wert
  from public.email_queue eq
  where lower(eq.to_email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
     or eq.user_id in (select id from ziel)
  group by eq.to_email, eq.template, eq.status, eq.attempts, eq.max_attempts
),

/* ── 8 — Events: offen vs. erledigt ──────────────────────────── */
teil_events as (
  select
    8 as nr,
    'H EVENTS'::text as bereich,
    z.email || ' / ' || e.category as gegenstand,
    (case
       when e.resolved_at  is not null then 'erledigt'
       when e.dismissed_at is not null then 'weggeklickt'
       when e.expires_at   < now()     then 'abgelaufen'
       else                                 'OFFEN'
     end) || ' — ' || count(*)::text || 'x'
         || ', davon in Wochenmail: ' || count(*) filter (where e.in_weekly_email)::text as wert
  from public.events e
  join ziel z on z.id = e.user_id
  group by z.email, e.category,
           (case
              when e.resolved_at  is not null then 'erledigt'
              when e.dismissed_at is not null then 'weggeklickt'
              when e.expires_at   < now()     then 'abgelaufen'
              else                                 'OFFEN'
            end)
),

/* ── 9 — Leads. Haengen an der E-Mail, nicht am Nutzer ───────── */
teil_leads as (
  select
    9 as nr,
    'I LEADS'::text as bereich,
    coalesce(l.email, '(ohne E-Mail)') as gegenstand,
    'firma=' || l.company_name || ' | status=' || l.status
      || ' | erstellt=' || to_char(l.created_at, 'YYYY-MM-DD') as wert
  from public.leads l
  where lower(l.email) in ('iverbohnes@gmail.com', 'ivergentz@gmail.com')
     or l.email = 'deleted@werkruf.com'
)

select bereich, gegenstand, wert
from (
  select * from teil_fk
  union all select * from teil_waisen
  union all select * from teil_nutzer
  union all select * from teil_detail
  union all select * from teil_zeilen
  union all select * from teil_google
  union all select * from teil_mail
  union all select * from teil_events
  union all select * from teil_leads
) s
order by nr, gegenstand, wert;
