-- 20261014130000_lesezugriff_eigentumspruefung.sql
--
-- Die Leseseite: SECURITY-DEFINER-Funktionen geben keine fremden
-- Kundendaten mehr heraus.
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND, IN PRODUKTION GEMESSEN
-- ═══════════════════════════════════════════════════════════════
--
-- Gemessen am 14.10.2026. 29 Funktionen sind SECURITY DEFINER +
-- STABLE im Schema public. Davon
--
--   fuer PUBLIC (und damit anon) ausfuehrbar   14
--   nur fuer authenticated ausfuehrbar           9
--
-- SECURITY DEFINER umgeht RLS auch beim LESEN. Die meisten dieser
-- Funktionen nehmen eine p_user_id entgegen und pruefen nicht, wessen
-- Sitzung ruft. Wirkungsprobe in Produktion:
--
--   set local role anon;
--   select public.compute_health_score('0000…0000'::uuid);
--   → {"grund": "kein_standort", "score": null, "scoreVersion": 1}
--
-- Also kein permission denied, sondern eine Antwort. Mit einer
-- echten fremden UUID waeren es echte fremde Daten. Das ist
-- Kundenisolation auf der Leseseite.
--
-- 20261014120000 hat die Schreibseite geschlossen (VOLATILE). Diese
-- Migration ist die Leseseite.
--
-- ═══════════════════════════════════════════════════════════════
-- ZWEI MITTEL, UND WARUM NICHT EINES REICHT
-- ═══════════════════════════════════════════════════════════════
--
-- 1. Grant entziehen — fuer alles, was kein Client ruft.
--
--    Gesucht wurde in src/** nach rpc('name'). Von allen 23 hier
--    betroffenen Funktionen ruft das Frontend genau zwei:
--    events_feed (src/hooks/useEvents.js) und werkruf_score_location
--    (src/hooks/useHealthScore.js). Alle anderen laufen ueber Edge
--    Functions mit SUPABASE_SERVICE_ROLE_KEY oder werden von anderen
--    SQL-Funktionen gerufen.
--
-- 2. Eigentumspruefung im Rumpf — fuer die, die ein Client ruft.
--
--    Ein entzogener Grant ist richtig, aber flach: er schuetzt nur,
--    solange niemand ihn versehentlich wieder vergibt. Wo ein Client
--    die Funktion wirklich braucht, muss die Funktion selbst wissen,
--    wessen Daten sie herausgibt. Deshalb bekommen die acht
--    Funktionen mit p_user_id, die heute fuer authenticated offen
--    stehen, eine Pruefung gegen auth.uid().
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NICHT current_user ODER session_user
-- ═══════════════════════════════════════════════════════════════
--
-- Das ist die Falle, und sie ist gemessen, nicht vermutet. In einer
-- SECURITY-DEFINER-Funktion ist current_user der EIGENTUEMER, nicht
-- der Aufrufer. Nachgesehen am 14.10.2026 in der Testdatenbank, in
-- einer Definer-Funktion unter "set local role authenticated":
--
--   current_user=postgres  session_user=postgres
--   guc_role=authenticated
--
-- Eine Pruefung "if current_user = 'authenticated'" waere also immer
-- falsch und damit wirkungslos — eine Sicherheit, die nur im Text
-- steht. Was bleibt, ist die Rollen-GUC: PostgREST setzt je Anfrage
-- "set local role <rolle aus dem JWT>", und die GUC ueberlebt den
-- Eintritt in die Definer-Funktion.
--
-- Deshalb prueft public.assert_eigener_zugriff() zwei Dinge:
--
--   1. Ist eine Sitzung da (auth.uid() ist nicht null), muss sie zur
--      angefragten p_user_id passen — unabhaengig von der Rolle.
--   2. Ruft eine Clientrolle (authenticated oder anon), MUSS eine
--      Sitzung da sein. Ein JWT ohne sub kommt damit nicht durch.
--
-- Serverpfade haben keine Sitzung und keine Clientrolle: cron laeuft
-- mit role "none", die Edge Functions mit role "service_role". Beide
-- kommen durch. Das ist Absicht — sie arbeiten fuer alle Nutzer.
--
-- ═══════════════════════════════════════════════════════════════
-- WIE DIE RUEMPFE GEAENDERT WERDEN, OHNE SIE ZU KOPIEREN
-- ═══════════════════════════════════════════════════════════════
--
-- Sechs der acht sind plpgsql. Fuer sie liest Abschnitt 3 die
-- bestehende Definition mit pg_get_functiondef aus dem Katalog,
-- setzt eine Zeile hinter das toplevel "begin" und fuehrt das
-- Ergebnis aus.
--
-- Das ist bewusst so und nicht aus Bequemlichkeit: ein hier
-- einkopierter Rumpf waere der Rumpf, den das Repo FUER richtig
-- haelt. G2.1 hat gemessen, dass Repo und Produktion
-- auseinanderlaufen koennen — acht Sichten und eine Funktion gab es
-- nur in Produktion. Ein einkopierter Rumpf wuerde so einen
-- Unterschied stillschweigend ueberschreiben. Der Katalog dagegen
-- ist das, was wirklich laeuft.
--
-- Abgesichert ist das in beide Richtungen:
--
--   - der Einfuegepunkt muss HINTER "AS $function$" liegen, sonst
--     Abbruch (sonst schriebe die Migration in den Kopf)
--   - wird kein toplevel "begin" gefunden, Abbruch mit Namen
--   - ist die Pruefung schon drin, passiert nichts (wiederholbar)
--
-- Zwei der acht sind "language sql" und haben keinen begin-Block.
-- Ihre Ruempfe stehen in Abschnitt 4 ausgeschrieben, als plpgsql.
-- Damit das kein stilles Ueberschreiben einer abweichenden
-- Produktionsfassung wird, prueft Abschnitt 4 vorher die Pruefsumme
-- des bestehenden Rumpfes und bricht bei Abweichung ab.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION NICHT TUT
-- ═══════════════════════════════════════════════════════════════
--
-- Keine Daten, keine Tabellen, keine Policies. Keine fachliche Logik
-- wird geaendert: die Ruempfe bekommen eine Zeile davor, sonst
-- nichts. Keine Signatur, kein Rueckgabetyp, keine Argumentnamen
-- aendern sich — create or replace koennte das gar nicht.
--
-- Die beiden toten sync_events-Ueberladungen bleiben geschlossen und
-- werden nicht geloescht (ausdruecklich so entschieden).
--
-- Wiederholbar.

begin;

/* ═══════════════════════════════════════════════════════════
   0 — VORBEDINGUNGEN
   ═══════════════════════════════════════════════════════════

   Ohne auth.uid() hat die Pruefung keinen Sinn, und ohne die
   Clientrollen scheitert jeder revoke mit 42704. Beides wird
   geprueft und nicht hergestellt. */

do $$
declare
  v_fehlt text[] := array[]::text[];
  v_rolle text;
begin
  foreach v_rolle in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = v_rolle) then
      v_fehlt := v_fehlt || ('Rolle ' || v_rolle);
    end if;
  end loop;

  if pg_catalog.to_regprocedure('auth.uid()') is null then
    v_fehlt := v_fehlt || 'Funktion auth.uid()';
  end if;

  if pg_catalog.array_length(v_fehlt, 1) is not null then
    raise exception
      E'Vorbedingung fehlt: %\n'
      '  Diese Migration gehoert in eine Supabase-Datenbank.',
      pg_catalog.array_to_string(v_fehlt, ', ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════
   1 — DIE EIGENTUMSPRUEFUNG
   ═══════════════════════════════════════════════════════════

   Eine Stelle, acht Aufrufer. Acht Kopien derselben Pruefung waeren
   acht Stellen, an denen eine davon spaeter abweicht.

   SECURITY INVOKER ist hier richtig: die Funktion liest nur
   Einstellungen der Sitzung und braucht keine fremden Rechte. Aus
   einer Definer-Funktion heraus gerufen laeuft sie ohnehin unter
   deren Eigentuemer, deshalb braucht sie keinen Client-Grant. */

create or replace function public.assert_eigener_zugriff(p_user_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_rolle   text := coalesce(pg_catalog.current_setting('role', true), 'none');
  v_sitzung uuid := auth.uid();
begin
  /* 1. Eine vorhandene Sitzung darf nur sich selbst lesen. Gilt fuer
        jede Rolle, auch fuer eine unerwartete. */
  if v_sitzung is not null and v_sitzung <> p_user_id then
    raise exception
      'Zugriff auf Daten eines anderen Kontos'
      using errcode = '42501',
            detail  = 'Die Sitzung gehoert zu einem anderen Nutzer.',
            hint    = 'Diese Funktion gibt nur die Daten der eigenen Sitzung heraus.';
  end if;

  /* 2. Eine Clientrolle braucht eine Sitzung. Ohne diese Pruefung
        kaeme ein JWT mit role=authenticated, aber ohne sub, durch —
        auth.uid() waere null, und Pruefung 1 griffe nicht. */
  if v_rolle in ('authenticated', 'anon') and v_sitzung is null then
    raise exception
      'Keine Sitzung'
      using errcode = '42501',
            detail  = 'Rolle ' || v_rolle || ' ohne auth.uid().',
            hint    = 'Erneut anmelden.';
  end if;
end
$fn$;

revoke all on function public.assert_eigener_zugriff(uuid) from public, anon, authenticated;
grant execute on function public.assert_eigener_zugriff(uuid) to service_role;

comment on function public.assert_eigener_zugriff(uuid) is
  'Wirft 42501, wenn eine Clientsitzung fremde Daten anfragt. Serverpfade (role none/service_role, keine Sitzung) kommen durch. Siehe 20261014130000.';

/* ═══════════════════════════════════════════════════════════
   2 — GRANTS: ALLES ZU, WAS KEIN CLIENT RUFT
   ═══════════════════════════════════════════════════════════

   Die 14 fuer PUBLIC offenen, has_paid_access und die sechs
   Lesefunktionen ohne Frontend-Aufrufer. Signaturen vollstaendig aus
   der Produktionsmessung vom 14.10.2026, nicht nach Namen.

   has_paid_access steht hier, weil das Grant aus meiner eigenen
   H1-Migration 20261013130000 stammt und unnoetig war: die Funktion
   wird nur von wants_operational_mail() und damit vom Mailpfad
   gerufen, nie aus dem Browser. */

do $$
declare
  v_sig   text;
  v_fehlt text[] := array[]::text[];
  v_liste text[] := array[
    /* ── die 14, in Produktion fuer PUBLIC offen ── */
    'build_evaluation_context(p_user_id uuid)',
    'completed_this_week(p_user_id uuid, p_since timestamp with time zone)',
    'compute_health_score(p_user_id uuid)',
    'explain_recommendation(p_event_id uuid)',
    'get_engine_thresholds()',
    'is_in_cooldown(p_user_id uuid, p_type text, p_subject_id uuid)',
    'last_email_sent(p_user_id uuid, p_template text)',
    'plan_communications(p_user_id uuid, p_now timestamp with time zone)',
    'read_impact_metric(p_user_id uuid, p_metric text)',
    'sync_failure_resolved(p_user_id uuid, p_account_id uuid, p_job_type text, p_location_id uuid, p_failed_at timestamp with time zone)',
    'top_events(p_user_id uuid, p_channel text, p_limit integer)',
    'top_recommendations_for_email(p_user_id uuid, p_limit integer)',
    'wants_notification(p_user_id uuid, p_kind text)',
    'weekly_recommendation_summary(p_user_id uuid, p_since timestamp with time zone)',
    /* ── fuer authenticated offen, ohne Frontend-Aufrufer ── */
    'has_paid_access(p_user_id uuid)',
    'build_location_evaluation_context(p_user_id uuid, p_location_id uuid)',
    'compute_location_health_score(p_user_id uuid, p_location_id uuid)',
    'previous_location_health(p_user_id uuid, p_location_id uuid, p_score_version smallint)',
    'read_location_impact_metric(p_user_id uuid, p_location_id uuid, p_metric text)',
    'weekly_mail_events(p_user_id uuid, p_location_id uuid, p_limit integer)',
    'weekly_payload_for(p_user_id uuid)'
  ];
begin
  foreach v_sig in array v_liste loop
    if not exists (
      select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_sig
    ) then
      v_fehlt := v_fehlt || v_sig;
      continue;
    end if;

    execute pg_catalog.format('revoke execute on function public.%s from public', v_sig);
    execute pg_catalog.format('revoke execute on function public.%s from anon', v_sig);
    execute pg_catalog.format('revoke execute on function public.%s from authenticated', v_sig);
    execute pg_catalog.format('grant execute on function public.%s to service_role', v_sig);
  end loop;

  if pg_catalog.array_length(v_fehlt, 1) is not null then
    raise exception
      E'Signaturen nicht gefunden:\n  %\n'
      '  Die Liste stammt aus der Produktionsmessung vom 14.10.2026.\n'
      '  Weicht die Datenbank ab, zuerst neu messen:\n'
      '  docs/h2-2-security-audit.md Abschnitt 1.',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;

/* Die zwei echten Client-RPCs behalten authenticated — ausdruecklich,
   damit die Sollmatrix an einer Stelle steht. */

do $$
declare
  v_sig   text;
  v_fehlt text[] := array[]::text[];
  v_liste text[] := array[
    'events_feed(p_user_id uuid, p_location_id uuid, p_limit integer, p_offset integer, p_category text, p_lifecycle text[], p_include_account boolean)',
    'werkruf_score_location(p_user_id uuid)'
  ];
begin
  foreach v_sig in array v_liste loop
    if not exists (
      select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname || '('
             || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_sig
    ) then
      v_fehlt := v_fehlt || v_sig;
      continue;
    end if;

    execute pg_catalog.format('revoke execute on function public.%s from public', v_sig);
    execute pg_catalog.format('revoke execute on function public.%s from anon', v_sig);
    execute pg_catalog.format('grant execute on function public.%s to authenticated', v_sig);
    execute pg_catalog.format('grant execute on function public.%s to service_role', v_sig);
  end loop;

  if pg_catalog.array_length(v_fehlt, 1) is not null then
    raise exception
      E'Client-RPC nicht gefunden:\n  %',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════
   3 — EIGENTUMSPRUEFUNG IN DIE SECHS PLPGSQL-RUEMPFE
   ═══════════════════════════════════════════════════════════

   Gelesen wird aus dem Katalog, nicht aus dem Repo. Begruendung im
   Kopf dieser Datei. */

do $$
declare
  v_sig     text;
  v_oid     oid;
  v_quelle  text;
  v_def     text;
  v_neu     text;
  v_as      integer;
  v_begin   integer;
  v_treffer text;
  v_handler text;
  v_fehlt   text[] := array[]::text[];
  v_liste   text[] := array[
    'build_location_evaluation_context(p_user_id uuid, p_location_id uuid)',
    'compute_location_health_score(p_user_id uuid, p_location_id uuid)',
    'events_feed(p_user_id uuid, p_location_id uuid, p_limit integer, p_offset integer, p_category text, p_lifecycle text[], p_include_account boolean)',
    'previous_location_health(p_user_id uuid, p_location_id uuid, p_score_version smallint)',
    'read_location_impact_metric(p_user_id uuid, p_location_id uuid, p_metric text)',
    'weekly_payload_for(p_user_id uuid)'
  ];
begin
  foreach v_sig in array v_liste loop
    select p.oid, p.prosrc
      into v_oid, v_quelle
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_sig;

    if v_oid is null then
      v_fehlt := v_fehlt || (v_sig || ' — nicht gefunden');
      continue;
    end if;

    /* Schon gehaertet: nichts tun. Das macht die Migration
       wiederholbar. */
    if v_quelle like '%assert_eigener_zugriff%' then
      continue;
    end if;

    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_treffer := pg_catalog.substring(v_def, E'\n[ \t]*begin[ \t]*\n');

    if v_treffer is null then
      v_fehlt := v_fehlt || (v_sig || ' — kein toplevel begin gefunden');
      continue;
    end if;

    v_as    := pg_catalog.strpos(v_def, 'AS $function$');
    v_begin := pg_catalog.strpos(v_def, v_treffer);

    /* Der Einfuegepunkt muss im Rumpf liegen, nicht im Kopf. Ohne
       diese Pruefung koennte eine kuenftige Katalogdarstellung dazu
       fuehren, dass die Migration in die Signatur schreibt. */
    if v_as = 0 or v_begin < v_as then
      v_fehlt := v_fehlt
        || (v_sig || ' — begin liegt nicht im Rumpf (AS bei '
            || v_as::text || ', begin bei ' || v_begin::text || ')');
      continue;
    end if;

    v_neu := pg_catalog.overlay(
               v_def,
               v_treffer || '  perform public.assert_eigener_zugriff(p_user_id);' || E'\n',
               v_begin,
               pg_catalog.length(v_treffer));

    /* ── Und jetzt der Teil, den der erste Entwurf uebersehen hat ──

       Zwei dieser Ruempfe enden mit

         exception when others then
           return jsonb_build_object(..., 'grund', 'fehler', ...);

       Ein "when others" faengt auch 42501. Die Pruefung lief, warf,
       und der Handler machte daraus ein freundliches JSON — die
       Funktion gab die fremden Daten zwar nicht heraus, meldete den
       Zugriffsfehler aber auch nicht, und bei
       compute_location_health_score stand sqlerrm sogar im Ergebnis.

       Aufgefallen ist das nicht beim Lesen, sondern in der
       A/B-Gegenprobe: A las B, und nichts beschwerte sich.

       Deshalb bekommt ein solcher Handler als erste Zeile ein
       Weiterwerfen der Zugriffsfehler. Alles andere faengt er
       weiterhin ab — das ist seine Aufgabe. */
    v_handler := pg_catalog.substring(
                   v_neu,
                   E'\nexception[ \t\r\n]*when[ \t]+others[ \t]+then[ \t]*\n');

    /* Erkannt wird der Handler am Zeilenanfang, nicht am Wort.

       Der erste Entwurf suchte nach "when others" im ganzen Text und
       brach bei previous_location_health ab — dort steht der
       Ausdruck in einem KOMMENTAR ("Bewusst NUR undefined_column:
       Ein weiter gefasstes `when others` ..."). Dieselbe Falle, vor
       der G2.2 §29 warnt, diesmal in meiner eigenen Erkennung.

       Bleibt die Suche leer, steht aber trotzdem irgendwo ein
       Handler am Zeilenanfang, bricht die Migration ab, statt die
       Pruefung stillschweigend verschlucken zu lassen. */
    if v_handler is null then
      if v_neu ~ E'(?n)^[ \t]*when[ \t]+others[ \t]+then' then
        v_fehlt := v_fehlt
          || (v_sig || ' — hat einen when-others-Handler in einer Form, '
              || 'die diese Migration nicht kennt');
        continue;
      end if;
    else
      v_neu := pg_catalog.overlay(
                 v_neu,
                 v_handler || '  if sqlstate = ''42501'' then raise; end if;' || E'\n',
                 pg_catalog.strpos(v_neu, v_handler),
                 pg_catalog.length(v_handler));
    end if;

    execute v_neu;
  end loop;

  if pg_catalog.array_length(v_fehlt, 1) is not null then
    raise exception
      E'Ruempfe nicht haertbar:\n  %\n'
      '  Nichts wurde geaendert. Bitte die betroffene Funktion\n'
      '  einzeln ansehen, statt die Pruefung zu lockern.',
      pg_catalog.array_to_string(v_fehlt, E'\n  ');
  end if;
end $$;

/* ═══════════════════════════════════════════════════════════
   4 — DIE ZWEI SQL-FUNKTIONEN
   ═══════════════════════════════════════════════════════════

   "language sql" hat keinen begin-Block, in den sich eine Zeile
   setzen liesse. Diese beiden Ruempfe stehen deshalb ausgeschrieben,
   unveraendert aus dem Katalog uebernommen und in plpgsql gefasst:
   die Abfrage ist dieselbe, sie steht nur in einem return.

   Vorher prueft die Migration, dass der Rumpf in dieser Datenbank
   der ist, den ich gelesen habe. Weicht er ab, bricht sie ab,
   statt eine abweichende Produktionsfassung zu ueberschreiben. */

do $$
declare
  v_ist     text;
  v_abweich text[] := array[]::text[];
  v_zeile   record;
begin
  for v_zeile in
    select *
      from (values
        ('werkruf_score_location(p_user_id uuid)',
         'ac18d3c824c9cf309a10d49df982f2b3'),
        ('weekly_mail_events(p_user_id uuid, p_location_id uuid, p_limit integer)',
         '34edbebfe3d9d70fd0fc60756f4c74a2')
      ) as v(sig, pruefsumme)
  loop
    select pg_catalog.md5(p.prosrc)
      into v_ist
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_zeile.sig;

    if v_ist is null then
      v_abweich := v_abweich || (v_zeile.sig || ' — nicht gefunden');
    elsif v_ist <> v_zeile.pruefsumme
          and not exists (
            select 1
              from pg_catalog.pg_proc p
              join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname || '('
                   || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v_zeile.sig
               and p.prosrc like '%assert_eigener_zugriff%'
          ) then
      v_abweich := v_abweich
        || (v_zeile.sig || ' — Rumpf weicht ab (erwartet '
            || v_zeile.pruefsumme || ', ist ' || v_ist || ')');
    end if;
  end loop;

  if pg_catalog.array_length(v_abweich, 1) is not null then
    raise exception
      E'Rumpf weicht von der gelesenen Fassung ab:\n  %\n'
      '  Diese Migration wuerde die Produktionsfassung ueberschreiben.\n'
      '  Bitte den Rumpf schicken, statt die Pruefsumme anzupassen:\n'
      '    select pg_catalog.pg_get_functiondef(p.oid) ...',
      pg_catalog.array_to_string(v_abweich, E'\n  ');
  end if;
end $$;

create or replace function public.werkruf_score_location(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_eigener_zugriff(p_user_id);

  return (
    with aktive as (
      select id, selected_at
      from public.google_locations
      where user_id = p_user_id and deleted_at is null
    )
    select case
      when (select count(*) from aktive) = 1
        then (select id from aktive)
      else (select id from aktive where selected_at is not null
             order by selected_at desc limit 1)
    end
  );
end
$fn$;

create or replace function public.weekly_mail_events(
  p_user_id     uuid,
  p_location_id uuid,
  p_limit       integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_eigener_zugriff(p_user_id);

  return (
    with sichtbar as (
      select e.*
      from public.events e
      where e.user_id = p_user_id
        /* Dieser Betrieb plus echte Konto-Ereignisse. Eine verlorene
           Verbindung betrifft jeden Betrieb und gehoert in jede Mail. */
        and (e.location_id = p_location_id or e.location_id is null)
        and e.in_weekly_email
        and e.lifecycle in ('new', 'seen', 'opened')
        and (e.cooldown_until is null or e.cooldown_until <= pg_catalog.now())
        and (e.expires_at is null or e.expires_at > pg_catalog.now())
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',                s.id,
      'type',              s.type,
      'category',          s.category,
      'priority',          s.priority,
      'title',             s.title,
      'summary',           s.summary,
      'reason',            s.reason,
      'recommendedAction', s.recommended_action,
      'actionUrl',         s.action_url,
      'estimatedEffort',   s.estimated_effort,
      /* Die Zahl, nicht der Text. Ein Wochenbudget laesst sich nicht
         aus "5 Minuten" per Regex errechnen. */
      'estimatedMinutes',  s.estimated_minutes,
      'impact',            s.impact,
      'locationId',        s.location_id,
      'scope',             case when s.location_id is null then 'account' else 'location' end
    ) order by s.priority desc, s.created_at asc, s.id asc), '[]'::jsonb)
    from (
      select * from sichtbar
      order by priority desc, created_at asc, id asc
      limit greatest(coalesce(p_limit, 3), 0)
    ) s
  );
end
$fn$;

/* create or replace erhaelt die bestehenden Rechte. Fuer
   werkruf_score_location ist das gewollt (authenticated bleibt),
   weekly_mail_events wurde in Abschnitt 2 geschlossen. Zur Sicherheit
   beides noch einmal ausdruecklich. */

revoke execute on function public.weekly_mail_events(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.weekly_mail_events(uuid, uuid, integer)
  to service_role;

revoke execute on function public.werkruf_score_location(uuid) from public, anon;
grant execute on function public.werkruf_score_location(uuid) to authenticated, service_role;

/* ═══════════════════════════════════════════════════════════
   5 — SELBSTPRUEFUNG
   ═══════════════════════════════════════════════════════════

   Fail closed. Gemessen wird mit has_function_privilege, nicht mit
   aclexplode(proacl): proacl = null heisst "PostgreSQL-Vorgabe gilt",
   und die Vorgabe fuer Funktionen ist EXECUTE fuer PUBLIC. Eine
   Pruefung ueber aclexplode allein saehe solche Funktionen nicht. */

do $$
declare
  v_befunde text[] := array[]::text[];
  v_zeile   record;
begin
  /* ── A: keine definer+stable-Funktion ist fuer Clients erreichbar,
        ausser den zwei Client-RPCs ── */
  for v_zeile in
    select p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig,
           pg_catalog.has_function_privilege('public', p.oid, 'execute') as pub,
           pg_catalog.has_function_privilege('anon', p.oid, 'execute') as anon,
           pg_catalog.has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.provolatile = 's'
     order by 1
  loop
    if v_zeile.sig in (
         'events_feed(p_user_id uuid, p_location_id uuid, p_limit integer, p_offset integer, p_category text, p_lifecycle text[], p_include_account boolean)',
         'werkruf_score_location(p_user_id uuid)') then
      if v_zeile.pub or v_zeile.anon or not v_zeile.auth then
        v_befunde := v_befunde
          || ('Client-RPC falsch gesetzt: ' || v_zeile.sig
              || ' public=' || v_zeile.pub::text
              || ' anon=' || v_zeile.anon::text
              || ' auth=' || v_zeile.auth::text);
      end if;
    elsif v_zeile.pub or v_zeile.anon or v_zeile.auth then
      v_befunde := v_befunde
        || ('fuer Clients offen: ' || v_zeile.sig
            || ' public=' || v_zeile.pub::text
            || ' anon=' || v_zeile.anon::text
            || ' auth=' || v_zeile.auth::text);
    end if;
  end loop;

  /* ── B: die acht Ruempfe tragen die Pruefung wirklich ── */
  for v_zeile in
    select v.sig
      from (values
        ('build_location_evaluation_context(p_user_id uuid, p_location_id uuid)'),
        ('compute_location_health_score(p_user_id uuid, p_location_id uuid)'),
        ('events_feed(p_user_id uuid, p_location_id uuid, p_limit integer, p_offset integer, p_category text, p_lifecycle text[], p_include_account boolean)'),
        ('previous_location_health(p_user_id uuid, p_location_id uuid, p_score_version smallint)'),
        ('read_location_impact_metric(p_user_id uuid, p_location_id uuid, p_metric text)'),
        ('weekly_mail_events(p_user_id uuid, p_location_id uuid, p_limit integer)'),
        ('weekly_payload_for(p_user_id uuid)'),
        ('werkruf_score_location(p_user_id uuid)')
      ) as v(sig)
     where not exists (
       select 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname || '('
              || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = v.sig
          and p.prosrc like '%assert_eigener_zugriff%')
     order by 1
  loop
    v_befunde := v_befunde || ('ohne Eigentumspruefung: ' || v_zeile.sig);
  end loop;

  /* ── B2: wo ein when-others-Handler steht, muss er 42501
        weiterwerfen. Sonst ist die Pruefzeile aus B zwar da, wird
        aber verschluckt — gemessen, nicht vermutet. ── */
  for v_zeile in
    select p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc like '%assert_eigener_zugriff%'
       and p.prosrc ~ E'(?n)^[ \t]*when[ \t]+others[ \t]+then'
       and p.prosrc not like '%if sqlstate = ''42501'' then raise%'
     order by 1
  loop
    v_befunde := v_befunde
      || ('when-others verschluckt die Zugriffspruefung: ' || v_zeile.sig);
  end loop;

  /* ── C: service_role erreicht weiterhin alles ── */
  for v_zeile in
    select p.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.provolatile = 's'
       and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute')
     order by 1
  loop
    v_befunde := v_befunde || ('service_role gesperrt: ' || v_zeile.sig);
  end loop;

  if pg_catalog.array_length(v_befunde, 1) is not null then
    raise exception
      E'Selbstpruefung fehlgeschlagen:\n  %',
      pg_catalog.array_to_string(v_befunde, E'\n  ');
  end if;
end $$;

commit;
