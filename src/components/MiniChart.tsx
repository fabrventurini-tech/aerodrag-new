import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '../theme';

interface Props {
  data:    number[];
  color?:  string;
  height?: number;
}

export function MiniChart({ data, color = Colors.teal, height = 40 }: Props) {
  if (data.length < 2) return <View style={[styles.container, { height }]} />;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const normalized = data.map((v) => (v - min) / range);

  return (
    <View style={[styles.container, { height }]}>
      {normalized.slice(0, -1).map((v, i) => {
        const nextV = normalized[i + 1];
        const x1    = (i / (normalized.length - 1)) * 100;
        const x2    = ((i + 1) / (normalized.length - 1)) * 100;
        const y1    = (1 - v) * height;
        const y2    = (1 - nextV) * height;
        const top   = Math.min(y1, y2);
        const segH  = Math.max(Math.abs(y2 - y1), 1);

        return (
          <View
            key={i}
            style={{
              position:        'absolute',
              left:            `${x1}%` as any,
              top,
              width:           `${x2 - x1}%` as any,
              height:          segH,
              backgroundColor: color,
              opacity:         0.5 + (i / normalized.length) * 0.5,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width:    '100%',
    overflow: 'hidden',
  },
});