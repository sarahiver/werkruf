import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase-Konfiguration fehlt. Bitte REACT_APP_SUPABASE_URL und REACT_APP_SUPABASE_ANON_KEY in deiner .env setzen.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;

/* ─────────────────────────────────────────────────────────────
 * SUPABASE SQL — Einmalig im SQL Editor ausführen
 * ─────────────────────────────────────────────────────────────
 *
 * -- LEADS TABLE
 * CREATE TABLE leads (
 *   id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   company_name   TEXT NOT NULL,
 *   contact_person TEXT NOT NULL,
 *   phone          TEXT NOT NULL,
 *   trade          TEXT,
 *   city           TEXT,
 *   status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','rejected'))
 * );
 *
 * -- Row Level Security aktivieren
 * ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
 *
 * -- Nur authenticated Users (Admins) dürfen lesen
 * CREATE POLICY "Admins can read leads" ON leads
 *   FOR SELECT USING (auth.role() = 'authenticated');
 *
 * -- Jeder darf einen Lead eintragen (öffentliches Formular)
 * CREATE POLICY "Anyone can insert leads" ON leads
 *   FOR INSERT WITH CHECK (true);
 *
 *
 * -- USER PROFILES TABLE
 * CREATE TABLE user_profiles (
 *   id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 *   created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   full_name      TEXT,
 *   company_name   TEXT,
 *   phone          TEXT,
 *   trade          TEXT,
 *   city           TEXT,
 *   plan           TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','starter','pro')),
 *   avatar_url     TEXT
 * );
 *
 * ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "Users can view own profile" ON user_profiles
 *   FOR SELECT USING (auth.uid() = id);
 *
 * CREATE POLICY "Users can update own profile" ON user_profiles
 *   FOR UPDATE USING (auth.uid() = id);
 *
 * -- Automatisch Profil anlegen wenn User sich registriert
 * CREATE OR REPLACE FUNCTION handle_new_user()
 * RETURNS TRIGGER AS $$
 * BEGIN
 *   INSERT INTO user_profiles (id, full_name)
 *   VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
 *   RETURN NEW;
 * END;
 * $$ LANGUAGE plpgsql SECURITY DEFINER;
 *
 * CREATE TRIGGER on_auth_user_created
 *   AFTER INSERT ON auth.users
 *   FOR EACH ROW EXECUTE PROCEDURE handle_new_user();
 *
 * ───────────────────────────────────────────────────────────── */
