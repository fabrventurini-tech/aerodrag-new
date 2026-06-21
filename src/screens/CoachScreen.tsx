import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TextInput, TouchableOpacity,
} from 'react-native';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { coachConnect, coachDisconnect, loadCoachUrl, saveCoachUrl } from '../coach/link';
import { Colors, Sp, Radius, monoNum } from '../theme';

// La connessione WebSocket vive in src/coach/link.ts a livello modulo:
// sopravvive al cambio di tab. Questa schermata è solo UI.
export function CoachScreen() {
  const [url, setUrl]     = useState('');
  const [saved, setSaved] = useState('');

  const {
    physics, sensor, history, isRecording,
    activeAthleteId, athleteProfiles,
    batteryPct, currentLap,
    coachStatus: status, coachErrorMsg: errorMsg,
  } = useStore(useShallow((s) => ({
    physics: s.physics, sensor: s.sensor, history: s.history, isRecording: s.isRecording,
    activeAthleteId: s.activeAthleteId, athleteProfiles: s.athleteProfiles,
    batteryPct: s.batteryPct, currentLap: s.currentLap,
    coachStatus: s.coachStatus, coachErrorMsg: s.coachErrorMsg,
  })));

  // Mostra l'URL salvato (la connessione parte già da App via coachAutoConnect)
  useEffect(() => {
    loadCoachUrl().then((u) => {
      if (u) { setUrl(u); setSaved(u); }
    });
  }, []);

  async function handleSave() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSaved(trimmed);
    await saveCoachUrl(trimmed);
    coachConnect(trimmed);
  }

  function handleDisconnect() {
    coachDisconnect();
  }

  const lastCda = history.length > 0
    ? history.slice(-10).map((p) => p.physics.cda).filter((v) => v > 0)
    : [];
  const avgCda = lastCda.length > 0
    ? lastCda.reduce((a, b) => a + b, 0) / lastCda.length
    : 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.sectionTitle}>Dashboard Coach</Text>

      {/* ── URL WebSocket ── */}
      <View style={styles.card}>
        <Text style={styles.label}>URL server coach</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="ws://192.168.8.1:8080/coach"
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btn} onPress={handleSave}>
            <Text style={styles.btnText}>Salva e connetti</Text>
          </TouchableOpacity>
          {status !== 'idle' && (
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: Colors.redBg, borderColor: Colors.red }]}
              onPress={handleDisconnect}
            >
              <Text style={[styles.btnText, { color: Colors.red }]}>Disconnetti</Text>
            </TouchableOpacity>
          )}
        </View>
        {saved !== '' && (
          <Text style={styles.savedUrl}>{saved}</Text>
        )}
      </View>

      {/* ── Stato connessione ── */}
      <View style={styles.card}>
        <Text style={styles.label}>Stato</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, {
            backgroundColor:
              status === 'connected'  ? Colors.teal  :
              status === 'connecting' ? Colors.amber :
              status === 'error'      ? Colors.red   : Colors.muted,
          }]} />
          <Text style={styles.statusText}>
            {status === 'connected'  ? 'Connesso' :
             status === 'connecting' ? 'Connessione in corso…' :
             status === 'error'      ? `Errore${errorMsg ? ' — ' + errorMsg : ''}` :
             'Non connesso'}
          </Text>
        </View>
        {status === 'connected' && (
          <View style={styles.infoRow}>
            <Text style={styles.infoText}>
              {athleteProfiles.find((p) => p.id === activeAthleteId)?.name ?? 'Atleta'}
              {'  •  Lap '}{currentLap}
              {isRecording ? '  •  REC' : ''}
            </Text>
          </View>
        )}
      </View>

      {/* ── Dati live riassuntivi ── */}
      <Text style={styles.sectionTitle}>Dati live</Text>
      <View style={styles.dataGrid}>
        <DataBox label="CdA live"    value={physics.valid ? physics.cda.toFixed(3) : '–'} color={Colors.teal}  />
        <DataBox label="CdA avg 10s" value={avgCda > 0 ? avgCda.toFixed(3) : '–'}         color={Colors.teal}  />
        <DataBox label="Potenza"     value={sensor.powerW > 0 ? `${sensor.powerW.toFixed(0)} W` : '–'} color={Colors.amber} />
        <DataBox label="HR"          value={sensor.hrBpm > 0 ? `${sensor.hrBpm} bpm` : '–'}            color={Colors.red}   />
        <DataBox label="Velocità"    value={sensor.speedMs > 0 ? `${(sensor.speedMs * 3.6).toFixed(1)} km/h` : '–'} color={Colors.blue} />
        <DataBox label="Vento"       value={physics.vAirMs > sensor.speedMs ? `${(physics.vAirMs - sensor.speedMs).toFixed(1)} m/s` : '0.0 m/s'} color={Colors.muted} />
      </View>

      <Text style={styles.note}>
        Dati inviati a 2 Hz via WebSocket. La connessione resta attiva anche
        cambiando schermata.
        {isRecording ? '  •  Sessione in registrazione' : ''}
        {'\n'}Batteria: {batteryPct > 0 ? `${batteryPct}%` : '—'}
      </Text>
    </ScrollView>
  );
}

function DataBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.dataBox}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={[styles.dataValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Sp.md, gap: Sp.sm, paddingBottom: Sp.xl },

  sectionTitle: {
    fontSize:      12,
    color:         Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop:     Sp.sm,
  },

  card: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },
  label: { fontSize: 12, color: Colors.muted },
  input: {
    backgroundColor: Colors.s2,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    color:           Colors.text,
    fontSize:        14,
    padding:         Sp.sm,
  },
  btnRow: { flexDirection: 'row', gap: Sp.sm },
  btn: {
    flex:            1,
    backgroundColor: Colors.tealBg,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.teal,
    padding:         Sp.sm,
    alignItems:      'center',
  },
  btnText:  { color: Colors.teal, fontWeight: '600' },
  savedUrl: { fontSize: 11, color: Colors.muted, fontStyle: 'italic' },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  statusText:{ fontSize: 14, color: Colors.text, flex: 1 },

  infoRow:  { paddingTop: 2 },
  infoText: { ...monoNum, fontSize: 11, color: Colors.muted },

  dataGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           Sp.sm,
  },
  dataBox: {
    width:           '31%',
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.sm,
    gap:             2,
  },
  dataLabel: { fontSize: 10, color: Colors.muted },
  dataValue: { ...monoNum, fontSize: 16 },

  note: {
    fontSize:   11,
    color:      Colors.muted,
    fontStyle:  'italic',
    lineHeight: 17,
    marginTop:  Sp.sm,
  },
});
