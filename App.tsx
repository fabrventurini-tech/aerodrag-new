import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useMultiBLE } from './src/hooks/useMultiBLE';
import { useStore } from './src/store';
import { NavBar, Screen } from './src/components';

import { LiveScreen }     from './src/screens/LiveScreen';
import { SessionScreen }  from './src/screens/SessionScreen';
import { CoachScreen }    from './src/screens/CoachScreen';
import { AthletesScreen } from './src/screens/AthletesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

import { Colors, Sp } from './src/theme';
import { ConnectionStatus } from './src/store';

function statusColor(s: ConnectionStatus): string {
  if (s === 'connected')  return Colors.teal;
  if (s === 'error')      return Colors.red;
  if (s === 'scanning' || s === 'connecting') return Colors.amber;
  return Colors.muted;
}

function TopBar() {
  const {
    bleStatus, wheelStatus, hrStatus,
    batteryPct, wheelBattery, hrBattery,
    isRecording, elapsed,
    activeAthleteId, athleteProfiles,
    pairedWheelId, pairedHRId,
  } = useStore();

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:` +
    `${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:` +
    `${String(s % 60).padStart(2, '0')}`;

  const activeProfile = athleteProfiles.find(p => p.id === activeAthleteId);

  return (
    <View style={topStyles.bar}>
      <View style={topStyles.left}>
        {/* Device principale */}
        <View style={[topStyles.dot, { backgroundColor: statusColor(bleStatus) }]} />
        <Text style={topStyles.appName}>AeroDrag</Text>

        {/* Sensore ruota (solo se accoppiato) */}
        {pairedWheelId && (
          <View style={topStyles.devicePill}>
            <View style={[topStyles.miniDot, { backgroundColor: statusColor(wheelStatus) }]} />
            <Text style={topStyles.devicePillText}>W</Text>
          </View>
        )}

        {/* Fascia HR (solo se accoppiata) */}
        {pairedHRId && (
          <View style={topStyles.devicePill}>
            <View style={[topStyles.miniDot, { backgroundColor: statusColor(hrStatus) }]} />
            <Text style={topStyles.devicePillText}>HR</Text>
          </View>
        )}

        {activeProfile && (
          <View style={topStyles.pill}>
            <Text style={topStyles.pillText}>{activeProfile.name}</Text>
          </View>
        )}
      </View>

      <View style={topStyles.right}>
        {isRecording && (
          <View style={topStyles.recPill}>
            <View style={topStyles.recDot} />
            <Text style={topStyles.recTime}>{fmtTime(elapsed)}</Text>
          </View>
        )}
        {batteryPct > 0 && (
          <Text style={topStyles.battery}>{batteryPct}%</Text>
        )}
        {wheelBattery > 0 && pairedWheelId && (
          <Text style={topStyles.battery}>W:{wheelBattery}%</Text>
        )}
        {hrBattery > 0 && pairedHRId && (
          <Text style={topStyles.battery}>HR:{hrBattery}%</Text>
        )}
      </View>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('live');
  const {
    loadCalib, loadAthleteProfiles, loadPreviousSessions,
    loadPairedDeviceId, loadPairedPeripherals,
  } = useStore();

  useMultiBLE();

  useEffect(() => {
    loadCalib();
    loadAthleteProfiles();
    loadPreviousSessions();
    loadPairedDeviceId();
    loadPairedPeripherals();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <StatusBar style="light" />
          <TopBar />
          <View style={styles.body}>
            {screen === 'live'     && <LiveScreen />}
            {screen === 'session'  && <SessionScreen />}
            {screen === 'coach'    && <CoachScreen />}
            {screen === 'athletes' && <AthletesScreen />}
            {screen === 'settings' && <SettingsScreen />}
          </View>
          <NavBar current={screen} onNavigate={setScreen} />
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  body: { flex: 1 },
});

const topStyles = StyleSheet.create({
  bar: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingHorizontal: Sp.md,
    paddingVertical:   Sp.sm,
    backgroundColor:   Colors.s1,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  left:    { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  right:   { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  dot:     { width: 7, height: 7, borderRadius: 4 },
  miniDot: { width: 5, height: 5, borderRadius: 3 },
  appName: { fontSize: 14, fontWeight: '700', color: Colors.textBright },

  devicePill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    backgroundColor:   Colors.s2,
    borderRadius:      8,
    borderWidth:       0.5,
    borderColor:       Colors.border,
    paddingHorizontal: 5,
    paddingVertical:   2,
  },
  devicePillText: { fontSize: 10, color: Colors.muted, fontWeight: '600' },

  pill: {
    backgroundColor:   Colors.tealBg,
    borderRadius:      10,
    borderWidth:       0.5,
    borderColor:       Colors.teal + '55',
    paddingHorizontal: 8,
    paddingVertical:   2,
  },
  pillText: { fontSize: 11, color: Colors.teal, fontWeight: '600' },

  recPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               5,
    backgroundColor:   Colors.redBg,
    borderRadius:      12,
    borderWidth:       0.5,
    borderColor:       Colors.red,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },
  recDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.red },
  recTime: { fontSize: 11, color: Colors.red, fontVariant: ['tabular-nums'] },
  battery: { fontSize: 11, color: Colors.muted },
});
