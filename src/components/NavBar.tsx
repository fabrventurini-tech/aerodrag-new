import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors, Sp } from '../theme';
import { Icon, IconName } from './Icon';

export type Screen = 'live' | 'session' | 'coach' | 'athletes' | 'settings';

interface Props {
  current:    Screen;
  onNavigate: (s: Screen) => void;
}

const TABS: { id: Screen; label: string; icon: IconName }[] = [
  { id: 'live',     label: 'Live',     icon: 'live' },
  { id: 'session',  label: 'Sessione', icon: 'session' },
  { id: 'coach',    label: 'Coach',    icon: 'coach' },
  { id: 'athletes', label: 'Atleti',   icon: 'athletes' },
  { id: 'settings', label: 'Setup',    icon: 'settings' },
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
            {active && <View style={styles.indicator} />}
            <Icon
              name={tab.icon}
              size={22}
              color={active ? Colors.teal : Colors.muted}
              strokeWidth={active ? 2.2 : 1.8}
            />
            <Text style={[styles.label, active && styles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection:   'row',
    backgroundColor: Colors.s1,
    borderTopWidth:  0.5,
    borderTopColor:  Colors.border,
    paddingBottom:   Sp.sm,
  },
  tab: {
    flex:          1,
    alignItems:    'center',
    paddingTop:    Sp.sm,
    paddingBottom: Sp.xs,
    gap:           3,
  },
  label:       { fontSize: 10, color: Colors.muted },
  labelActive: { color: Colors.teal, fontWeight: '600' },
  indicator: {
    position:        'absolute',
    top:             0,
    width:           24,
    height:          2,
    backgroundColor: Colors.teal,
    borderRadius:    1,
  },
});
