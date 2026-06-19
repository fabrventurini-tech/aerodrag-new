import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, Switch, Modal, ActivityIndicator, Platform,
} from 'react-native';
import { useStore } from '../store';
import {
  loadPairedDevice, unpairDevice, loadSensorWhitelist,
  addSensorToWhitelist, removeSensorFromWhitelist, clearSensorWhitelist,
  loadWheelSensorList, removeWheelSensor,
  loadActiveWheelSensorId, setActiveWheelSensorId,
  PairedDevice, SensorEntry, WheelSensorDevice,
} from '../security/pairing';
import { QRPairScreen } from './QRPairScreen';
import { CrrCalibrationScreen } from './CrrCalibrationScreen';
import { wheelSensorApi } from '../hooks/useWheelSensor';
import { bleApi } from '../hooks/useBLE';
import { sensorPairing, DiscoveredSensor } from '../hooks/useSensorPairing';
import { Colors, Sp, Radius } from '../theme';

const SENSOR_TYPE_LABEL: Record<SensorEntry['type'], string> = {
  power: 'Potenza',
  csc:   'Velocità/Cadenza',
  hr:    'Cardio',
};

// Circonferenze comuni (ETRTO → mm di rotolamento effettivo)
const WHEEL_PRESETS = [
  { label: '700×23', mm: 2096 },
  { label: '700×25', mm: 2105 },
  { label: '700×28', mm: 2136 },
  { label: '700×32', mm: 2155 },
] as const;

export function SettingsScreen() {
  const {
    calib, setCalib, isSimMode, setSimMode,
    setPairedDevice: setStorePairedDevice,
    wheelSensorStatus, wheelSensorId, crrCalib,
  } = useStore();

  const [pairedDevice, setPairedDevice]   = useState<PairedDevice | null>(null);
  const [sensorList, setSensorList]       = useState<SensorEntry[]>([]);
  const [wheelSensors, setWheelSensors]   = useState<WheelSensorDevice[]>([]);
  const [activeWheelId, setActiveWheelId] = useState<string | null>(null);
  const [showScanner, setShowScanner]     = useState(false);
  const [showCrrCalib, setShowCrrCalib]   = useState(false);
  // Pairing sensori esterni (scan-to-add → whitelist firmware 0xaa0b)
  const [showSensorScan, setShowSensorScan] = useState(false);
  const [discovered, setDiscovered]         = useState<DiscoveredSensor[]>([]);
  const [scanning, setScanning]             = useState(false);

  const refreshWheelSensors = async () => {
    const [list, activeId] = await Promise.all([
      loadWheelSensorList(),
      loadActiveWheelSensorId(),
    ]);
    setWheelSensors(list);
    setActiveWheelId(activeId ?? list[0]?.id ?? null);
  };

  useEffect(() => {
    loadPairedDevice().then(setPairedDevice);
    loadSensorWhitelist().then(setSensorList);
    refreshWheelSensors();
  }, []);

  // ── Pairing sensori esterni (broker) ───────────────────────────────────────
  function openSensorScan() {
    setDiscovered([]);
    setScanning(true);
    setShowSensorScan(true);
    sensorPairing.startScan(
      (s) => setDiscovered((prev) => (prev.some((d) => d.id === s.id) ? prev : [...prev, s])),
      () => setScanning(false),
    );
  }

  function closeSensorScan() {
    sensorPairing.stopScan();
    setScanning(false);
    setShowSensorScan(false);
  }

  async function addDiscovered(s: DiscoveredSensor) {
    await addSensorToWhitelist({ id: s.id, name: s.name, type: s.type });
    setSensorList(await loadSensorWhitelist());
    await bleApi.syncSensorWhitelist();   // riscrive la whitelist sul firmware
    closeSensorScan();
  }

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
    await bleApi.syncSensorWhitelist();
  }

  async function handleClearSensors() {
    await clearSensorWhitelist();
    setSensorList([]);
    await bleApi.syncSensorWhitelist();
  }

  async function handleRemoveWheelSensor(id: string, name: string) {
    Alert.alert(
      'Rimuovi sensore',
      `Rimuovere "${name}" dalla lista?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Rimuovi',
          style: 'destructive',
          onPress: async () => {
            await removeWheelSensor(id);
            await refreshWheelSensors();
          },
        },
      ]
    );
  }

  async function handleSetActiveWheelSensor(id: string) {
    await setActiveWheelSensorId(id);
    setActiveWheelId(id);
    wheelSensorApi.setPreferred(id);  // applica subito senza riavvio
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

      {/* ── Sensori Ruota Crr ── */}
      <Text style={styles.sectionTitle}>Sensori Ruota — Crr</Text>
      <View style={styles.card}>

        {/* Stato connessione live */}
        <View style={styles.row}>
          <View style={[styles.dot, {
            backgroundColor: wheelConnected ? Colors.teal :
              wheelSensorStatus === 'scanning' ? Colors.amber : Colors.muted
          }]} />
          <Text style={styles.deviceName}>
            {wheelConnected
              ? `Connesso${wheelSensorId ? ` · ${wheelSensorId.slice(-5)}` : ''}`
              : wheelSensorStatus === 'scanning'
                ? 'Ricerca sensore…'
                : 'Nessun sensore attivo'}
          </Text>
        </View>

        <Text style={styles.hint}>
          Il sensore usa pairing multiplo non esclusivo: fino a 3 centrali
          simultanei (es. app atleta + app coach + Garmin). Wahoo e Garmin
          leggono la velocità via profilo CSC standard senza configurazione.
        </Text>

        {/* Lista sensori registrati */}
        {wheelSensors.length > 0 && (
          <>
            <Text style={styles.subSectionLabel}>Sensori registrati</Text>
            {wheelSensors.map((s) => (
              <View key={s.id} style={styles.wheelSensorRow}>
                <TouchableOpacity
                  style={styles.wheelSensorLeft}
                  onPress={() => handleSetActiveWheelSensor(s.id)}
                >
                  <View style={[styles.radioOuter, s.id === activeWheelId && styles.radioActive]}>
                    {s.id === activeWheelId && <View style={styles.radioInner} />}
                  </View>
                  <View style={styles.wheelSensorInfo}>
                    <Text style={styles.wheelSensorName}>{s.name}</Text>
                    {s.bikeLabel && <Text style={styles.wheelSensorBike}>{s.bikeLabel}</Text>}
                    <Text style={styles.deviceId}>{s.id}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemoveWheelSensor(s.id, s.name)}>
                  <Text style={styles.removeText}>Rimuovi</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {wheelSensors.length === 0 && (
          <Text style={styles.emptyText}>
            Nessun sensore registrato.{'\n'}
            Il sensore viene aggiunto automaticamente al primo collegamento.
          </Text>
        )}

        {/* Ultimo Crr */}
        {lastCrr && (
          <View style={styles.crrRow}>
            <Text style={styles.crrLabel}>Ultimo Crr misurato</Text>
            <Text style={styles.crrValue}>{lastCrr.crr.toFixed(4)}</Text>
            <Text style={styles.crrConf}>{lastCrr.confidence}% conf.</Text>
          </View>
        )}

        {/* Apribile anche senza sensore: mostra lo storico; i protocolli
            restano disabilitati finché il sensore non è connesso */}
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => setShowCrrCalib(true)}
        >
          <Text style={styles.primaryBtnText}>
            {wheelConnected ? 'Calibra Crr' : 'Calibrazione Crr (storico)'}
          </Text>
        </TouchableOpacity>
      </View>

      <CrrCalibrationScreen
        visible={showCrrCalib}
        onClose={() => setShowCrrCalib(false)}
        sendCommand={(cmd) => wheelSensorApi.sendCommand(cmd)}
      />

      {/* ── Sensori esterni (broker — contract v0.2.0 §2) ── */}
      <Text style={styles.sectionTitle}>Sensori esterni</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Potenza, velocità/cadenza e cardio si collegano SOLO al device
          AeroDrag (firmware): l'app autorizza i loro MAC scrivendo la whitelist
          sul firmware (0xaa0b) e i dati arrivano dal device. Su iOS il MAC del
          sensore non è leggibile dall'app — usa Android per il pairing.
        </Text>

        {sensorList.length === 0 ? (
          <Text style={styles.emptyText}>Nessun sensore autorizzato.</Text>
        ) : (
          sensorList.map((s) => (
            <View key={s.id} style={styles.sensorRow}>
              <View style={styles.sensorInfo}>
                <Text style={styles.sensorName}>{s.name}</Text>
                <Text style={styles.sensorType}>{SENSOR_TYPE_LABEL[s.type]} · {s.id}</Text>
              </View>
              <TouchableOpacity onPress={() => handleRemoveSensor(s.id)}>
                <Text style={styles.removeText}>Rimuovi</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <TouchableOpacity style={styles.btnPair} onPress={openSensorScan}>
          <Text style={styles.btnPairText}>+ Aggiungi sensore</Text>
        </TouchableOpacity>
        {sensorList.length > 0 && (
          <TouchableOpacity style={styles.dangerBtn} onPress={handleClearSensors}>
            <Text style={styles.dangerText}>Rimuovi tutti</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Modal scansione/aggiunta sensori esterni */}
      <Modal
        visible={showSensorScan}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeSensorScan}
      >
        <View style={styles.scanRoot}>
          <View style={styles.scanHeader}>
            <Text style={styles.scanTitle}>Aggiungi sensore</Text>
            <TouchableOpacity onPress={closeSensorScan}>
              <Text style={styles.closeBtn}>Chiudi</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.row}>
              {scanning && <ActivityIndicator color={Colors.teal} />}
              <Text style={styles.hint}>
                {scanning ? 'Ricerca sensori nelle vicinanze…' : 'Scansione terminata.'}
              </Text>
            </View>
            {discovered.length === 0 && !scanning && (
              <Text style={styles.emptyText}>Nessun sensore trovato.</Text>
            )}
            {discovered.map((s) => {
              const canAdd = Platform.OS === 'android';  // MAC disponibile solo su Android
              return (
                <View key={s.id} style={styles.sensorRow}>
                  <View style={styles.sensorInfo}>
                    <Text style={styles.sensorName}>{s.name}</Text>
                    <Text style={styles.sensorType}>{SENSOR_TYPE_LABEL[s.type]} · {s.id}</Text>
                  </View>
                  <TouchableOpacity onPress={() => canAdd && addDiscovered(s)} disabled={!canAdd}>
                    <Text style={[styles.btnPairText, !canAdd && { color: Colors.muted }]}>
                      {canAdd ? 'Autorizza' : 'MAC n/d (iOS)'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

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
          label="Circonferenza ruota (mm)"
          value={calib.tireCircM * 1000}
          step={1}
          min={1000}
          max={2500}
          decimals={0}
          onChange={(v) => setCalib({ tireCircM: v / 1000 })}
        />
        <View style={styles.presetRow}>
          {WHEEL_PRESETS.map((p) => {
            const active = Math.round(calib.tireCircM * 1000) === p.mm;
            return (
              <TouchableOpacity
                key={p.mm}
                style={[styles.presetChip, active && styles.presetChipActive]}
                onPress={() => setCalib({ tireCircM: p.mm / 1000 })}
              >
                <Text style={[styles.presetLabel, active && styles.presetLabelActive]}>
                  {p.label}
                </Text>
                <Text style={[styles.presetMm, active && styles.presetLabelActive]}>
                  {p.mm}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.hint}>
          La circonferenza è impostata dall'app ed è autorevole (contract
          v0.2.0): viene scritta sul device AeroDrag in CONFIG (0xaa08). Il
          valore sul device è solo default/echo e non viene più adottato
          dall'app alla connessione.
        </Text>
        <CalibRow
          label="Offset Pitot (Pa)"
          value={calib.pitotOffset}
          step={0.5}
          min={-10}
          max={10}
          onChange={(v) => setCalib({ pitotOffset: v })}
        />
        <Text style={styles.hint}>
          L'offset Pitot agisce solo sul calcolo locale di fallback (sim mode
          o firmware senza 0xaa09). La calibrazione zero-punto reale avviene
          sul device ESP32.
        </Text>
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

  subSectionLabel: {
    fontSize:      11,
    color:         Colors.muted,
    marginTop:     Sp.xs,
    marginBottom:  2,
  },
  wheelSensorRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: Sp.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  wheelSensorLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Sp.sm,
    flex:          1,
  },
  wheelSensorInfo: { gap: 2, flex: 1 },
  wheelSensorName: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  wheelSensorBike: { fontSize: 11, color: Colors.teal },
  radioOuter: {
    width:        18,
    height:       18,
    borderRadius: 9,
    borderWidth:  1.5,
    borderColor:  Colors.muted,
    alignItems:   'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.teal },
  radioInner: {
    width:           9,
    height:          9,
    borderRadius:    5,
    backgroundColor: Colors.teal,
  },
  radioAmber:      { borderColor: Colors.amber },
  radioInnerAmber: { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.amber },
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

  presetRow: { flexDirection: 'row', gap: Sp.sm },
  presetChip: {
    flex:            1,
    backgroundColor: Colors.s2,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    paddingVertical: Sp.xs,
    alignItems:      'center',
    gap:             1,
  },
  presetChipActive: {
    backgroundColor: Colors.tealBg,
    borderColor:     Colors.teal,
  },
  presetLabel:       { fontSize: 11, fontWeight: '600', color: Colors.muted },
  presetMm:          { fontSize: 10, color: Colors.muted, fontVariant: ['tabular-nums'] },
  presetLabelActive: { color: Colors.teal },

  scanRoot:   { flex: 1, backgroundColor: Colors.bg },
  scanHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Sp.md,
    paddingVertical:   Sp.sm,
    backgroundColor:   Colors.s1,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  scanTitle: { fontSize: 16, fontWeight: '700', color: Colors.textBright },
  closeBtn:  { fontSize: 14, color: Colors.teal },
});