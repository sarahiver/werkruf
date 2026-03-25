# WERKRUF — Setup Guide

## 1. Frisches CRA anlegen

```bash
npx create-react-app werkruf
cd werkruf
```

## 2. Abhängigkeiten installieren

```bash
npm install styled-components @supabase/supabase-js lucide-react
```

## 3. Dateien kopieren

Kopiere alle Dateien aus diesem ZIP in die entsprechenden Ordner deines CRA-Projekts:

```
src/
  App.js                          ← ersetzen
  supabaseClient.js               ← neu
  components/
    GlobalStyle.js                ← neu
    Header.js                     ← neu
    Hero.js                       ← neu
    Features.js                   ← neu
    LeadForm.js                   ← neu
    Footer.js                     ← neu
.env.example                      ← als .env kopieren & ausfüllen
```

## 4. Supabase einrichten

1. Geh zu [supabase.com](https://supabase.com) → dein Projekt
2. Öffne den **SQL Editor**
3. Führe das SQL aus dem Kommentar in `src/supabaseClient.js` aus
4. Kopiere `.env.example` → `.env` und trage deine Project URL + Anon Key ein

## 5. Starten

```bash
npm start
```

## Design-System

| Token        | Wert      |
|-------------|-----------|
| Navy Blue    | `#002C51` |
| Safety Orange | `#FF8C00` |
| Background   | `#F2F2F2` |
| Font Display | Barlow Condensed (800/900) |
| Font Body    | Barlow (400/600/700) |

## Supabase Tabellen

- **`leads`** — Eingehende Formular-Anfragen (id, created_at, company_name, contact_person, phone, trade, city, status)
- **`user_profiles`** — Registrierte User-Profile (verknüpft mit auth.users)
