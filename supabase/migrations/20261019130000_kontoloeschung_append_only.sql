-- 20261019130000_kontoloeschung_append_only.sql
--
-- Kontolöschung ermöglichen, ohne append-only aufzugeben
--
-- ═══════════════════════════════════════════════════════════════
-- DER BEFUND
-- ═══════════════════════════════════════════════════════════════
--
-- Am 19.10.2026 ließ sich kein einziges Konto löschen. Gemessen mit
-- docs/operations/loeschung-probe.sql und docs/operations/
-- loeschung-blocker.sql ergaben sich vier Hindernisse auf zwei
-- Tabellen:
--
--   audit_logs.user_id            SET NULL  braucht UPDATE  → audit_logs_immutable
--   recommendation_events.user_id      CASCADE   braucht DELETE  → rec_events_immutable
--   recommendation_events.event_id     CASCADE   braucht DELETE  → rec_events_immutable
--   recommendation_events.location_id  SET NULL  braucht UPDATE  → rec_events_immutable
--
-- Beide Tabellen tragen reject_mutation() als BEFORE-Trigger für
-- UPDATE und DELETE. Die Funktion wirft bedingungslos.
--
-- Betroffen war jeder Nutzer mit mindestens einer Audit- oder
-- Empfehlungszeile — praktisch jeder. DSGVO Art. 17 war damit nicht
-- erfüllbar, AVV § 12 versprach eine Löschung, die technisch nicht
-- ging, und der Knopf "Konto löschen" scheiterte, NACHDEM
-- delete-account bereits das Stripe-Abo gekündigt und die
-- Cloudinary-Fotos zerstört hatte.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS NICHT DAS PROBLEM WAR
-- ═══════════════════════════════════════════════════════════════
--
-- Die Löschregeln. Sie sind stimmig und bleiben deshalb unverändert:
--
--   audit_logs            → SET NULL: Zeile behalten, Person entkoppeln.
--                           Richtig, denn hier stehen Admin-Aktionen an
--                           Kundenkonten. Würden sie mitgelöscht, könnte
--                           ein Admin seine Spuren beseitigen, indem er
--                           den Kunden löscht.
--   recommendation_events → CASCADE: mit dem Konto verschwinden.
--                           Richtig, denn es ist Nutzungsanalytik.
--
-- Diese Migration ändert KEINEN Fremdschlüssel.
--
-- Das Problem war, dass die Datenbank ihre eigenen erklärten Regeln
-- nicht ausführen durfte. reject_mutation() unterscheidet nicht, ob
-- eine Änderung aus der Anwendung kommt oder aus der referenziellen
-- Integrität von PostgreSQL selbst.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIE TRIGGER BLEIBEN
-- ═══════════════════════════════════════════════════════════════
--
-- Naheliegend wäre, sie zu entfernen und auf Tabellenrechte zu
-- setzen. Das wäre falsch. 20261012140000_deny_by_default.sql legt
-- fest:
--
--   revoke all on tables from anon, authenticated;
--   grant all   on tables to   service_role;
--
-- service_role hat volle Tabellenrechte, und damit laufen sämtliche
-- Edge Functions. Der Trigger ist also die EINZIGE Barriere, die
-- verhindert, dass eine Funktion die Prüfspur umschreibt. Wer ihn
-- entfernt, beseitigt eine echte Sicherheitskontrolle.
--
-- Deshalb: enge Ausnahme statt Abschaffung.
--
-- ═══════════════════════════════════════════════════════════════
-- WIE DIE AUSNAHME FUNKTIONIERT
-- ═══════════════════════════════════════════════════════════════
--
-- on_user_deleted läuft ohnehin schon BEFORE DELETE auf auth.users,
-- also vor der gesamten Kaskade. Dort wird eine Markierung gesetzt:
--
--   set_config('werkruf.konto_loeschung', 'an', true)
--
-- Das dritte Argument ist entscheidend: true heißt
-- TRANSAKTIONSLOKAL. Die Markierung verschwindet beim COMMIT oder
-- ROLLBACK von selbst. Es gibt nichts zurückzusetzen und nichts zu
-- vergessen. Außerhalb einer laufenden Kontolöschung ist sie nie
-- gesetzt.
--
-- reject_mutation() lässt Änderungen nur durch, solange sie gesetzt
-- ist. Für alles andere — jede Edge Function, jeder Admin,
-- service_role eingeschlossen — bleiben beide Tabellen
-- unveränderlich.
--
-- Bekannte Grenze, bewusst in Kauf genommen und hier notiert: Wer
-- in DERSELBEN Transaktion einen Nutzer löscht und danach eine
-- Audit-Zeile ändert, käme damit durch. Das setzt Datenbankzugriff
-- und einen gezielt gebauten Transaktionsablauf voraus. Gegen einen
-- Angreifer mit dieser Stellung schützt auch der heutige Trigger
-- nicht, denn er könnte ihn schlicht löschen.
--
-- ═══════════════════════════════════════════════════════════════
-- ZWEITER PUNKT: IP-ADRESSE UND BROWSERKENNUNG
-- ═══════════════════════════════════════════════════════════════
--
-- audit_logs enthält ip_address und user_agent. Das sind
-- personenbezogene Daten. user_id auf NULL zu setzen entfernt sie
-- nicht — nach einer Löschung nach Art. 17 stünden IP-Adresse und
-- Browserkennung weiter in der Datenbank.
--
-- anonymise_user_on_delete() leert sie deshalb mit. Danach bleibt
-- nachweisbar, WAS geschah, und verschwindet, WER es war.
--
-- Nebenwirkung, die erwünscht ist: Weil die Funktion user_id selbst
-- schon auf NULL setzt, findet die nachfolgende SET-NULL-Regel des
-- Fremdschlüssels keine Zeile mehr vor. Sie läuft ins Leere statt
-- ein zweites Mal zu ändern.
--
-- ═══════════════════════════════════════════════════════════════
-- WIRKUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Ersetzt zwei Funktionen. Keine Tabelle, kein Fremdschlüssel, kein
-- Trigger und keine Zeile wird verändert. Bestehende Daten bleiben
-- unberührt.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — reject_mutation() mit enger Ausnahme
   ═══════════════════════════════════════════════════════════════

   Der Rumpf ist bis auf die Ausnahme unverändert, einschließlich
   errcode restrict_violation und der Meldung. Wer heute auf diese
   Meldung prüft, prüft morgen dasselbe. */
create or replace function public.reject_mutation() returns trigger
    language plpgsql
    as $$
begin
  /* Transaktionslokale Markierung, gesetzt ausschliesslich von
     anonymise_user_on_delete(). current_setting(..., true) liefert
     NULL statt eines Fehlers, wenn die Einstellung nie gesetzt
     wurde — das ist der Normalfall und darf nicht werfen. */
  if coalesce(current_setting('werkruf.konto_loeschung', true), '') = 'an' then
    if tg_op = 'DELETE' then
      return old;
    else
      return new;
    end if;
  end if;

  raise exception 'Tabelle % ist append-only', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   2 — anonymise_user_on_delete(): Markierung setzen und
       audit_logs entpersonalisieren
   ═══════════════════════════════════════════════════════════════

   Tabellennamen sind jetzt schemaqualifiziert und search_path ist
   festgenagelt. Die Funktion laeuft als SECURITY DEFINER; ohne
   festen search_path koennte ein Aufrufer mit eigenem search_path
   bestimmen, welche Tabelle "leads" meint. */
create or replace function public.anonymise_user_on_delete() returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $$
begin
  /* Muss VOR den Aenderungen stehen: Die Kaskade laeuft nach diesem
     Trigger, und die Updates unten brauchen die Markierung selbst.
     true = transaktionslokal, raeumt sich selbst auf. */
  perform set_config('werkruf.konto_loeschung', 'an', true);

  /* Leads anonymisieren, nicht loeschen — sie haengen an der
     E-Mail-Adresse, nicht am Konto, und traegen Vertriebshistorie.
     status = 'deleted' ist seit 20261019120000 erlaubt. */
  update public.leads
     set email          = 'deleted@werkruf.com',
         contact_person = 'Gelöschter Nutzer',
         phone          = '-',
         status         = 'deleted'
   where email = old.email;

  /* Pruefspur entpersonalisieren, Zeile behalten. ip_address und
     user_agent muessen mit, sonst ueberlebt der Personenbezug die
     Loeschung. */
  update public.audit_logs
     set user_id    = null,
         ip_address = null,
         user_agent = null
   where user_id = old.id;

  return old;
end;
$$;

/* ═══════════════════════════════════════════════════════════════
   3 — Selbstpruefung
   ═══════════════════════════════════════════════════════════════

   Eine Migration, die stillschweigend nichts tut, ist schlimmer als
   eine, die abbricht. */
do $$
declare
  v_reject text;
  v_anon   text;
begin
  select pg_get_functiondef(p.oid) into v_reject
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reject_mutation';

  select pg_get_functiondef(p.oid) into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'anonymise_user_on_delete';

  if v_reject is null or position('werkruf.konto_loeschung' in v_reject) = 0 then
    raise exception '[kontoloeschung] reject_mutation kennt die Ausnahme nicht';
  end if;

  if v_reject is null or position('append-only' in v_reject) = 0 then
    raise exception '[kontoloeschung] reject_mutation wirft nicht mehr — Schutz verloren';
  end if;

  if v_anon is null or position('werkruf.konto_loeschung' in v_anon) = 0 then
    raise exception '[kontoloeschung] anonymise_user_on_delete setzt die Markierung nicht';
  end if;

  if v_anon is null or position('ip_address' in v_anon) = 0 then
    raise exception '[kontoloeschung] anonymise_user_on_delete leert ip_address nicht';
  end if;

  raise notice '[kontoloeschung] beide Funktionen in Ordnung';
end $$;

commit;
