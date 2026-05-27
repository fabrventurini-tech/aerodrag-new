import React from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert,
} from 'react-native';
import { useStore, LapStats } from '../store';
import { Colors, Sp, Radius } from '../theme';

function fmt(n: number, d = 2): string {
  if (!isFinite(n) || n === 0) return '–';
  return n.toFixed(d);
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function LapRow({ lap }: { lap: LapStats }) {
  return (
    <View style={styles.lapRow}>
      <Text style={styles.lapIndex}>Lap {lap.index}</Text>
      <View style={styles.lapStats}>
        <View style={styles.lapStat}>
          <Text style={styles.lapStatLabel}>CdA</Text>
          <Text style={[styles.lapStatValue, { color: Colors.teal }]}>
            {fmt(lap.avgCda, 3)}
          </Text>
        </View>
        <View style={styles.lapStat}>
          <Text style={styles.lapStatLabel}>Potenza</Text>
          <Text style={styles.lapStatValue}>{fmt(lap.avgPowerW, 0)} W</Text>
        </View>
        <View style={styles.lapStat}>
          <Text style={styles.lapStatLabel}>Velocità</Text>
          <Text style={styles.lapStatValue}>
            {fmt(lap.avgSpeedMs * 3.6, 1)} km/h
          </Text>
        </View>
        <View style={styles.lapStat}>
          <Text style={styles.lapStatLabel}>Durata</Text>
          <Text style={styles.lapStatValue}>
            {fmtTime(lap.endT - lap.startT)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function SessionScreen() {
  const { history, laps, isRecording, previousSessions } = useStore();

  const cdaValues   = history.map((p) => p.physics.cda).filter((v) => v > 0);
  const powerValues = history.map((p) => p.sensor.powerW).filter((v) => v > 0);
  const speedValues = history.map((p) => p.sensor.speedMs).filter((v) => v > 0);
  const hrValues    = history.map((p) => p.sensor.hrBpm).filter((v) => v > 0);

  const hasCurrent = history.length > 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Sessione corrente ── */}
      <Text style={styles.sectionTitle}>
        {isRecording ? '⏺ Sessione in corso' : 'Sessione corrente'}
      </Text>

      {hasCurrent ? (
        <>
          {/* Statistiche globali */}
          <View style={styles.statsGrid}>
            <StatBox label="CdA medio"    value={fmt(avg(cdaValues), 3)}          color={Colors.teal}  />
            <StatBox label="CdA min"      value={fmt(Math.min(...cdaValues), 3)}  color={Colors.teal}  />
            <StatBox label="CdA max"      value={fmt(Math.max(...cdaValues), 3)}  color={Colors.amber} />
            <StatBox label="Potenza avg"  value={`${fmt(avg(powerValues), 0)} W`} color={Colors.amber} />
            <StatBox label="Velocità avg" value={`${fmt(avg(speedValues) * 3.6, 1)} km/h`} color={Colors.blue} />
            <StatBox label="HR medio"     value={`${fmt(avg(hrValues), 0)} bpm`}  color={Colors.red}   />
          </View>

          {/* Lap list */}
          {laps.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Lap</Text>
              {laps.map((lap) => (
                <LapRow key={lap.index} lap={lap} />
              ))}
            </>
          )}
        </>
      ) : (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            Nessuna sessione attiva.{'\n'}Premi REC nella schermata Live.
          </Text>
        </View>
      )}

      {/* ── Sessioni precedenti ── */}
      {previousSessions.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: Sp.lg }]}>
            Sessioni precedenti
          </Text>
          {previousSessions.map((session, i) => {
            const sCda   = session.map((p) => p.physics.cda).filter((v) => v > 0);
            const sPower = session.map((p) => p.sensor.powerW).filter((v) => v > 0);
            return (
              <View key={i} style={styles.prevSession}>
                <Text style={styles.prevSessionTitle}>
                  Sessione {previousSessions.length - i}
                  {'  '}
                  <Text style={styles.prevSessionSub}>
                    {session.length} campioni
                  </Text>
                </Text>
                <View style={styles.lapStats}>
                  <View style={styles.lapStat}>
                    <Text style={styles.lapStatLabel}>CdA avg</Text>
                    <Text style={[styles.lapStatValue, { color: Colors.teal }]}>
                      {fmt(avg(sCda), 3)}
                    </Text>
                  </View>
                  <View style={styles.lapStat}>
                    <Text style={styles.lapStatLabel}>Potenza avg</Text>
                    <Text style={styles.lapStatValue}>
                      {fmt(avg(sPower), 0)} W
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Sp.md, gap: Sp.sm, paddingBottom: Sp.xl },

  sectionTitle: {
    fontSize:  12,
    color:     Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Sp.sm,
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           Sp.sm,
  },
  statBox: {
    width:           '31%',
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.sm,
    gap:             2,
  },
  statLabel: { fontSize: 10, color: Colors.muted },
  statValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },

  lapRow: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },
  lapIndex: { fontSize: 13, color: Colors.teal, fontWeight: '600' },
  lapStats: { flexDirection: 'row', flexWrap: 'wrap', gap: Sp.sm },
  lapStat:  { gap: 2 },
  lapStatLabel: { fontSize: 10, color: Colors.muted },
  lapStatValue: { fontSize: 14, fontWeight: '600', color: Colors.text, fontVariant: ['tabular-nums'] },

  emptyBox: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.xl,
    alignItems:      'center',
  },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 22 },

  prevSession: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },
  prevSessionTitle: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  prevSessionSub:   { fontSize: 11, color: Colors.muted, fontWeight: '400' },
});