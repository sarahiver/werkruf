import React from 'react';
import {
  Document, Page, Text, View, StyleSheet,
  Font, PDFDownloadLink, pdf,
} from '@react-pdf/renderer';

/* ─────────────────────────────────────────────
   FONTS
───────────────────────────────────────────── */
Font.register({
  family: 'Barlow',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/barlow/v12/7cHpv4kjgoGqM7E3_-gc4FAtlT47dw.woff2', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/barlow/v12/7cHqv4kjgoGqM7E3b8s8yn4hn4YuFQ.woff2', fontWeight: 700 },
    { src: 'https://fonts.gstatic.com/s/barlow/v12/7cHqv4kjgoGqM7E3b8s8yn4hn4YuFQ.woff2', fontWeight: 900 },
  ],
});

/* ─────────────────────────────────────────────
   PDF DOCUMENT
───────────────────────────────────────────── */
function FahrplanDocument({ industry, profile }) {
  const { brand, colors, comms } = industry;
  const companyName = profile?.company_name || 'Dein Betrieb';
  const score       = profile?.visibility_score ?? 0;

  const styles = StyleSheet.create({
    page: {
      fontFamily: 'Barlow',
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
    phaseRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 10,
    },
    phaseCard: {
      flex: 1,
      backgroundColor: '#ffffff',
      padding: '14 14',
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      borderLeftStyle: 'solid',
    },
    phaseNum: {
      fontSize: 18,
      fontWeight: 900,
      color: colors.accent,
      marginBottom: 4,
    },
    phaseTitle: {
      fontSize: 10,
      fontWeight: 700,
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 6,
    },
    phaseText: {
      fontSize: 9,
      color: '#5A6A7A',
      lineHeight: 1.6,
    },

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

  return (
    <Document title={`Fahrplan_${companyName}`}>
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

          {/* Phases */}
          <Text style={styles.sectionTitle}>Dein 3-Phasen-Plan</Text>
          <View style={styles.phaseRow}>
            {comms.phases.map((phase, i) => (
              <View key={i} style={styles.phaseCard}>
                <Text style={styles.phaseNum}>{phase.num}</Text>
                <Text style={styles.phaseTitle}>{phase.title}</Text>
                <Text style={styles.phaseText}>{phase.text}</Text>
              </View>
            ))}
          </View>

          {/* Checklist */}
          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Was wir von dir brauchen</Text>
          {comms.checklist.map((item, i) => (
            <View key={i} style={styles.checklistItem}>
              <Text style={styles.checkMark}>✓</Text>
              <Text style={styles.checkText}>{item}</Text>
            </View>
          ))}

          {/* Ownership */}
          <View style={styles.ownershipBox}>
            <Text style={styles.ownershipTitle}>Dein dauerhafter Wert</Text>
            <Text style={styles.ownershipText}>
              Dein Google Business Profil bleibt nach der Einrichtung dauerhaft dein Eigentum —
              auch wenn du das Abo einmal kündigst. Es ist ein bleibender digitaler Vermögenswert für deinen Betrieb.
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
  const fileName    = `Fahrplan_${companyName.replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, '_')}.pdf`;

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
      {({ loading }) => loading ? 'PDF wird erstellt…' : `📄 Fahrplan herunterladen`}
    </PDFDownloadLink>
  );
}

export default FahrplanDocument;
