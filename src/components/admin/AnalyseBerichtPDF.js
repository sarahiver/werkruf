/*
 * Analyse-Bericht als PDF (Admin · Analyse · „Bericht herunterladen").
 *
 * Wird erst beim Klick geladen (dynamic import), damit @react-pdf nicht
 * im Admin-Bundle landet. Inhalt und Formulierung kommen vollstaendig
 * aus berichtInhalt() (src/utils/analyseBericht.js) — hier wird nur
 * gesetzt.
 *
 * Schrift: Helvetica (im PDF-Standard eingebaut, kein Nachladen; siehe
 * FahrplanPDF.js, warum keine WOFF2-Schrift). Helvetica kennt nur den
 * Westeuropa-Zeichensatz — deshalb keine Pfeile im Text.
 */
import React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';

const NAVY = '#002C51';
const ORANGE = '#FF8C00';
const GRAU = '#5B6B7B';
const LINIE = '#D9DEE5';

const s = StyleSheet.create({
  seite: { fontFamily: 'Helvetica', fontSize: 9, color: '#1B2733', paddingTop: 40, paddingBottom: 48, paddingHorizontal: 40 },
  marke: { fontFamily: 'Helvetica-Bold', fontSize: 10, letterSpacing: 2, color: NAVY },
  strich: { width: 60, height: 2, backgroundColor: ORANGE, marginTop: 3, marginBottom: 14 },
  titel: { fontFamily: 'Helvetica-Bold', fontSize: 18, color: NAVY, marginBottom: 4 },
  untertitel: { fontSize: 9, color: GRAU, marginBottom: 18 },
  abschnitt: { marginBottom: 16 },
  h2: { fontFamily: 'Helvetica-Bold', fontSize: 12.5, color: NAVY, marginBottom: 4 },
  hinweis: { fontSize: 8.5, color: GRAU, marginBottom: 8, lineHeight: 1.4 },
  grund: { fontSize: 9, color: '#8A2D1F', marginBottom: 6 },
  h3: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, color: NAVY, marginTop: 8, marginBottom: 3 },
  tabelle: { borderTopWidth: 1, borderTopColor: LINIE },
  zeile: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINIE, paddingVertical: 3 },
  kopf: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: NAVY, paddingVertical: 3 },
  kopfZelle: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: NAVY },
  zelle: { fontSize: 8.5 },
  leer: { fontSize: 8.5, color: GRAU, paddingVertical: 3 },
  fuss: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: GRAU },
});

/* Erste Spalte breit, Zahlenspalten schmal und rechtsbuendig. */
function breite(i, n) {
  if (n === 1) return '100%';
  return i === 0 ? `${Math.max(34, 100 - (n - 1) * 15)}%` : `${Math.min(15, 66 / (n - 1))}%`;
}

function Tabelle({ t }) {
  const n = t.kopf.length;
  const rechts = new Set(t.rechts || []);
  const zelle = (i) => ({ width: breite(i, n), textAlign: rechts.has(i) ? 'right' : 'left', paddingRight: i === n - 1 ? 0 : 6 });
  return (
    <View wrap>
      {t.titel ? <Text style={s.h3} minPresenceAhead={40}>{t.titel}</Text> : null}
      <View style={s.tabelle}>
        <View style={s.kopf} fixed={false}>
          {t.kopf.map((k, i) => <Text key={i} style={[s.kopfZelle, zelle(i)]}>{k}</Text>)}
        </View>
        {t.zeilen.length === 0
          ? <Text style={s.leer}>Keine Daten im Zeitraum.</Text>
          : t.zeilen.map((z, j) => (
            <View key={j} style={s.zeile} wrap={false}>
              {z.map((w, i) => <Text key={i} style={[s.zelle, zelle(i)]}>{String(w ?? '')}</Text>)}
            </View>
          ))}
      </View>
    </View>
  );
}

export function AnalyseBerichtDokument({ inhalt }) {
  return (
    <Document title={inhalt.titel} author="WERKRUF" creator="WERKRUF Admin">
      <Page size="A4" style={s.seite}>
        <Text style={s.marke}>WERKRUF</Text>
        <View style={s.strich} />
        <Text style={s.titel}>{inhalt.titel.replace('WERKRUF · ', '')}</Text>
        <Text style={s.untertitel}>{inhalt.untertitel}</Text>
        {inhalt.abschnitte.map((a, i) => (
          <View key={i} style={s.abschnitt}>
            <Text style={s.h2} minPresenceAhead={60}>{a.titel}</Text>
            {a.hinweis ? <Text style={s.hinweis}>{a.hinweis}</Text> : null}
            {a.grund ? <Text style={s.grund}>{a.grund}</Text> : null}
            {a.tabellen.map((t, j) => <Tabelle key={j} t={t} />)}
          </View>
        ))}
        <View style={s.fuss} fixed>
          <Text>{inhalt.titel}</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** PDF als Blob erzeugen. */
export async function erzeugeAnalyseBericht(inhalt) {
  return pdf(<AnalyseBerichtDokument inhalt={inhalt} />).toBlob();
}
