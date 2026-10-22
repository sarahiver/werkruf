-- 20261022120000_support_antwort.sql
--
-- Antwort auf eine Supportanfrage aus dem Admin — im Produkt und per Mail
--
-- ═══════════════════════════════════════════════════════════════
-- WOZU
-- ═══════════════════════════════════════════════════════════════
--
-- 22.10.2026, erster Durchlauf des Direkten Drahts: Die Anfrage kam im
-- Admin an, aber dort gab es nur "beantwortet" und "erledigt" — kein
-- Antwortfeld. Antworten hiess: Mailprogramm oeffnen. Der Kunde hatte
-- IM PRODUKT gefragt und bekam die Antwort WOANDERS; auf seiner
-- Support-Seite stand nur der Status, nicht der Inhalt.
--
-- Jetzt: Der Anbieter schreibt die Antwort im Admin. Sie steht beim
-- Kunden unter seiner Anfrage, und er bekommt eine Mail mit dem Text,
-- damit er nicht nachsehen muss.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION TUT
-- ═══════════════════════════════════════════════════════════════
--
--   1. Zwei Spalten: admin_reply, replied_at
--   2. Insert-Policy enger: beide muessen beim Anlegen leer sein
--   3. Mailvorlage 'support_reply' im Check-Constraint von email_queue
--   4. Funktion reply_support_request(): Antwort setzen, Status auf
--      answered, Mail einreihen — in EINER Transaktion
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIE MAIL OHNE PLAN-TOR
-- ═══════════════════════════════════════════════════════════════
--
-- Operative Mails (Wochenmail, Sofortmeldungen) laufen durch
-- wants_notification() und das Plan-Tor aus 20261013130000. Diese
-- Mail nicht: Sie ist die Antwort auf eine Frage, die der Kunde selbst
-- gestellt hat. Wer fragt, will die Antwort — das ist keine
-- Benachrichtigung, die man abbestellt. Und Supportanfragen koennen
-- ohnehin nur Founding Partner stellen (Insert-Policy).
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM dedupe_key MIT replied_at
-- ═══════════════════════════════════════════════════════════════
--
-- enqueue_email() ist idempotent ueber dedupe_key. Antwortet der
-- Anbieter ein zweites Mal auf dieselbe Anfrage (Nachtrag,
-- Korrektur), soll AUCH die zweite Mail rausgehen. Deshalb steckt der
-- Zeitpunkt im Schluessel, nicht nur die Anfrage-ID.
--
-- clock_timestamp() statt now(), auf Mikrosekunden: now() ist die
-- Transaktionszeit, und der SQL-Test hat es gezeigt — zwei Antworten
-- in einer Transaktion bekamen denselben Schluessel, die zweite Mail
-- fiel aus (dedupe). In Produktion ist jeder admin-ops-Aufruf eine
-- eigene Transaktion, aber auf diesen Zufall will man nicht bauen.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — Spalten
   ═══════════════════════════════════════════════════════════════ */
alter table public.support_requests
  add column if not exists admin_reply text,
  add column if not exists replied_at  timestamptz;

alter table public.support_requests
  drop constraint if exists support_requests_admin_reply_laenge;
alter table public.support_requests
  add constraint support_requests_admin_reply_laenge
    check (admin_reply is null or char_length(admin_reply) between 1 and 4000);

comment on column public.support_requests.admin_reply is
  'Antwort des Anbieters, wie der Kunde sie sieht. Nur ueber reply_support_request().';

/* ═══════════════════════════════════════════════════════════════
   2 — Insert-Policy: die neuen Spalten muessen beim Anlegen leer sein
   ═══════════════════════════════════════════════════════════════

   Sonst koennte ein Kunde eine Anfrage mit vorgefertigter "Antwort"
   anlegen. Wortgleich zur Fassung aus 20261021140000, plus zwei
   Bedingungen. */
drop policy if exists support_requests_owner_insert on public.support_requests;
create policy support_requests_owner_insert on public.support_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'open'
    and answered_at is null
    and admin_note is null
    and admin_reply is null
    and replied_at is null
    and exists (
      select 1 from public.user_profiles p
       where p.id = (select auth.uid())
         and p.plan = 'founding_partner'
    )
  );

/* ═══════════════════════════════════════════════════════════════
   3 — Mailvorlage zulassen
   ═══════════════════════════════════════════════════════════════

   Vollstaendige Liste aus 20260923120000 plus 'support_reply'. Die
   Vorlage selbst rendert send-email/index.ts; ohne diesen Eintrag
   wuerde enqueue_email() am Check scheitern. */
alter table public.email_queue
  drop constraint if exists email_queue_template_check;
alter table public.email_queue
  add constraint email_queue_template_check check (template = any (array[
    'welcome', 'trial_reminder', 'trial_ended', 'connection_broken',
    'weekly_report', 'weekly_summary', 'visibility_report',
    'critical_review_alert', 'inactivity_reminder', 'payment_failed',
    'support_reply'
  ]));

/* ═══════════════════════════════════════════════════════════════
   4 — Antworten
   ═══════════════════════════════════════════════════════════════

   Eine Funktion, eine Transaktion: Antwort speichern, Status setzen,
   Mail einreihen. Scheitert die Mail am Einreihen, bleibt auch die
   Antwort weg — lieber ein Fehler im Admin als eine Antwort, von der
   der Kunde nie erfaehrt.

   E-Mail und Firmenname kommen aus auth.users und user_profiles,
   nicht aus Parametern: Der Anbieter soll nicht versehentlich an eine
   falsche Adresse antworten koennen. */
create or replace function public.reply_support_request(
  p_request_id uuid,
  p_reply      text
) returns public.support_requests
    language plpgsql
    security definer
    set search_path to 'public'
as $$
declare
  v_zeile   public.support_requests;
  v_email   text;
  v_firma   text;
  v_name    text;
  v_branche text;
  v_mail_id uuid;
begin
  if p_reply is null or char_length(trim(p_reply)) < 1 then
    raise exception 'Antwort ist leer' using errcode = 'check_violation';
  end if;
  if char_length(p_reply) > 4000 then
    raise exception 'Antwort zu lang (max. 4000 Zeichen)' using errcode = 'check_violation';
  end if;

  update public.support_requests
     set admin_reply = trim(p_reply),
         replied_at  = clock_timestamp(),
         status      = 'answered',
         answered_at = coalesce(answered_at, now())
   where id = p_request_id
  returning * into v_zeile;

  if not found then
    raise exception 'Supportanfrage % nicht gefunden', p_request_id
      using errcode = 'no_data_found';
  end if;

  select u.email, p.company_name, p.full_name, coalesce(p.industry_key, 'handwerk')
    into v_email, v_firma, v_name, v_branche
    from auth.users u
    join public.user_profiles p on p.id = u.id
   where u.id = v_zeile.user_id;

  if v_email is null then
    raise exception 'Keine E-Mail-Adresse fuer Nutzer %', v_zeile.user_id
      using errcode = 'no_data_found';
  end if;

  v_mail_id := public.enqueue_email(
    'support_reply',
    v_email,
    'support_reply:' || v_zeile.id || ':' || to_char(v_zeile.replied_at, 'YYYYMMDDHH24MISSUS'),
    v_zeile.user_id,
    coalesce(v_name, v_firma),
    jsonb_build_object(
      'companyName', v_firma,
      'industryKey', v_branche,
      'requestId',   v_zeile.id,
      'betreff',     v_zeile.subject,
      'frage',       left(v_zeile.body, 1200),
      'antwort',     v_zeile.admin_reply,
      'gefragtAm',   v_zeile.created_at
    )
  );

  if v_mail_id is null then
    /* enqueue_email liefert null bei dedupe-Konflikt — mit
       Mikrosekunden im Schluessel praktisch ausgeschlossen, aber nicht
       still uebergehen. */
    raise exception 'Mail konnte nicht eingereiht werden (dedupe)' using errcode = 'unique_violation';
  end if;

  return v_zeile;
end;
$$;

comment on function public.reply_support_request(uuid, text) is
  'Antwort des Anbieters auf eine Supportanfrage: speichert sie, setzt '
  'answered und reiht die Mail support_reply ein. Eine Transaktion. '
  'Nur service_role.';

revoke execute on function public.reply_support_request(uuid, text) from public;
revoke execute on function public.reply_support_request(uuid, text) from anon;
revoke execute on function public.reply_support_request(uuid, text) from authenticated;
grant  execute on function public.reply_support_request(uuid, text) to service_role;

/* ═══════════════════════════════════════════════════════════════
   5 — Selbstpruefung
   ═══════════════════════════════════════════════════════════════ */
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'support_requests'
                    and column_name = 'admin_reply') then
    raise exception '[antwort] Spalte admin_reply fehlt';
  end if;

  /* pg_get_expr() schreibt Schluesselwoerter gross: "admin_reply IS NULL". */
  if position('admin_reply is null' in
       lower(coalesce((select pg_get_expr(polwithcheck, polrelid) from pg_policy
                        where polname = 'support_requests_owner_insert'), ''))) = 0 then
    raise exception '[antwort] Insert-Policy prueft admin_reply nicht';
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'email_queue_template_check'
                    and pg_get_constraintdef(oid) like '%support_reply%') then
    raise exception '[antwort] email_queue laesst support_reply nicht zu';
  end if;

  if has_function_privilege('authenticated',
       'public.reply_support_request(uuid, text)', 'execute') then
    raise exception '[antwort] reply_support_request steht fuer authenticated offen';
  end if;

  raise notice '[antwort] in Ordnung — Spalten, Policy, Vorlage, Funktion';
  raise notice '[antwort] WIRKUNGSLOS fuer die Mail, bis send-email die Vorlage support_reply kennt';
end $$;

commit;
