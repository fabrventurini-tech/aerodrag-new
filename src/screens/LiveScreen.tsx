import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Vibration,
} from 'react-native';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { MetricCard } from '../components/MetricCard';
import { MiniChart } from '../components/MiniChart';
import { RingGauge } from '../components/RingGauge';
import { Icon } from '../components/Icon';
import { Colors, Sp, Radius, monoNum } from '../theme';

function fmt(n: number, decimals = 2): string {
  if (!isFinite(n) || n === 0) return '–';
  return n.toFixed(decimals);
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function LiveScreen() {
  const {
    physics, sensor, history, isRecording, elapsed,
    currentLap, startSession, stopSession, addLap,
    crrSource, crrActive,
  } = useStore(useShallow((s) => ({
    physics: s.physics, sensor: s.sensor, history: s.history,
    isRecording: s.isRecording, elapsed: s.elapsed, currentLap: s.currentLap,
    startSession: s.startSession, stopSession: s.stopSession, addLap: s.addLap,
    crrSource: s.crrSource, crrActive: s.crrActive,
  })));

  const cdaHistory    = history.slice(-60).map((p) => p.physics.cda);
  const powerHistory  = history.slice(-60).map((p) => p.sensor.powerW);
  const speedKmh      = sensor.speedMs * 3.6;

  // delta rispetto al miglior CdA della sessione (per il RingGauge)
  const validCda  = history.map((p) => p.physics.cda).filter((v) => v > 0.05);
  const bestCda   = validCda.length ? Math.min(...validCda) : null;
  const deltaBest = physics.valid && bestCda != null ? physics.cda - bestCda : null;

  const handleRec = useCallback(() => {
    if (isRecording) stopSession();
    else startSession();
    Vibration.vibrate(50);
  }, [isRecording, startSession, stopSession]);

  const handleLap = useCallback(() => {
    addLap();
    Vibration.vibrate([0, 30, 50, 30]);
  }, [addLap]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero: anello CdA + quota aero ── */}
      <View style={styles.hero}>
        <RingGauge
          cda={physics.cda}
          valid={physics.valid}
          deltaBest={deltaBest}
          pctAero={physics.pctAero}
        />
      </View>

      {cdaHistory.length > 1 && (
        <View style={styles.sparkCard}>
          <Text style={styles.chartLabel}>CdA (ultimi 60s)</Text>
          <MiniChart data={cdaHistory} color={Colors.teal} height={32} />
        </View>
      )}

      {/* ── Metriche riga 1 ── */}
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

      {/* ── Metriche riga 2 ── */}
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

      {/* ── Metriche riga 3 ── */}
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
            <Text style={[styles.breakdownValue, { color: Colors.amber }]}>
              {fmt(physics.pAeroW, 0)} W ({fmt(physics.pctAero, 0)}%)
            </Text>
          </View>
          <View style={styles.breakdownRow}>
            <View style={styles.breakdownLabelGroup}>
              <Text style={styles.breakdownLabel}>Rolling</Text>
              <CrrBadge source={crrSource} crr={crrActive} />
            </View>
            <Text style={[styles.breakdownValue, { color: Colors.blue }]}>
              {fmt(physics.pRollingW, 0)} W
            </Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Gravità</Text>
            <Text style={styles.breakdownValue}>
              {fmt(physics.pGravityW, 0)} W
            </Text>
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
          <View style={styles.recDot} />
          <Text style={styles.lapText}>Lap {currentLap}  •  {fmtTime(elapsed)}</Text>
        </View>
      )}

      {/* ── Pulsanti: LAP primario in REC, STOP secondario ── */}
      {!isRecording ? (
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
          onPress={handleRec}
          activeOpacity={0.8}
        >
          <Icon name="record" size={20} color={Colors.teal} filled />
          <Text style={[styles.btnText, { color: Colors.teal }]}>AVVIA</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, styles.btnBig, { flex: 2 }]}
            onPress={handleLap}
            activeOpacity={0.8}
          >
            <Icon name="flag" size={24} color={Colors.teal} />
            <Text style={[styles.btnText, styles.btnTextBig, { color: Colors.teal }]}>LAP</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnStop, { flex: 1 }]}
            onPress={handleRec}
            activeOpacity={0.8}
          >
            <Icon name="stop" size={18} color={Colors.red} filled />
            <Text style={[styles.btnText, { color: Colors.red }]}>STOP</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

// ── Badge provenienza Crr ─────────────────────────────────────────────────────

type CrrSource = 'default' | 'manual' | 'calibrated' | 'profile';

const CRR_BADGE: Record<CrrSource, { label: string; color: string }> = {
  default:    { label: 'stima',    color: Colors.amber },
  manual:     { label: 'manuale',  color: Colors.muted },
  calibrated: { label: 'misurato', color: Colors.teal  },
  profile:    { label: 'profilo',  color: Colors.blue  },
};

function CrrBadge({ source, crr }: { source: CrrSource; crr: number }) {
  const { label, color } = CRR_BADGE[source];
  return (
    <View style={[badgeStyles.pill, { borderColor: color + '60' }]}>
      <Text style={[badgeStyles.crr, { color }]}>{crr.toFixed(4)}</Text>
      <Text style={[badgeStyles.label, { color: color + 'aa' }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             4,
    borderWidth:     0.5,
    borderRadius:    Radius.sm,
    paddingHorizontal: 5,
    paddingVertical:   1,
    marginLeft:      Sp.xs,
  },
  crr:   { ...monoNum, fontSize: 10, fontWeight: '600' },
  label: { fontSize: 9 },
});

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Sp.md, gap: Sp.sm, paddingBottom: Sp.xl },

  hero: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.lg,
    borderWidth:     0.5,
    borderColor:     Colors.teal + '33',
    padding:         Sp.lg,
    alignItems:      'center',
  },

  sparkCard: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },

  row: { flexDirection: 'row', gap: Sp.sm },

  breakdown: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.xs,
  },
  breakdownTitle:      { fontSize: 11, color: Colors.muted, textTransform: 'uppercase', marginBottom: Sp.xs },
  breakdownRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabelGroup: { flexDirection: 'row', alignItems: 'center' },
  breakdownLabel:      { fontSize: 13, color: Colors.text },
  breakdownValue:      { ...monoNum, fontSize: 13, color: Colors.muted },

  chartCard: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },
  chartLabel: { fontSize: 11, color: Colors.muted },

  lapInfo: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             Sp.xs,
    paddingVertical: Sp.xs,
  },
  recDot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.red },
  lapText: { ...monoNum, fontSize: 13, color: Colors.amber },

  buttonRow: { flexDirection: 'row', gap: Sp.sm },
  btn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             Sp.sm,
    borderRadius:    Radius.md,
    borderWidth:     1,
    paddingVertical: Sp.md,
    minHeight:       56,
  },
  btnPrimary: { borderColor: Colors.teal, backgroundColor: Colors.tealBg },
  btnStop:    { borderColor: Colors.red,  backgroundColor: Colors.redBg },
  btnBig:     { paddingVertical: Sp.lg },
  btnText:    { fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  btnTextBig: { fontSize: 20 },
});
