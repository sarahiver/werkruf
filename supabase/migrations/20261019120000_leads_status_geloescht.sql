-- 20261019120000_leads_status_geloescht.sql
--
-- Kontolöschung reparieren: leads_status_check kennt 'deleted' nicht
--
-- ═══════════════════════════════════════════════════════════════
-- DER FEHLER
-- ═══════════════════════════════════════════════════════════════
--
-- Am 19.10.2026 schlug im Supabase-Dashboard das Löschen des Nutzers
-- ivergentz@gmail.com fehl:
--
--     Failed to delete selected users: Database error deleting user
--
-- Ursache, lokal gegen PostgreSQL 16 reproduziert:
--
--   1. auth.users trägt den Trigger on_user_deleted,
--      BEFORE DELETE, Funktion anonymise_user_on_delete().
--
--   2. Die Funktion führt aus:
--        update leads set email = 'deleted@werkruf.com',
--                         contact_person = 'Gelöschter Nutzer',
--                         phone = '-',
--                         status = 'deleted'
--         where email = OLD.email;
--
--   3. leads_status_check erlaubt aber nur:
--        'new', 'contacted', 'converted', 'rejected'
--
--   4. 'deleted' verletzt die Bedingung, der Trigger wirft, und weil
--      er BEFORE DELETE läuft, bricht das gesamte DELETE ab.
--
-- Fehlermeldung im Reproduktionslauf:
--
--   ERROR: new row for relation "leads" violates check constraint
--          "leads_status_check"
--   CONTEXT: SQL statement "UPDATE leads SET ... status='deleted' ..."
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DAS MEHR IST ALS EIN TESTHINDERNIS
-- ═══════════════════════════════════════════════════════════════
--
-- Betroffen ist jeder Nutzer, zu dessen E-Mail-Adresse ein Lead
-- existiert — also jeder, der über den SmartCheck-Funnel kam. Das
-- ist der reguläre Akquiseweg.
--
-- Für diese Nutzer gilt heute:
--
--   • Der Knopf "Konto löschen" schlägt fehl.
--   • DSGVO Art. 17 ist nicht erfüllbar.
--   • AVV § 12 verspricht Löschung, die technisch nicht geht.
--
-- Verschärfend: supabase/functions/delete-account/index.ts kündigt
-- in Schritt 2 das Stripe-Abo (Z 63-76) und zerstört in Schritt 3 die
-- Cloudinary-Fotos (Z 80-116), BEVOR es in Schritt 4 den Nutzer
-- löscht (Z 119). Der Kunde verliert also Abo und Fotos, und danach
-- scheitert die Löschung. Zurück bleibt ein Konto ohne Abo, ohne
-- Fotos — und es existiert weiter.
--
-- Unentdeckt blieb es, weil die Gegenprobe zeigt: Ein Nutzer OHNE
-- Lead lässt sich anstandslos löschen. Wer die Löschung je an einem
-- frischen Konto geprüft hat, sah nichts.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIESE REPARATUR UND NICHT DIE ANDERE
-- ═══════════════════════════════════════════════════════════════
--
-- Zwei Wege führen aus dem Fehler:
--
--   A  Die Bedingung lernt 'deleted'.            ← dieser hier
--   B  Der Trigger schreibt einen erlaubten Wert.
--
-- B wäre falsch. Der einzige semantisch naheliegende erlaubte Wert
-- wäre 'rejected' — und der bedeutet "Lead hat abgelehnt". Ein
-- gelöschtes Konto ist kein abgelehnter Lead. B würde die
-- Funnel-Statistik verfälschen, dauerhaft und unbemerkt.
--
-- A ist das, was der Trigger ohnehin schon meint. Die Bedingung ist
-- der Teil, der nie davon erfahren hat.
--
-- Geprüft, dass A nichts bricht: leads.status wird an genau zwei
-- Stellen ausgewertet, beide in src/pages/Admin.js (Z 341, Z 784),
-- beide als `l.status === 'new'`. Geschrieben wird er in
-- supabase/functions/smartcheck-lead/index.ts (Z 273) als 'new'.
-- Nirgends gibt es eine erschöpfende Fallunterscheidung über alle
-- Werte, die ein zusätzlicher Wert zerlegen würde.
--
-- ═══════════════════════════════════════════════════════════════
-- WIRKUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Verändert ausschließlich eine CHECK-Bedingung. Keine Zeile wird
-- angefasst, keine Daten gelöscht, kein Verhalten sonst geändert.
-- Bestehende Zeilen bleiben gültig: Die erlaubte Menge wird größer,
-- nicht kleiner.

begin;

alter table public.leads
  drop constraint if exists leads_status_check;

alter table public.leads
  add constraint leads_status_check
  check (status = any (array['new', 'contacted', 'converted', 'rejected', 'deleted']));

/* ── Selbstprüfung ───────────────────────────────────────────────
   Eine Migration, die stillschweigend nichts tut, ist schlimmer als
   eine, die abbricht. Deshalb hier die Gegenprobe: Kennt die
   Bedingung den neuen Wert wirklich? */
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.leads'::regclass
     and c.conname  = 'leads_status_check';

  if v_def is null then
    raise exception '[leads_status] Bedingung fehlt nach der Migration';
  end if;

  if position('deleted' in v_def) = 0 then
    raise exception '[leads_status] Bedingung kennt deleted nicht: %', v_def;
  end if;

  raise notice '[leads_status] in Ordnung — %', v_def;
end $$;

commit;
