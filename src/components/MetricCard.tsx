import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Sp, Radius } from '../theme';

interface Props {
  label:    string;
  value:    string;
  unit?:    string;
  color?:   string;
  dim?:     boolean;
}

export function MetricCard({ label, value, unit, color = Colors.teal, dim = false }: Props) {
  return (
    <View style={[styles.card, dim && styles.cardDim]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Text style={[styles.value, { color }]}>{value}</Text>
        {unit && <Text style={styles.unit}>{unit}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex:            1,
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.xs,
  },
  cardDim: {
    opacity: 0.5,
  },
  label: {
    fontSize: 11,
    color:    Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'baseline',
    gap:           4,
  },
  value: {
    fontSize:   28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontSize: 13,
    color:    Colors.muted,
  },
});