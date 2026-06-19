import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useBLE } from './src/hooks/useBLE';
import { useWheelSensor, wheelSensorApi } from './src/hooks/useWheelSensor';
import { coachAutoConnect } from './src/coach/link';
import { useStore } from './src/store';
import { NavBar, Screen } from './src/components';

import { LiveScreen }     from './src/screens/LiveScreen';
import { SessionScreen }  from './src/screens/SessionScreen';
import { CoachScreen }    from './src/screens/CoachScreen';
import { AthletesScreen } from './src/screens/AthletesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

import { Colors, Sp } from './src/theme';

function TopBar() {
  const {
    bleStatus, batteryPct, isRecording, elapsed,
    activeAthleteId, athleteProfiles,
    wheelSensorStatus, cadenceSensorStatus,
  } = useStore();

  const bleColor =
    bleStatus === 'connected'                                    ? Colors.teal  :
    bleStatus === 'error'                                        ? Colors.red   :
    bleStatus === 'scanning' || bleStatus === 'connecting'       ? Colors.amber :
    Colors.muted;

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:` +
    `${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:` +
    `${String(s % 60).padStart(2, '0')}`;

  const activeProfile = athleteProfiles.find((p) => p.id === activeAthleteId);

  return (
    <View style={topStyles.bar}>
      <View style={topStyles.left}>
        <View style={[topStyles.dot, { backgroundColor: bleColor }]} />
        <Text style={topStyles.appName}>AeroDrag</Text>
        {activeProfile && (
          <View style={topStyles.pill}>
            <Text style={topStyles.pillText}>{activeProfile.name}</Text>
          </View>
        )}
      </View>
      <View style={topStyles.right}>
        {wheelSensorStatus === 'connected' && (
          <View style={[topStyles.dot, { backgroundColor: Colors.blue }]} />
        )}
        {cadenceSensorStatus === 'connected' && (
          <View style={[topStyles.dot, { backgroundColor: Colors.amber }]} />
        )}
        {isRecording && (
          <View style={topStyles.recPill}>
            <View style={topStyles.recDot} />
            <Text style={topStyles.recTime}>{fmtTime(elapsed)}</Text>
          </View>
        )}
        {batteryPct > 0 && (
          <Text style={topStyles.battery}>{batteryPct}%</Text>
        )}
      </View>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('live');
  const {
    loadCalib, loadAthleteProfiles, loadPreviousSessions, loadPairedDeviceId,
    calib, activeAthleteId, athleteProfiles,
  } = useStore();

  const { syncConfigToDevice } = useBLE();
  useWheelSensor();

  // Ogni volta che l'utente modifica massa, Crr o circonferenza ruota,
  // aggiorna sia l'ESP32 (config 12 B) sia il sensore ruota nRF52840
  useEffect(() => {
    const active = athleteProfiles.find((p) => p.id === activeAthleteId);
    const mass = (active?.massRiderKg ?? calib.massRiderKg)
               + (active?.massBikeKg  ?? calib.massBikeKg);
    const crr  = active?.crr ?? calib.crr;
    syncConfigToDevice(mass, crr);
    wheelSensorApi.writeConfig(calib.tireCircM, mass).catch(() => {});
  }, [calib, activeAthleteId, athleteProfiles]);

  useEffect(() => {
    loadCalib();
    loadAthleteProfiles();
    loadPreviousSessions();
    loadPairedDeviceId();
    useStore.getState().loadCrrHistory();
    coachAutoConnect();  // riconnette alla dashboard coach se un URL era salvato
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
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    paddingHorizontal: Sp.md,
    paddingVertical:   Sp.sm,
    backgroundColor:  Colors.s1,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  left:    { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  right:   { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  dot:     { width: 7, height: 7, borderRadius: 4 },
  appName: { fontSize: 14, fontWeight: '700', color: Colors.textBright },
  pill: {
    backgroundColor: Colors.tealBg,
    borderRadius:    10,
    borderWidth:     0.5,
    borderColor:     Colors.teal + '55',
    paddingHorizontal: 8,
    paddingVertical:   2,
  },
  pillText: { fontSize: 11, color: Colors.teal, fontWeight: '600' },
  recPill: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             5,
    backgroundColor: Colors.redBg,
    borderRadius:    12,
    borderWidth:     0.5,
    borderColor:     Colors.red,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },
  recDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.red },
  recTime: { fontSize: 11, color: Colors.red, fontVariant: ['tabular-nums'] },
  battery: { fontSize: 11, color: Colors.muted },
});