# Analyse im Admin (Paket B)

`/admin?bereich=analyse` zeigt drei Quellen nebeneinander, jede mit eigenem Zustand:

| Quelle | Woher | Vollständig? |
|---|---|---|
| **Produkt-Funnel** | eigene Datenbank (`user_profiles`, `google_accounts`) | ja — unabhängig von der Cookie-Einwilligung |
| **Website** | GA4 Data API | nein — nur Besucher mit Einwilligung (Consent Mode Basic) |
| **Google-Suche** | Search Console API | ja (Google-Aggregate, letzte 3 Tage fehlen) |

Zeiträume 7 / 28 / 90 Tage. Website: volle Tage bis gestern, Vergleich mit dem gleich langen Zeitraum davor. Search Console: Fenster endet vor 3 Tagen (Google liefert die jüngsten Tage unvollständig).

**Produkt-Funnel** = Kohorte der Konten, die im Zeitraum angelegt wurden, und wie viele davon heute (a) die Bedingungen akzeptiert, (b) Google verbunden und (c) bezahlten Zugang (`hasPaidAccess`) haben.

**GA4-Funnel** = Ereignisse aus Paket A (`signup_start` … `checkout_success`). `smartcheck_*` fehlt bewusst (kein öffentlicher SmartCheck live).

## Technik

- Aktion `analytics_overview` in `admin-ops` (Admin-Allowlist, nur lesend, Parameter `zeitraum`).
- Google-Zugriff serverseitig per Service Account, Scopes nur `analytics.readonly` und `webmasters.readonly`. Kein Schlüssel im Browser.
- Rechnung und Anfragen: `src/utils/analyseBericht.js` (Jest), Abruf: `supabase/functions/admin-ops/analyse.ts`.
- Jede Quelle für sich: fällt eine aus, kommen die anderen. Fehler nur als Code (z. B. `ga4_403` = Service Account hat keinen Zugriff auf die Property, `gsc_403` = kein Nutzer in der Search Console, `google_token_400` = Schlüsseldatei ungültig).
- 5 Minuten Zwischenspeicher je Zeitraum (nur bei vollständigem Erfolg).

## Einrichtung (einmalig, alles im Browser)

1. **Service Account** (Google Cloud Console → IAM und Verwaltung → Dienstkonten):
   - vorhandenen Service Account von sarahiver wiederverwenden *oder* neu anlegen;
   - Schlüssel → Schlüssel hinzufügen → JSON → Datei herunterladen.
   - Im selben Projekt unter „APIs und Dienste" aktivieren: **Google Analytics Data API** und **Google Search Console API**.
2. **GA4**: Verwaltung → *Property* → **Property-Zugriffsverwaltung** → „+" → E-Mail des Service Accounts (`…@….iam.gserviceaccount.com`) → Rolle **Betrachter**.
   Property-ID ablesen: Verwaltung → *Property* → **Property-Details** (eine Zahl, **nicht** die Mess-ID `G-…`).
3. **Search Console**: Property werkruf.com → Einstellungen → **Nutzer und Berechtigungen** → Nutzer hinzufügen → E-Mail des Service Accounts → **Eingeschränkt**.
4. **Supabase → Edge Functions → Secrets**:
   - `GA4_PROPERTY_ID` = die Zahl aus Schritt 2
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = kompletter Inhalt der JSON-Datei
   - `GSC_SITE_URL` = `sc-domain:werkruf.com` (Domain-Property) bzw. `https://werkruf.com/` (URL-Präfix-Property) — so, wie die Property in der Search Console heißt
5. Actions → Deploy (admin-ops).

Fehlt etwas, zeigt der Bereich „Noch nicht eingerichtet" mit den **Namen** der fehlenden Secrets — nie Werte.
