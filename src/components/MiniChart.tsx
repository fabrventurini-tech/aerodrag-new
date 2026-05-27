import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { Colors } from '../theme';

interface Props {
  data:    number[];
  color?:  string;
  height?: number;
}

export function MiniChart({ data, color = Colors.teal, height = 40 }: Props) {
  if (data.length < 2) return <View style={[styles.container, { height }]} />;

  const max = data.reduce((a, b) => (b > a ? b : a), data[0]);
  const min = data.reduce((a, b) => (b < a ? b : a), data[0]);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = (1 - (v - min) / range) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <View style={[styles.container, { height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width:    '100%',
    overflow: 'hidden',
  },
});
