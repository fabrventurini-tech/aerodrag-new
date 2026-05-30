import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Vibration,
} from 'react-native';
import { useStore } from '../store';
import { MetricCard } from '../components/MetricCard';
import { MiniChart } from '../components/MiniChart';
import { Colors, Sp, Radius } from '../theme';

function fmt(n: number, decimals = 2): string {
  if (!isFinite(n) || n === 0) return '–';
  return n.toFixed(decimals);
}

function fmtTime(s: number): string {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Qualità asfalto/superficie da indice vibrazione (0–255) */
function vibQuality(idx: number): { label: string; color: string } {
  if (idx === 0)   return { label: '–',         color: Colors.muted };
  if (idx < 80)    return { label: 'Liscia',     color: Colors.teal };
  if (idx < 150)   return { label: 'Normale',    color: Colors.blue };
  if (idx < 200)   return { label: 'Irregolare', color: Colors.amber };
  return             { label: 'Dissestata',    color: Colors.red };
}

export function LiveScreen() {
  const {
    physics, sensor, history, isRecording, elapsed,
    currentLap, startSession, stopSession, addLap,
    isSimMode, setSimMode,
    pairedWheelId, pairedHRId, pairedHRType,
    wheelData, hrRMSSD,
  } = useStore();

  const cdaHistory    = history.slice(-60).map(p => p.physics.cda);
  const powerHistory  = history.slice(-60).map(p => p.sensor.powerW);
  const speedKmh      = sensor.speedMs * 3.6;
  const vibInfo       = vibQuality(wheelData.vibrationIndex);

  const handleRec = useCallback(() => {
    if (isRecording) stopSession();
    else startSession();
    Vibration.vibrate(50);
  }, [isRecording, startSession, stopSession]);

  const handleLap = useCallback(() => {
    addLap();
    Vibration.vibrate([0, 30, 50, 30]);
  }, [addLap]);

  const hasWheel  = !!pairedWheelId;
  const hasHRBand = !!pairedHRId;
  const hasIMU    = hasHRBand && pairedHRType === 'aerodrag';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── CdA principale ── */}
      <View style={styles.cdaCard}>
        <Text style={styles.cdaLabel}>CdA</Text>
        <Text style={styles.cdaValue}>
          {physics.valid ? fmt(physics.cda, 3) : '–'}
        </Text>
        <Text style={styles.cdaUnit}>m²</Text>
        {cdaHistory.length > 1 && (
          <MiniChart data={cdaHistory} color={Colors.teal} height={32} />
        )}
      </View>

      {/* ── Metriche riga 1: potenza + velocità ── */}
      <View style={styles.row}>
        <MetricCard
          label="Potenza"
          value={sensor.powerW > 0 ? fmt(sensor.powerW, 0) : '–'}
          unit="W"
          color={Colors.amber}
        />
        <MetricCard
          label="Velocità"
          value={speedKmh > 0 ? fmt(speedKmh, 1) : '–'}
          unit="km/h"
          color={Colors.blue}
        />
      </View>

      {/* ── Metriche riga 2: HR + cadenza ── */}
      <View style={styles.row}>
        <MetricCard
          label="HR"
          value={sensor.hrBpm > 0 ? fmt(sensor.hrBpm, 0) : '–'}
          unit="bpm"
          color={Colors.red}
        />
        <MetricCard
          label="Cadenza"
          value={sensor.cadenceRpm > 0 ? fmt(sensor.cadenceRpm, 0) : '–'}
          unit="rpm"
          color={Colors.teal}
        />
      </View>

      {/* ── HRV se fascia HR attiva ── */}
      {hasHRBand && (
        <View style={styles.row}>
          <MetricCard
            label="RMSSD"
            value={hrRMSSD > 0 ? fmt(hrRMSSD, 0) : '–'}
            unit="ms"
            color={Colors.red}
          />
          {hasIMU && (
            <MetricCard
              label="Resp."
              value={sensor.respBreathMin > 0 ? fmt(sensor.respBreathMin, 0) : '–'}
              unit="b/m"
              color={Colors.muted}
            />
          )}
        </View>
      )}

      {/* ── Biomeccanica tronco (solo fascia AeroDrag) ── */}
      {hasIMU && (
        <View style={styles.bioCard}>
          <Text style={styles.bioTitle}>Biomeccanica tronco</Text>
          <View style={styles.bioRow}>
            <View style={styles.bioItem}>
              <Text style={styles.bioLabel}>Angolo tronco</Text>
              <Text style={[styles.bioValue, { color: Colors.blue }]}>
                {sensor.trunkPitchDeg !== 0 ? `${fmt(sensor.trunkPitchDeg, 1)}°` : '–'}
              </Text>
            </View>
            <View style={styles.bioItem}>
              <Text style={styles.bioLabel}>Oscillazione</Text>
              <Text style={[styles.bioValue, { color: Colors.amber }]}>
                {sensor.lateralOscMm > 0 ? `${fmt(sensor.lateralOscMm, 0)} mm` : '–'}
              </Text>
            </View>
            <View style={styles.bioItem}>
              <Text style={styles.bioLabel}>Temp. cute</Text>
              <Text style={[styles.bioValue, { color: Colors.muted }]}>
                {sensor.skinTempC > 0 ? `${fmt(sensor.skinTempC, 1)}°C` : '–'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Qualità superficie (sensore ruota) ── */}
      {hasWheel && wheelData.vibrationIndex > 0 && (
        <View style={styles.surfaceCard}>
          <Text style={styles.surfaceLabel}>Superficie</Text>
          <Text style={[styles.surfaceValue, { color: vibInfo.color }]}>{vibInfo.label}</Text>
          <Text style={styles.surfaceIdx}>IDX {wheelData.vibrationIndex}</Text>
        </View>
      )}

      {/* ── Metriche aria ── */}
      <View style={styles.row}>
        <MetricCard
          label="v aria"
          value={physics.vAirMs > 0 ? fmt(physics.vAirMs * 3.6, 1) : '–'}
          unit="km/h"
          color={Colors.muted}
        />
        <MetricCard
          label="ρ aria"
          value={physics.rhoKgM3 > 0 ? fmt(physics.rhoKgM3, 3) : '–'}
          unit="kg/m³"
          color={Colors.muted}
        />
      </View>

      {/* ── Breakdown potenza ── */}
      {physics.valid && sensor.powerW > 0 && (
        <View style={styles.breakdown}>
          <Text style={styles.breakdownTitle}>Breakdown potenza</Text>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Aerodinamica</Text>
            <Text style={[styles.breakdownValue, { color: Colors.teal }]}>
              {fmt(physics.pAeroW, 0)} W ({fmt(physics.pctAero, 0)}%)
            </Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Rolling</Text>
            <Text style={styles.breakdownValue}>{fmt(physics.pRollingW, 0)} W</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Gravità</Text>
            <Text style={styles.breakdownValue}>{fmt(physics.pGravityW, 0)} W</Text>
          </View>
        </View>
      )}

      {/* ── Grafico potenza ── */}
      {powerHistory.length > 1 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartLabel}>Potenza (ultimi 60s)</Text>
          <MiniChart data={powerHistory} color={Colors.amber} height={48} />
        </View>
      )}

      {/* ── Lap info ── */}
      {isRecording && (
        <View style={styles.lapInfo}>
          <Text style={styles.lapText}>Lap {currentLap}  •  {fmtTime(elapsed)}</Text>
        </View>
      )}

      {/* ── Pulsanti REC + LAP ── */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.recBtn, {
            borderColor:     isRecording ? Colors.red   : Colors.teal,
            backgroundColor: isRecording ? Colors.redBg : Colors.tealBg,
            flex: 2,
          }]}
          onPress={handleRec}
          activeOpacity={0.75}
        >
          <Text style={[styles.recText, { color: isRecording ? Colors.red : Colors.teal }]}>
            {isRecording ? '⏹ STOP' : '⏺ REC'}
          </Text>
        </TouchableOpacity>

        {isRecording && (
          <TouchableOpacity
            style={[styles.recBtn, {
              borderColor: Colors.amber, backgroundColor: Colors.amberBg, flex: 1,
            }]}
            onPress={handleLap}
            activeOpacity={0.75}
          >
            <Text style={[styles.recText, { color: Colors.amber }]}>LAP</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Toggle simulazione ── */}
      <TouchableOpacity
        style={styles.simBtn}
        onPress={() => setSimMode(!isSimMode)}
      >
        <Text style={styles.simText}>
          {isSimMode ? '🔴 Simulazione attiva (tutti i device)' : '⚫ Modalità simulazione'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Sp.md, gap: Sp.sm, paddingBottom: Sp.xl },

  cdaCard: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.lg,
    borderWidth:     0.5,
    borderColor:     Colors.teal + '40',
    padding:         Sp.lg,
    alignItems:      'center',
    gap:             Sp.xs,
  },
  cdaLabel: { fontSize: 12, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  cdaValue: { fontSize: 64, fontWeight: '800', color: Colors.teal, fontVariant: ['tabular-nums'] },
  cdaUnit:  { fontSize: 16, color: Colors.muted },

  row: { flexDirection: 'row', gap: Sp.sm },

  // ── Biomeccanica tronco ──────────────────────────────────────────────────
  bioCard: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.blue + '40',
    padding:         Sp.md,
    gap:             Sp.sm,
  },
  bioTitle: {
    fontSize: 11, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  bioRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  bioItem: { alignItems: 'center', flex: 1 },
  bioLabel:{ fontSize: 10, color: Colors.muted, marginBottom: 2 },
  bioValue:{ fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // ── Superficie ───────────────────────────────────────────────────────────
  surfaceCard: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
  },
  surfaceLabel: { fontSize: 12, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  surfaceValue: { fontSize: 16, fontWeight: '700' },
  surfaceIdx:   { fontSize: 11, color: Colors.muted },

  breakdown: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.xs,
  },
  breakdownTitle: { fontSize: 11, color: Colors.muted, textTransform: 'uppercase', marginBottom: Sp.xs },
  breakdownRow:   { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { fontSize: 13, color: Colors.text },
  breakdownValue: { fontSize: 13, color: Colors.muted, fontVariant: ['tabular-nums'] },

  chartCard: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },
  chartLabel: { fontSize: 11, color: Colors.muted },

  lapInfo:  { alignItems: 'center', paddingVertical: Sp.xs },
  lapText:  { fontSize: 13, color: Colors.amber, fontVariant: ['tabular-nums'] },

  buttonRow: { flexDirection: 'row', gap: Sp.sm },
  recBtn: {
    borderRadius:    Radius.md,
    borderWidth:     1,
    paddingVertical: Sp.md,
    alignItems:      'center',
  },
  recText: { fontSize: 16, fontWeight: '700', letterSpacing: 1 },

  simBtn: { alignItems: 'center', paddingVertical: Sp.sm },
  simText: { fontSize: 12, color: Colors.muted },
});
