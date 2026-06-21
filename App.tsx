import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Inter_400Regular,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';

import { useBLE } from './src/hooks/useBLE';
import { coachAutoConnect } from './src/coach/link';
import { useStore } from './src/store';
import { useShallow } from 'zustand/react/shallow';
import { NavBar, Screen } from './src/components';

import { LiveScreen }     from './src/screens/LiveScreen';
import { SessionScreen }  from './src/screens/SessionScreen';
import { CoachScreen }    from './src/screens/CoachScreen';
import { AthletesScreen } from './src/screens/AthletesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

import { Colors, Sp, monoNum } from './src/theme';

// Tiene visibile la splash finché i font non sono caricati: i `fontFamily`
// mono (JetBrains) vengono applicati SOLO dopo il load, altrimenti su Android
// il testo resterebbe invisibile (nessun fallback per famiglie non ancora note).
SplashScreen.preventAutoHideAsync().catch(() => {});

function TopBar() {
  const {
    bleStatus, batteryPct, isRecording, elapsed,
    activeAthleteId, athleteProfiles,
    wheelSensorStatus, cadenceSensorStatus,
  } = useStore(useShallow((s) => ({
    bleStatus: s.bleStatus, batteryPct: s.batteryPct,
    isRecording: s.isRecording, elapsed: s.elapsed,
    activeAthleteId: s.activeAthleteId, athleteProfiles: s.athleteProfiles,
    wheelSensorStatus: s.wheelSensorStatus, cadenceSensorStatus: s.cadenceSensorStatus,
  })));

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

  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    Inter_400Regular,
    Inter_600SemiBold,
  });

  const onLayoutRootView = useCallback(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);
  const {
    loadCalib, loadAthleteProfiles, loadPreviousSessions, loadPairedDeviceId,
    calib, activeAthleteId, athleteProfiles,
  } = useStore(useShallow((s) => ({
    loadCalib: s.loadCalib, loadAthleteProfiles: s.loadAthleteProfiles,
    loadPreviousSessions: s.loadPreviousSessions, loadPairedDeviceId: s.loadPairedDeviceId,
    calib: s.calib, activeAthleteId: s.activeAthleteId, athleteProfiles: s.athleteProfiles,
  })));

  const { syncConfigToDevice } = useBLE();

  // Ogni volta che l'utente modifica massa, Crr o circonferenza ruota, aggiorna
  // l'ESP32 (CONFIG 0xaa08, 12 B). Il firmware propaga wheelCircM/massa al
  // sensore ruota (contract v0.2.0): l'app non scrive più direttamente al sensore.
  useEffect(() => {
    const active = athleteProfiles.find((p) => p.id === activeAthleteId);
    const mass = (active?.massRiderKg ?? calib.massRiderKg)
               + (active?.massBikeKg  ?? calib.massBikeKg);
    const crr  = active?.crr ?? calib.crr;
    syncConfigToDevice(mass, crr);
  }, [calib, activeAthleteId, athleteProfiles]);

  useEffect(() => {
    loadCalib();
    loadAthleteProfiles();
    loadPreviousSessions();
    loadPairedDeviceId();
    useStore.getState().loadCrrHistory();
    coachAutoConnect();  // riconnette alla dashboard coach se un URL era salvato
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
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
  recTime: { ...monoNum, fontSize: 11, color: Colors.red },
  battery: { ...monoNum, fontSize: 11, color: Colors.muted },
});