import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors, Sp } from '../theme';

export type Screen = 'live' | 'session' | 'coach' | 'athletes' | 'settings';

interface Props {
  current:    Screen;
  onNavigate: (s: Screen) => void;
}

const TABS: { id: Screen; label: string; icon: string }[] = [
  { id: 'live',     label: 'Live',     icon: '⬤' },
  { id: 'session',  label: 'Sessione', icon: '📊' },
  { id: 'coach',    label: 'Coach',    icon: '📡' },
  { id: 'athletes', label: 'Atleti',   icon: '👤' },
  { id: 'settings', label: 'Setup',    icon: '⚙️' },
];

export function NavBar({ current, onNavigate }: Props) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const active = tab.id === current;
        return (
          <TouchableOpacity
            key={tab.id}
            style={styles.tab}
            onPress={() => onNavigate(tab.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.icon}>{tab.icon}</Text>
            <Text style={[styles.label, active && styles.labelActive]}>
              {tab.label}
            </Text>
            {active && <View style={styles.indicator} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection:     'row',
    backgroundColor:   Colors.s1,
    borderTopWidth:    0.5,
    borderTopColor:    Colors.border,
    paddingBottom:     Sp.sm,
  },
  tab: {
    flex:           1,
    alignItems:     'center',
    paddingTop:     Sp.sm,
    paddingBottom:  Sp.xs,
    gap:            2,
  },
  icon:  { fontSize: 16 },
  label: { fontSize: 10, color: Colors.muted },
  labelActive: { color: Colors.teal },
  indicator: {
    position:        'absolute',
    top:             0,
    width:           24,
    height:          2,
    backgroundColor: Colors.teal,
    borderRadius:    1,
  },
});