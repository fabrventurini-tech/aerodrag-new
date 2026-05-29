import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, Switch,
} from 'react-native';
import { useStore } from '../store';
import {
  loadPairedDevice, unpairDevice, loadSensorWhitelist,
  removeSensorFromWhitelist, clearSensorWhitelist,
  loadPreferredWheelSensor, removePreferredWheelSensor,
  savePreferredWheelSensor,
  PairedDevice, SensorEntry, WheelSensorDevice,
} from '../security/pairing';
import { QRPairScreen } from './QRPairScreen';
import { CrrCalibrationScreen } from './CrrCalibrationScreen';
import { Colors, Sp, Radius } from '../theme';

export function SettingsScreen() {
  const {
    calib, setCalib, isSimMode, setSimMode,
    setPairedDevice: setStorePairedDevice,
    wheelSensorStatus, wheelSensorId, crrCalib,
  } = useStore();

  const [pairedDevice, setPairedDevice]     = useState<PairedDevice | null>(null);
  const [sensorList, setSensorList]         = useState<SensorEntry[]>([]);
  const [wheelSensor, setWheelSensor]       = useState<WheelSensorDevice | null>(null);
  const [showScanner, setShowScanner]       = useState(false);
  const [showCrrCalib, setShowCrrCalib]     = useState(false);

  useEffect(() => {
    loadPairedDevice().then(setPairedDevice);
    loadSensorWhitelist().then(setSensorList);
    loadPreferredWheelSensor().then(setWheelSensor);
  }, []);

  async function handleUnpair() {
    Alert.alert(
      'Disaccoppia device',
      'Rimuovere il pairing con il device AeroDrag?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Disaccoppia',
          style: 'destructive',
          onPress: async () => {
            await unpairDevice();
            setPairedDevice(null);
            setStorePairedDevice(null);
          },
        },
      ]
    );
  }

  async function handleRemoveSensor(id: string) {
    await removeSensorFromWhitelist(id);
    setSensorList(await loadSensorWhitelist());
  }

  async function handleClearSensors() {
    await clearSensorWhitelist();
    setSensorList([]);
  }

  async function handleRemoveWheelSensor() {
    Alert.alert(
      'Rimuovi sensore ruota',
      'Il sensore preferito verrà rimosso. L\'app si connetterà al primo sensore disponibile.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Rimuovi',
          style: 'destructive',
          onPress: async () => {
            await removePreferredWheelSensor();
            setWheelSensor(null);
          },
        },
      ]
    );
  }

  const lastCrr = crrCalib.result ?? crrCalib.history[0] ?? null;
  const wheelConnected = wheelSensorStatus === 'connected';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Device AeroDrag ── */}
      <Text style={styles.sectionTitle}>Device AeroDrag</Text>
      <View style={styles.card}>
        {pairedDevice ? (
          <>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: Colors.teal }]} />
              <Text style={styles.deviceName}>{pairedDevice.name}</Text>
            </View>
            <Text style={styles.deviceId}>{pairedDevice.id}</Text>
            <Text style={styles.deviceDate}>
              Accoppiato il {new Date(pairedDevice.pairedAt).toLocaleDateString('it-IT')}
            </Text>
            <TouchableOpacity style={styles.dangerBtn} onPress={handleUnpair}>
              <Text style={styles.dangerText}>Disaccoppia</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.emptyText}>Nessun device accoppiato</Text>
            <Text style={styles.hint}>
              Scansiona il QR code sul device AeroDrag per accoppiarlo.
            </Text>
          </>
        )}
        <TouchableOpacity
          style={[styles.btnPair, pairedDevice ? styles.btnPairSecondary : null]}
          onPress={() => setShowScanner(true)}
        >
          <Text style={[styles.btnPairText, pairedDevice ? { color: Colors.muted } : null]}>
            {pairedDevice ? 'Riaccoppia un altro device' : 'Scansiona QR'}
          </Text>
        </TouchableOpacity>
      </View>

      <QRPairScreen
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onPaired={(device) => setPairedDevice(device)}
      />

      {/* ── Sensore ruota Crr ── */}
      <Text style={styles.sectionTitle}>Sensore Ruota — Crr</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.dot, {
            backgroundColor: wheelConnected ? Colors.teal :
              wheelSensorStatus === 'scanning' ? Colors.amber : Colors.muted
          }]} />
          <Text style={styles.deviceName}>
            {wheelConnected
              ? (wheelSensor?.name ?? 'AeroDrag Wheel')
              : wheelSensorStatus === 'scanning'
                ? 'Ricerca sensore…'
                : 'Sensore non connesso'}
          </Text>
        </View>

        {wheelSensor && (
          <Text style={styles.deviceId}>{wheelSensor.id}</Text>
        )}

        <Text style={styles.hint}>
          Il sensore ruota usa pairing non esclusivo: Wahoo, Garmin e altre app
          leggono la velocità tramite il profilo CSC standard. AeroDrag accede
          ai dati IMU ad alta frequenza per il calcolo del Crr.
        </Text>

        {lastCrr && (
          <View style={styles.crrRow}>
            <Text style={styles.crrLabel}>Ultimo Crr misurato</Text>
            <Text style={styles.crrValue}>{lastCrr.crr.toFixed(4)}</Text>
            <Text style={styles.crrConf}>{lastCrr.confidence}% conf.</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, !wheelConnected && styles.btnDisabled]}
          onPress={() => setShowCrrCalib(true)}
        >
          <Text style={styles.primaryBtnText}>Calibra Crr</Text>
        </TouchableOpacity>

        {wheelSensor && (
          <TouchableOpacity style={styles.dangerBtn} onPress={handleRemoveWheelSensor}>
            <Text style={styles.dangerText}>Rimuovi sensore preferito</Text>
          </TouchableOpacity>
        )}
      </View>

      <CrrCalibrationScreen
        visible={showCrrCalib}
        onClose={() => setShowCrrCalib(false)}
        sendCommand={async () => true}
      />

      {/* ── Sensori BLE accoppiati ── */}
      <Text style={styles.sectionTitle}>Sensori BLE accoppiati</Text>
      <View style={styles.card}>
        {sensorList.length === 0 ? (
          <Text style={styles.emptyText}>
            Nessun sensore salvato.{'\n'}
            I sensori vengono aggiunti automaticamente al primo collegamento.
          </Text>
        ) : (
          <>
            {sensorList.map((s) => (
              <View key={s.id} style={styles.sensorRow}>
                <View style={styles.sensorInfo}>
                  <Text style={styles.sensorName}>{s.name}</Text>
                  <Text style={styles.sensorType}>{s.type.toUpperCase()}</Text>
                </View>
                <TouchableOpacity onPress={() => handleRemoveSensor(s.id)}>
                  <Text style={styles.removeText}>Rimuovi</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.dangerBtn} onPress={handleClearSensors}>
              <Text style={styles.dangerText}>Rimuovi tutti i sensori</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Calibrazione ── */}
      <Text style={styles.sectionTitle}>Calibrazione</Text>
      <View style={styles.card}>
        <CalibRow
          label="Massa ciclista (kg)"
          value={calib.massRiderKg}
          step={0.5}
          min={30}
          max={130}
          onChange={(v) => setCalib({ massRiderKg: v })}
        />
        <CalibRow
          label="Massa bici (kg)"
          value={calib.massBikeKg}
          step={0.5}
          min={3}
          max={30}
          onChange={(v) => setCalib({ massBikeKg: v })}
        />
        <CalibRow
          label="CRR"
          value={calib.crr}
          step={0.0005}
          min={0.001}
          max={0.015}
          decimals={4}
          onChange={(v) => setCalib({ crr: v })}
        />
        <CalibRow
          label="Offset Pitot (Pa)"
          value={calib.pitotOffset}
          step={0.5}
          min={-10}
          max={10}
          onChange={(v) => setCalib({ pitotOffset: v })}
        />
      </View>

      {/* ── Modalità simulazione ── */}
      <Text style={styles.sectionTitle}>Sviluppo</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.switchLabel}>Modalità simulazione</Text>
            <Text style={styles.switchHint}>Genera dati sintetici senza ESP32</Text>
          </View>
          <Switch
            value={isSimMode}
            onValueChange={setSimMode}
            trackColor={{ false: Colors.s2, true: Colors.teal + '80' }}
            thumbColor={isSimMode ? Colors.teal : Colors.muted}
          />
        </View>
      </View>
    </ScrollView>
  );
}

// ── Componente calibrazione ────────────────────────────────────────────────────

interface CalibRowProps {
  label:    string;
  value:    number;
  step:     number;
  min:      number;
  max:      number;
  decimals?: number;
  onChange: (v: number) => void;
}

function CalibRow({ label, value, step, min, max, decimals = 1, onChange }: CalibRowProps) {
  const dec = (n: number) => parseFloat(n.toFixed(decimals + 2));

  return (
    <View style={styles.calibRow}>
      <Text style={styles.calibLabel}>{label}</Text>
      <View style={styles.calibControls}>
        <TouchableOpacity
          style={styles.calibBtn}
          onPress={() => onChange(Math.max(min, dec(value - step)))}
        >
          <Text style={styles.calibBtnText}>–</Text>
        </TouchableOpacity>
        <Text style={styles.calibValue}>{value.toFixed(decimals)}</Text>
        <TouchableOpacity
          style={styles.calibBtn}
          onPress={() => onChange(Math.min(max, dec(value + step)))}
        >
          <Text style={styles.calibBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Sp.md, gap: Sp.sm, paddingBottom: Sp.xl },

  sectionTitle: {
    fontSize:      12,
    color:         Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop:     Sp.sm,
  },

  card: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },

  row:        { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  dot:        { width: 8, height: 8, borderRadius: 4 },
  deviceName: { fontSize: 16, fontWeight: '600', color: Colors.textBright },
  deviceId:   { fontSize: 11, color: Colors.muted, fontFamily: 'monospace' },
  deviceDate: { fontSize: 11, color: Colors.muted },

  emptyText: { fontSize: 13, color: Colors.muted, lineHeight: 20 },
  hint:      { fontSize: 11, color: Colors.muted, fontStyle: 'italic' },

  dangerBtn: {
    backgroundColor: Colors.redBg,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.red,
    padding:         Sp.sm,
    alignItems:      'center',
    marginTop:       Sp.xs,
  },
  dangerText: { color: Colors.red, fontWeight: '600', fontSize: 13 },

  btnPair: {
    backgroundColor: Colors.tealBg,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.teal,
    padding:         Sp.sm,
    alignItems:      'center',
    marginTop:       Sp.xs,
  },
  btnPairSecondary: {
    backgroundColor: Colors.s2,
    borderColor:     Colors.border,
  },
  btnPairText: { color: Colors.teal, fontWeight: '600', fontSize: 13 },

  sensorRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingVertical: Sp.xs,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  sensorInfo: { gap: 2 },
  sensorName: { fontSize: 13, color: Colors.text },
  sensorType: { fontSize: 10, color: Colors.teal },
  removeText: { fontSize: 12, color: Colors.red },

  calibRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingVertical: Sp.xs,
  },
  calibLabel:    { fontSize: 13, color: Colors.text, flex: 1 },
  calibControls: { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  calibBtn: {
    width:           32,
    height:          32,
    backgroundColor: Colors.s2,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  calibBtnText:  { fontSize: 18, color: Colors.text, lineHeight: 22 },
  calibValue:    { fontSize: 14, color: Colors.textBright, minWidth: 60, textAlign: 'center', fontVariant: ['tabular-nums'] },

  switchRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  switchLabel: { fontSize: 13, color: Colors.text },
  switchHint:  { fontSize: 11, color: Colors.muted },

  crrRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            Sp.sm,
    paddingVertical: Sp.xs,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  crrLabel: { fontSize: 11, color: Colors.muted, flex: 1 },
  crrValue: { fontSize: 18, color: Colors.teal, fontWeight: '700', fontVariant: ['tabular-nums'] },
  crrConf:  { fontSize: 11, color: Colors.amber },

  primaryBtn: {
    backgroundColor: Colors.tealBg,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.teal,
    padding:         Sp.sm,
    alignItems:      'center',
    marginTop:       Sp.xs,
  },
  primaryBtnText: { color: Colors.teal, fontWeight: '600', fontSize: 13 },
  btnDisabled: { opacity: 0.4 },
});