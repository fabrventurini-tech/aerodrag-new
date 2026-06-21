import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, Switch, Modal, ActivityIndicator, Platform,
} from 'react-native';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import {
  loadPairedDevice, unpairDevice, loadSensorWhitelist,
  addSensorToWhitelist, removeSensorFromWhitelist, clearSensorWhitelist,
  PairedDevice, SensorEntry,
} from '../security/pairing';
import { QRPairScreen } from './QRPairScreen';
import { CrrCalibrationScreen } from './CrrCalibrationScreen';
import { bleApi } from '../hooks/useBLE';
import { DiscoveredSensor } from '../security/pairing';
import { Colors, Sp, Radius, Font, monoNum } from '../theme';

const SENSOR_TYPE_LABEL: Record<SensorEntry['type'], string> = {
  power: 'Potenza',
  csc:   'Velocità/Cadenza',
  hr:    'Cardio',
  wheel: 'Ruota (Crr)',
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
    bleStatus, discoveredSensors,
  } = useStore(useShallow((s) => ({
    calib: s.calib, setCalib: s.setCalib, isSimMode: s.isSimMode, setSimMode: s.setSimMode,
    setPairedDevice: s.setPairedDevice,
    wheelSensorStatus: s.wheelSensorStatus, wheelSensorId: s.wheelSensorId, crrCalib: s.crrCalib,
    bleStatus: s.bleStatus, discoveredSensors: s.discoveredSensors,
  })));

  const [pairedDevice, setPairedDevice]   = useState<PairedDevice | null>(null);
  const [sensorList, setSensorList]       = useState<SensorEntry[]>([]);
  const [showScanner, setShowScanner]     = useState(false);
  const [showCrrCalib, setShowCrrCalib]   = useState(false);
  // Pairing sensori esterni: discovery pilotata dal firmware (0xaa0e, v0.2.2)
  const [showSensorScan, setShowSensorScan] = useState(false);
  const [scanning, setScanning]             = useState(false);

  useEffect(() => {
    loadPairedDevice().then(setPairedDevice);
    loadSensorWhitelist().then(setSensorList);
  }, []);

  // ── Pairing sensori esterni — discovery via firmware (0xaa0e) ───────────────
  function openSensorScan() {
    setShowSensorScan(true);
    setScanning(true);
    bleApi.startSensorDiscovery();
    // Il firmware auto-stoppa ~15 s: rifletti lo stato in UI.
    setTimeout(() => setScanning(false), 15000);
  }

  function closeSensorScan() {
    bleApi.stopSensorDiscovery();
    setScanning(false);
    setShowSensorScan(false);
  }

  async function addDiscovered(s: DiscoveredSensor) {
    // Il MAC arriva dal firmware (reale, iOS+Android) → autorizzabile sempre.
    await addSensorToWhitelist({ id: s.mac, name: s.name, type: s.type });
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
          Il sensore ruota si collega SOLO al device AeroDrag (firmware): lo
          autorizzi in "Sensori esterni" e i dati di coast-down arrivano dal
          device (WHEEL_STREAM 0xaa0c). Lo stato qui sopra è "connesso" quando
          il device sta ricevendo lo stream del sensore ruota.
        </Text>

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
        sendCommand={(cmd) => bleApi.sendWheelCommand(cmd)}
      />

      {/* ── Sensori esterni (broker — contract v0.2.0 §2) ── */}
      <Text style={styles.sectionTitle}>Sensori esterni</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Potenza, velocità/cadenza, cardio e sensore ruota si collegano SOLO al
          device AeroDrag (firmware). La scansione la fa il device (vede i MAC
          reali) e l'app autorizza i MAC scelti scrivendoli nella whitelist del
          firmware (0xaa0b). Funziona su iOS e Android.
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

        <TouchableOpacity
          style={[styles.btnPair, bleStatus !== 'connected' && styles.btnDisabled]}
          onPress={openSensorScan}
          disabled={bleStatus !== 'connected'}
        >
          <Text style={styles.btnPairText}>
            {bleStatus === 'connected' ? '+ Aggiungi sensore' : 'Connetti il device per aggiungere'}
          </Text>
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
            <Text style={styles.hint}>
              La scansione la esegue il device AeroDrag (vede i MAC reali dei
              sensori) e invia all'app i candidati — funziona su iOS e Android.
            </Text>
            <View style={styles.row}>
              {scanning && <ActivityIndicator color={Colors.teal} />}
              <Text style={styles.hint}>
                {scanning ? 'Ricerca sensori in corso…' : 'Scansione terminata.'}
              </Text>
            </View>
            {discoveredSensors.length === 0 && !scanning && (
              <Text style={styles.emptyText}>Nessun sensore trovato.</Text>
            )}
            {discoveredSensors.map((s) => (
              <View key={s.mac} style={styles.sensorRow}>
                <View style={styles.sensorInfo}>
                  <Text style={styles.sensorName}>{s.name}</Text>
                  <Text style={styles.sensorType}>
                    {SENSOR_TYPE_LABEL[s.type]} · {s.mac} · {s.rssi} dBm
                  </Text>
                </View>
                <TouchableOpacity onPress={() => addDiscovered(s)}>
                  <Text style={styles.btnPairText}>Autorizza</Text>
                </TouchableOpacity>
              </View>
            ))}
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
  deviceId:   { fontSize: 11, color: Colors.muted, fontFamily: Font.mono },
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
  calibValue:    { ...monoNum, fontSize: 14, color: Colors.textBright, minWidth: 60, textAlign: 'center' },

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
  crrValue: { ...monoNum, fontSize: 18, color: Colors.teal },
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
  presetMm:          { ...monoNum, fontSize: 10, color: Colors.muted },
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