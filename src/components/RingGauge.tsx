import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors, Color, Sp, monoNum, monoNumBold } from '../theme';

interface Props {
  cda:       number;
  valid:     boolean;
  /** delta rispetto al best di sessione (negativo = migliore) */
  deltaBest?: number | null;
  pctAero:   number;
}

const SIZE   = 168;
const STROKE = 12;
const R      = (SIZE - STROKE) / 2;
const C      = 2 * Math.PI * R;

// CdA: più basso = meglio. Mappa [0.45 → 0.15] su [0 → 1] di riempimento.
function fillFraction(cda: number): number {
  const f = (0.45 - cda) / (0.45 - 0.15);
  return Math.max(0, Math.min(1, f));
}

export function RingGauge({ cda, valid, deltaBest, pctAero }: Props) {
  const frac = valid ? fillFraction(cda) : 0;
  const dash = C * frac;

  const better = typeof deltaBest === 'number' && deltaBest < -0.0005;
  const deltaTxt =
    typeof deltaBest === 'number' && valid && Math.abs(deltaBest) >= 0.0005
      ? `${deltaBest > 0 ? '+' : ''}${deltaBest.toFixed(3)}`
      : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.ringBox}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={Color.accent} />
              <Stop offset="1" stopColor={Color.speed} />
            </LinearGradient>
          </Defs>
          <Circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            stroke={Color.track} strokeWidth={STROKE} fill="none"
          />
          {valid && (
            <Circle
              cx={SIZE / 2} cy={SIZE / 2} r={R}
              stroke="url(#ring)" strokeWidth={STROKE} fill="none"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={C / 4}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          )}
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.cdaLabel}>CdA</Text>
          <Text style={styles.cdaValue}>{valid ? cda.toFixed(3) : '–'}</Text>
          <Text style={styles.cdaUnit}>m²</Text>
          {deltaTxt && (
            <Text style={[styles.delta, { color: better ? Colors.positive : Colors.muted }]}>
              {deltaTxt}
            </Text>
          )}
        </View>
      </View>

      {/* pctAero a fianco */}
      <View style={styles.aero}>
        <Text style={styles.aeroLabel}>QUOTA AERO</Text>
        <View style={styles.aeroRow}>
          <Text style={styles.aeroValue}>{valid && pctAero > 0 ? pctAero.toFixed(0) : '–'}</Text>
          <Text style={styles.aeroUnit}>%</Text>
        </View>
        <View style={styles.aeroTrack}>
          <View
            style={[
              styles.aeroFill,
              { width: `${valid ? Math.max(0, Math.min(100, pctAero)) : 0}%` as any },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Sp.lg,
  },
  ringBox: {
    width:          SIZE,
    height:         SIZE,
    alignItems:     'center',
    justifyContent: 'center',
  },
  center: {
    position:       'absolute',
    top:            0,
    left:           0,
    right:          0,
    bottom:         0,
    alignItems:     'center',
    justifyContent: 'center',
  },
  cdaLabel: { fontSize: 11, color: Colors.muted, letterSpacing: 1 },
  cdaValue: { ...monoNumBold, fontSize: 34, color: Colors.teal, marginVertical: 1 },
  cdaUnit:  { fontSize: 12, color: Colors.muted },
  delta:    { ...monoNum, fontSize: 12, marginTop: 2 },

  aero: {
    flex:       1,
    gap:        Sp.xs,
  },
  aeroLabel: { fontSize: 10, color: Colors.muted, letterSpacing: 0.6 },
  aeroRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  aeroValue: { ...monoNumBold, fontSize: 30, color: Colors.amber },
  aeroUnit:  { fontSize: 13, color: Colors.muted },
  aeroTrack: {
    height:          6,
    backgroundColor: Colors.s2,
    borderRadius:    3,
    overflow:        'hidden',
  },
  aeroFill: {
    height:          6,
    backgroundColor: Colors.amber,
    borderRadius:    3,
  },
});
