import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TextInput, TouchableOpacity,
} from 'react-native';
import { useStore } from '../store';
import { Colors, Sp, Radius } from '../theme';

export function CoachScreen() {
  const [url, setUrl]       = useState('');
  const [saved, setSaved]   = useState('');
  const [status, setStatus] = useState<'idle' | 'connected' | 'error'>('idle');

  const { history, physics, sensor } = useStore();

  function handleSave() {
    if (!url.trim()) return;
    setSaved(url.trim());
    setStatus('idle');
  }

  const lastCda   = history.length > 0
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
          placeholder="ws://192.168.1.x:3000"
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TouchableOpacity style={styles.btn} onPress={handleSave}>
          <Text style={styles.btnText}>Salva e connetti</Text>
        </TouchableOpacity>
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
              status === 'connected' ? Colors.teal :
              status === 'error'     ? Colors.red  : Colors.muted,
          }]} />
          <Text style={styles.statusText}>
            {status === 'connected' ? 'Connesso' :
             status === 'error'     ? 'Errore connessione' : 'Non connesso'}
          </Text>
        </View>
      </View>

      {/* ── Dati live riassuntivi ── */}
      <Text style={styles.sectionTitle}>Dati live</Text>
      <View style={styles.dataGrid}>
        <DataBox label="CdA live"     value={physics.valid ? physics.cda.toFixed(3) : '–'} color={Colors.teal}  />
        <DataBox label="CdA avg 10s"  value={avgCda > 0 ? avgCda.toFixed(3) : '–'}         color={Colors.teal}  />
        <DataBox label="Potenza"      value={sensor.powerW > 0 ? `${sensor.powerW.toFixed(0)} W` : '–'} color={Colors.amber} />
        <DataBox label="HR"           value={sensor.hrBpm > 0 ? `${sensor.hrBpm} bpm` : '–'}            color={Colors.red}   />
        <DataBox label="Velocità"     value={sensor.speedMs > 0 ? `${(sensor.speedMs * 3.6).toFixed(1)} km/h` : '–'} color={Colors.blue} />
        <DataBox label="v aria"       value={physics.vAirMs > 0 ? `${(physics.vAirMs * 3.6).toFixed(1)} km/h` : '–'} color={Colors.muted} />
      </View>

      <Text style={styles.note}>
        Il coach dashboard riceve i dati in tempo reale via WebSocket dal Raspberry Pi collegato all'ESP32.
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
  btn: {
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
  statusText:{ fontSize: 14, color: Colors.text },

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
  dataValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },

  note: {
    fontSize:   11,
    color:      Colors.muted,
    fontStyle:  'italic',
    lineHeight: 17,
    marginTop:  Sp.sm,
  },
});