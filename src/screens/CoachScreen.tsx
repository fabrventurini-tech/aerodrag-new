import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TextInput, TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../store';
import { Colors, Sp, Radius } from '../theme';

const KEY_COACH_URL = 'aerodrag:coach_url';

export function CoachScreen() {
  const [url, setUrl]       = useState('');
  const [saved, setSaved]   = useState('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const wsRef         = useRef<WebSocket | null>(null);
  const reconnectRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  const { physics, sensor, history, isRecording, activeAthleteId } = useStore();

  // Ricarica URL salvato
  useEffect(() => {
    AsyncStorage.getItem(KEY_COACH_URL).then((u) => {
      if (u) { setUrl(u); setSaved(u); connect(u); }
    });
    return () => disconnect();
  }, []);

  function disconnect() {
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    if (sendRef.current)      { clearInterval(sendRef.current);    sendRef.current = null; }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function connect(targetUrl: string) {
    disconnect();
    if (!targetUrl.startsWith('ws://') && !targetUrl.startsWith('wss://')) {
      setStatus('error');
      setErrorMsg('URL deve iniziare con ws:// o wss://');
      return;
    }
    setStatus('connecting');
    setErrorMsg('');
    try {
      const ws = new WebSocket(targetUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        // Invia snapshot a 2 Hz
        sendRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const { physics: p, sensor: s, isRecording: rec, activeAthleteId: aid } = useStore.getState();
          ws.send(JSON.stringify({
            t: Date.now(),
            athleteId: aid,
            recording: rec,
            physics: p,
            sensor: s,
          }));
        }, 500);
      };

      ws.onerror = () => {
        setStatus('error');
        setErrorMsg('Errore di connessione');
      };

      ws.onclose = () => {
        if (sendRef.current) { clearInterval(sendRef.current); sendRef.current = null; }
        setStatus('error');
        // Riconnessione automatica dopo 5s
        reconnectRef.current = setTimeout(() => connect(targetUrl), 5000);
      };
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(String(e?.message ?? e));
    }
  }

  async function handleSave() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSaved(trimmed);
    await AsyncStorage.setItem(KEY_COACH_URL, trimmed);
    connect(trimmed);
  }

  function handleDisconnect() {
    disconnect();
    setStatus('idle');
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
          placeholder="ws://192.168.1.x:3000"
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
        Il coach dashboard riceve i dati a 2 Hz via WebSocket.
        {isRecording && '  •  Sessione in registrazione'}
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
