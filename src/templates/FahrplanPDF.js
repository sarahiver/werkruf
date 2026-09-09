import React from 'react';
import {
  Document, Page, Text, View, StyleSheet,
  PDFDownloadLink, pdf,
} from '@react-pdf/renderer';

/* ─────────────────────────────────────────────
   SCHRIFT

   Hier stand eine Font.register()-Registrierung von Barlow mit
   .woff2-Dateien von fonts.gstatic.com. Genau daran scheiterte der
   Download: @react-pdf/renderer 3.x unterstützt ausschliesslich TTF
   und WOFF — WOFF2 nicht. Der Renderer brach mit "Unknown font
   format" ab, und es entstand nie eine Datei.

   Statt auf TTF-URLs auszuweichen bleibt es jetzt bei Helvetica, das
   im PDF-Standard eingebaut ist. Das nimmt gleich zwei Fehlerquellen
   heraus: keine Abhängigkeit von einem fremden CDN zur Laufzeit, und
   keine Wartezeit beim Nachladen. Für ein zweiseitiges Dokument ist
   der optische Unterschied gering; wer Barlow zwingend will, legt
   eine .ttf unter public/fonts ab und registriert die von dort.
───────────────────────────────────────────── */

/* ─────────────────────────────────────────────
   PDF DOCUMENT
───────────────────────────────────────────── */
function FahrplanDocument({ industry, profile }) {
  const { brand, colors, comms } = industry;
  const companyName = profile?.company_name || 'Dein Betrieb';
  const score       = profile?.visibility_score ?? 0;

  const styles = StyleSheet.create({
    page: {
      fontFamily: 'Helvetica',
      backgroundColor: '#F2F2F2',
      padding: 0,
    },

    /* Cover */
    cover: {
      backgroundColor: colors.primary,
      padding: '50 40',
      minHeight: 220,
    },
    coverAccentBar: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      height: 6,
      backgroundColor: colors.accent,
    },
    coverLogo: {
      fontSize: 26,
      fontWeight: 900,
      color: '#ffffff',
      letterSpacing: 3,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    coverTagline: {
      fontSize: 10,
      color: 'rgba(255,255,255,0.5)',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: 40,
    },
    coverTitle: {
      fontSize: 13,
      fontWeight: 700,
      color: colors.accent,
      letterSpacing: 2,
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    coverCompany: {
      fontSize: 28,
      fontWeight: 900,
      color: '#ffffff',
      textTransform: 'uppercase',
      lineHeight: 1.15,
      marginBottom: 8,
    },
    coverDate: {
      fontSize: 10,
      color: 'rgba(255,255,255,0.4)',
    },

    /* Score chip */
    scoreChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 20,
      backgroundColor: 'rgba(255,255,255,0.08)',
      padding: '10 14',
      borderRadius: 0,
    },
    scoreNum: {
      fontSize: 32,
      fontWeight: 900,
      color: score >= 70 ? '#4CAF50' : score >= 45 ? colors.accent : '#ff6b6b',
    },
    scoreText: {
      fontSize: 10,
      color: 'rgba(255,255,255,0.6)',
    },

    /* Body */
    body: {
      padding: '28 40',
    },

    sectionTitle: {
      fontSize: 10,
      fontWeight: 700,
      color: colors.accent,
      letterSpacing: 2,
      textTransform: 'uppercase',
      marginBottom: 14,
      marginTop: 20,
    },

    /* Phase cards */

    /* Checklist */
    checklistItem: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
      backgroundColor: '#ffffff',
      padding: '10 14',
    },
    checkMark: {
      fontSize: 11,
      color: colors.accent,
      fontWeight: 700,
      minWidth: 16,
    },
    checkText: {
      fontSize: 10,
      color: '#1A1A1A',
      lineHeight: 1.5,
      flex: 1,
    },

    /* Ownership box */
    ownershipBox: {
      backgroundColor: colors.primary,
      padding: '14 18',
      marginTop: 16,
      borderLeftWidth: 4,
      borderLeftColor: colors.accent,
      borderLeftStyle: 'solid',
    },
    ownershipTitle: {
      fontSize: 9,
      fontWeight: 700,
      color: colors.accent,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 5,
    },
    ownershipText: {
      fontSize: 9,
      color: 'rgba(255,255,255,0.75)',
      lineHeight: 1.6,
    },

    /* Footer */
    /* Neu: Statuszeilen für Verbindung / Automatisierung */
    statusRow: {
      flexDirection: 'row', alignItems: 'center',
      marginBottom: 6, paddingBottom: 6,
      borderBottomWidth: 0.5, borderBottomColor: '#E3E6EA',
    },
    statusDot: {
      width: 7, height: 7, borderRadius: 4, marginRight: 8, marginTop: 3,
    },
    statusLabel: {
      fontSize: 9.5, color: '#1A1A1A', flex: 1,
    },
    statusValue: {
      fontSize: 9.5, fontWeight: 700, color: colors.primary,
    },
    metricRow: {
      flexDirection: 'row', marginBottom: 12,
    },
    metricBox: {
      flex: 1, paddingVertical: 10, paddingHorizontal: 12,
      backgroundColor: '#F6F7F9', borderRadius: 4, marginRight: 8,
    },
    metricNum: {
      fontSize: 17, fontWeight: 700, color: colors.primary,
    },
    metricLabel: {
      fontSize: 7.5, color: '#6B7280', textTransform: 'uppercase',
      letterSpacing: 0.5, marginTop: 2,
    },
    hint: {
      fontSize: 8.5, color: '#6B7280', lineHeight: 1.5, marginTop: 4, marginBottom: 10,
    },
    footer: {
      position: 'absolute',
      bottom: 20,
      left: 40,
      right: 40,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: '#D0D8E0',
      borderTopStyle: 'solid',
      paddingTop: 8,
    },
    footerText: {
      fontSize: 8,
      color: '#A0ADB8',
    },
  });

  const today = new Date().toLocaleDateString('de-DE', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  /* ── Ableitungen aus den vorhandenen Profildaten ──
     Bewusst nichts erfunden: alles hier steht so im Profil. */
  const isConnected = !!profile?.google_place_id;
  const rating      = profile?.google_rating;
  const reviewCount = profile?.google_review_count ?? 0;

  const verdict =
    score >= 70 ? { label: 'Gut',         color: '#1E7E34' } :
    score >= 45 ? { label: 'Ausbaufähig', color: '#A66A00' } :
                  { label: 'Kritisch',    color: '#B3261E' };

  /* Was WERKRUF am Profil erkannt hat. Jede Zeile hat eine Bedingung —
     ein Befund, der immer gleich aussieht, ist keiner. */
  const findings = [
    !isConnected && 'Profil noch nicht mit ' + brand.name + ' verbunden',
    reviewCount === 0 && 'Noch keine Bewertungen vorhanden',
    reviewCount > 0 && rating && rating < 4.0 &&
      `Durchschnitt bei ${rating.toFixed(1)} von 5 — jede beantwortete Bewertung hilft`,
    score < 70 && 'Profilangaben unvollständig: Öffnungszeiten, Leistungen oder Fotos fehlen',
    score < 45 && 'Profil wird bei Suchanfragen kaum ausgespielt',
  ].filter(Boolean);

  /* Was nach dem Verbinden ohne Zutun läuft. */
  const automation = [
    ['Profil-Abgleich mit Google',       isConnected ? 'Aktiv' : 'Nach dem Verbinden'],
    ['Neue Bewertungen erkennen',        isConnected ? 'Aktiv' : 'Nach dem Verbinden'],
    ['KI-Antwortvorschlag je Bewertung', isConnected ? 'Aktiv' : 'Nach dem Verbinden'],
    ['Meldung bei Problemen',            isConnected ? 'Aktiv' : 'Nach dem Verbinden'],
  ];

  return (
    <Document title={`Profil-Befund_${companyName}`}>
      <Page size="A4" style={styles.page}>

        {/* COVER */}
        <View style={styles.cover}>
          <View style={styles.coverAccentBar} />
          <Text style={styles.coverLogo}>{brand.logo}</Text>
          <Text style={styles.coverTagline}>{brand.tagline}</Text>

          <Text style={styles.coverTitle}>{comms.fahrplanTitle}</Text>
          <Text style={styles.coverCompany}>{companyName}</Text>
          <Text style={styles.coverDate}>Erstellt am {today}</Text>

          {score !== null && (
            <View style={styles.scoreChip}>
              <Text style={styles.scoreNum}>{score}</Text>
              <View>
                <Text style={[styles.scoreText, { color: '#ffffff', fontWeight: 700, fontSize: 11 }]}>
                  / 100
                </Text>
                <Text style={styles.scoreText}>Aktueller Sichtbarkeits-Score</Text>
              </View>
            </View>
          )}
        </View>

        {/* BODY */}
        <View style={styles.body}>

          {/* ── 1. VERBINDUNG ──
              Der Report beginnt mit dem Zustand, nicht mit einem Plan.
              Vorher stand hier ein Dienstleistungsablauf. */}
          <Text style={styles.sectionTitle}>1 · Verbindung</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, {
              backgroundColor: isConnected ? '#1E7E34' : '#D48A00',
            }]} />
            <Text style={styles.statusLabel}>Google-Unternehmensprofil</Text>
            <Text style={styles.statusValue}>
              {isConnected ? 'Verbunden' : 'Noch nicht verbunden'}
            </Text>
          </View>
          <Text style={styles.hint}>
            {isConnected
              ? `${brand.name} arbeitet in deinem Google-Konto. Eine einzige Berechtigung — Unternehmensprofil verwalten — jederzeit widerrufbar.`
              : `Einmal verbinden, dann läuft alles Weitere automatisch. Zwei Minuten, eine Berechtigung, jederzeit widerrufbar.`}
          </Text>

          {/* ── 2. PROFIL-GESUNDHEIT ── */}
          <Text style={styles.sectionTitle}>2 · Profil-Gesundheit</Text>
          <View style={styles.metricRow}>
            <View style={styles.metricBox}>
              <Text style={[styles.metricNum, { color: verdict.color }]}>{score}</Text>
              <Text style={styles.metricLabel}>von 100 · {verdict.label}</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricNum}>{rating ? rating.toFixed(1) : '—'}</Text>
              <Text style={styles.metricLabel}>Bewertung</Text>
            </View>
            <View style={[styles.metricBox, { marginRight: 0 }]}>
              <Text style={styles.metricNum}>{reviewCount}</Text>
              <Text style={styles.metricLabel}>Bewertungen</Text>
            </View>
          </View>
          <Text style={styles.hint}>
            Der Wert setzt sich aus Bewertungen, Aktualität und Vollständigkeit
            zusammen — den Punkten, nach denen Google entscheidet, wer bei einer
            Suche oben steht.
          </Text>

          {/* ── 3. WAS AUFGEFALLEN IST ── */}
          <Text style={styles.sectionTitle}>3 · Was aufgefallen ist</Text>
          {findings.length > 0 ? findings.map((item, i) => (
            <View key={i} style={styles.checklistItem}>
              <Text style={[styles.checkMark, { color: '#D48A00' }]}>!</Text>
              <Text style={styles.checkText}>{item}</Text>
            </View>
          )) : (
            <Text style={styles.hint}>
              Keine Auffälligkeiten. Dein Profil ist vollständig und aktuell.
            </Text>
          )}

          {/* ── 4. WAS DEIN PROFIL NOCH BRAUCHT ──
              Aus "Was wir von dir brauchen" wurde eine Bestandsaufnahme.
              Der Betrieb ist nicht mehr Zulieferer, sondern Entscheider. */}
          <Text style={[styles.sectionTitle, { marginTop: 14 }]}>
            4 · {comms.checklistTitle || 'Was dein Profil noch braucht'}
          </Text>
          {comms.checklist.map((item, i) => (
            <View key={i} style={styles.checklistItem}>
              <Text style={styles.checkMark}>-</Text>
              <Text style={styles.checkText}>{item}</Text>
            </View>
          ))}
          {comms.checklistNote && (
            <Text style={styles.hint}>{comms.checklistNote}</Text>
          )}

          {/* ── 5. WAS AUTOMATISCH LÄUFT ── */}
          <Text style={[styles.sectionTitle, { marginTop: 14 }]}>
            5 · Was automatisch läuft
          </Text>
          {automation.map(([label, state], i) => (
            <View key={i} style={styles.statusRow}>
              <View style={[styles.statusDot, {
                backgroundColor: state === 'Aktiv' ? '#1E7E34' : '#C7CBD1',
              }]} />
              <Text style={styles.statusLabel}>{label}</Text>
              <Text style={styles.statusValue}>{state}</Text>
            </View>
          ))}
          <Text style={styles.hint}>
            Veröffentlicht wird nichts ohne deine Freigabe. {brand.name} schlägt
            vor, du entscheidest.
          </Text>

          {/* ── 6. EIGENTUM ── */}
          <View style={styles.ownershipBox}>
            <Text style={styles.ownershipTitle}>Dein Profil bleibt deins</Text>
            <Text style={styles.ownershipText}>
              {brand.name} arbeitet in deinem Google-Konto, nicht in einem fremden.
              Du erteilst genau eine Berechtigung — dein Unternehmensprofil
              verwalten — und kannst sie jederzeit widerrufen. Kündigst du, bleibt
              alles bestehen: Profil, Bewertungen, Fotos.
            </Text>
          </View>
        </View>

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{brand.name} — {comms.expertTitle}</Text>
          <Text style={styles.footerText}>© {new Date().getFullYear()} {brand.name}</Text>
        </View>

      </Page>
    </Document>
  );
}

/* ─────────────────────────────────────────────
   DOWNLOAD BUTTON COMPONENT
   Use inside Dashboard — generates PDF on-the-fly
───────────────────────────────────────────── */
export function FahrplanDownloadButton({ industry, profile, style }) {
  const companyName = profile?.company_name || 'Betrieb';
  const fileName    = `Profil-Befund_${companyName.replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, '_')}.pdf`;

  return (
    <PDFDownloadLink
      document={<FahrplanDocument industry={industry} profile={profile} />}
      fileName={fileName}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 20px',
        background: 'var(--color-primary)',
        color: 'white',
        fontFamily: 'var(--font-display)',
        fontWeight: 'var(--heading-weight)',
        fontSize: '.88rem',
        letterSpacing: '.06em',
        textTransform: 'var(--text-transform)',
        textDecoration: 'none',
        borderRadius: 'var(--radius-button)',
        cursor: 'pointer',
        transition: 'filter .2s',
        ...style,
      }}
    >
      {({ loading }) => loading ? 'PDF wird erstellt…' : 'Befund als PDF laden'}
    </PDFDownloadLink>
  );
}

export default FahrplanDocument;
