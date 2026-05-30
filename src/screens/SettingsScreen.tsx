import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, Switch, ActivityIndicator,
} from 'react-native';
import { useStore, DiscoveredDevice } from '../store';
import {
  loadPairedDevice, loadPairedWheel, loadPairedHR,
  savePairedWheel, savePairedHR, unpairDevice, unpairWheel, unpairHR,
  loadSensorWhitelist, removeSensorFromWhitelist, clearSensorWhitelist,
  PairedDevice, SensorEntry, HRDeviceType,
} from '../security/pairing';
import { QRPairScreen } from './QRPairScreen';
import { Colors, Sp, Radius } from '../theme';

export function SettingsScreen() {
  const {
    calib, setCalib, isSimMode, setSimMode,
    setPairedDevice: setStorePairedDevice,
    setPairedWheel:  setStorePairedWheel,
    setPairedHR:     setStorePairedHR,
    isDiscovering, discoveryTarget, discoveredDevices,
    startDiscovery, stopDiscovery,
  } = useStore();

  const [pairedDevice, setPairedDevice]   = useState<PairedDevice | null>(null);
  const [pairedWheel,  setPairedWheel]    = useState<PairedDevice | null>(null);
  const [pairedHR,     setPairedHR]       = useState<{ device: PairedDevice; hrType: HRDeviceType } | null>(null);
  const [sensorList,   setSensorList]     = useState<SensorEntry[]>([]);
  const [showScanner,  setShowScanner]    = useState(false);

  useEffect(() => {
    Promise.all([
      loadPairedDevice(),
      loadPairedWheel(),
      loadPairedHR(),
      loadSensorWhitelist(),
    ]).then(([main, wheel, hr, sensors]) => {
      setPairedDevice(main);
      setPairedWheel(wheel);
      setPairedHR(hr);
      setSensorList(sensors);
    });
  }, []);

  // Ferma la discovery quando l'utente lascia la schermata
  useEffect(() => () => { stopDiscovery(); }, []);

  // ── Pairing device principale ──────────────────────────────────────────────

  async function handleUnpair() {
    Alert.alert('Disaccoppia device', 'Rimuovere il pairing con il device AeroDrag?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Disaccoppia', style: 'destructive',
        onPress: async () => {
          await unpairDevice();
          setPairedDevice(null);
          setStorePairedDevice(null);
        },
      },
    ]);
  }

  // ── Pairing sensore ruota ──────────────────────────────────────────────────

  async function handlePairWheel(discovered: DiscoveredDevice) {
    const device: PairedDevice = {
      id:       discovered.id,
      name:     discovered.name ?? 'AeroDrag-Wheel',
      pairedAt: Date.now(),
    };
    await savePairedWheel(device);
    setPairedWheel(device);
    setStorePairedWheel(device.id);
    stopDiscovery();
  }

  async function handleUnpairWheel() {
    Alert.alert('Disaccoppia sensore ruota', 'Rimuovere il pairing con il sensore ruota?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Disaccoppia', style: 'destructive',
        onPress: async () => {
          await unpairWheel();
          setPairedWheel(null);
          setStorePairedWheel(null);
          stopDiscovery();
        },
      },
    ]);
  }

  // ── Pairing fascia HR ──────────────────────────────────────────────────────

  async function handlePairHR(discovered: DiscoveredDevice) {
    const hrType: HRDeviceType = discovered.hrType === 'aerodrag' ? 'aerodrag' : 'standard';
    const device: PairedDevice = {
      id:       discovered.id,
      name:     discovered.name ?? (hrType === 'aerodrag' ? 'AeroDrag-HR' : 'Monitor HR'),
      pairedAt: Date.now(),
    };
    await savePairedHR(device, hrType);
    setPairedHR({ device, hrType });
    setStorePairedHR(device.id, hrType);
    stopDiscovery();
  }

  async function handleUnpairHR() {
    Alert.alert('Disaccoppia fascia HR', 'Rimuovere il pairing con la fascia HR?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Disaccoppia', style: 'destructive',
        onPress: async () => {
          await unpairHR();
          setPairedHR(null);
          setStorePairedHR(null);
          stopDiscovery();
        },
      },
    ]);
  }

  // ── Sensori legacy ─────────────────────────────────────────────────────────

  async function handleRemoveSensor(id: string) {
    await removeSensorFromWhitelist(id);
    setSensorList(await loadSensorWhitelist());
  }

  async function handleClearSensors() {
    await clearSensorWhitelist();
    setSensorList([]);
  }

  const isDiscoveringWheel = isDiscovering && discoveryTarget === 'wheel';
  const isDiscoveringHR    = isDiscovering && discoveryTarget === 'hr';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Device AeroDrag principale ── */}
      <Text style={styles.sectionTitle}>Device AeroDrag principale</Text>
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
            <Text style={styles.hint}>Scansiona il QR code sul device AeroDrag.</Text>
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

      {/* ── Sensore IMU mozzo (AeroDrag-Wheel) ── */}
      <Text style={styles.sectionTitle}>Sensore ruota (Crr + velocità)</Text>
      <View style={styles.card}>
        {pairedWheel ? (
          <>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: Colors.blue }]} />
              <Text style={styles.deviceName}>{pairedWheel.name}</Text>
            </View>
            <Text style={styles.deviceId}>{pairedWheel.id}</Text>
            <Text style={styles.deviceDate}>
              Accoppiato il {new Date(pairedWheel.pairedAt).toLocaleDateString('it-IT')}
            </Text>
            <TouchableOpacity style={styles.dangerBtn} onPress={handleUnpairWheel}>
              <Text style={styles.dangerText}>Disaccoppia</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.emptyText}>Nessun sensore ruota accoppiato</Text>
            <Text style={styles.hint}>
              IMU 9 DoF sul mozzo anteriore. Abilita misura Crr e qualità asfalto.
            </Text>
          </>
        )}

        {isDiscoveringWheel ? (
          <>
            <View style={styles.discoveringRow}>
              <ActivityIndicator size="small" color={Colors.blue} />
              <Text style={styles.discoveringText}>Ricerca in corso…</Text>
            </View>
            {discoveredDevices.map(d => (
              <TouchableOpacity
                key={d.id}
                style={styles.discoveredItem}
                onPress={() => handlePairWheel(d)}
              >
                <View>
                  <Text style={styles.discoveredName}>{d.name ?? d.id}</Text>
                  <Text style={styles.discoveredId}>{d.id}</Text>
                </View>
                <Text style={styles.rssi}>{d.rssi} dBm</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.btnPairSecondary} onPress={stopDiscovery}>
              <Text style={[styles.btnPairText, { color: Colors.muted }]}>Annulla ricerca</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.btnPair, { borderColor: Colors.blue, backgroundColor: Colors.blueBg }]}
            onPress={() => startDiscovery('wheel')}
          >
            <Text style={[styles.btnPairText, { color: Colors.blue }]}>
              {pairedWheel ? 'Sostituisci sensore ruota' : 'Cerca sensore ruota'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Fascia HR+IMU ── */}
      <Text style={styles.sectionTitle}>Fascia HR (cardiaca + tronco)</Text>
      <View style={styles.card}>
        {pairedHR ? (
          <>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: Colors.red }]} />
              <Text style={styles.deviceName}>{pairedHR.device.name}</Text>
              <View style={[styles.typeBadge, {
                backgroundColor: pairedHR.hrType === 'aerodrag' ? Colors.tealBg : Colors.amberBg,
                borderColor:     pairedHR.hrType === 'aerodrag' ? Colors.teal   : Colors.amber,
              }]}>
                <Text style={[styles.typeBadgeText, {
                  color: pairedHR.hrType === 'aerodrag' ? Colors.teal : Colors.amber,
                }]}>
                  {pairedHR.hrType === 'aerodrag' ? 'AeroDrag' : 'Standard BLE'}
                </Text>
              </View>
            </View>
            <Text style={styles.deviceId}>{pairedHR.device.id}</Text>
            <Text style={styles.deviceDate}>
              Accoppiato il {new Date(pairedHR.device.pairedAt).toLocaleDateString('it-IT')}
            </Text>
            {pairedHR.hrType === 'aerodrag' && (
              <Text style={styles.hint}>
                HR + HRV + angolo tronco + oscillazione + temperatura cutanea
              </Text>
            )}
            {pairedHR.hrType === 'standard' && (
              <Text style={styles.hint}>
                HR + HRV. Compatibile con Garmin, Wahoo, Polar e qualsiasi monitor standard.
              </Text>
            )}
            <TouchableOpacity style={styles.dangerBtn} onPress={handleUnpairHR}>
              <Text style={styles.dangerText}>Disaccoppia</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.emptyText}>Nessuna fascia HR accoppiata</Text>
            <Text style={styles.hint}>
              Compatibile con fascia AeroDrag-HR (HR+IMU) e qualsiasi monitor cardiaco
              con BLE Heart Rate Service standard (Garmin HRM-Pro, Wahoo TICKR, Polar H10…).
            </Text>
          </>
        )}

        {isDiscoveringHR ? (
          <>
            <View style={styles.discoveringRow}>
              <ActivityIndicator size="small" color={Colors.red} />
              <Text style={styles.discoveringText}>Ricerca in corso…</Text>
            </View>
            {discoveredDevices.map(d => (
              <TouchableOpacity
                key={d.id}
                style={styles.discoveredItem}
                onPress={() => handlePairHR(d)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.discoveredName}>{d.name ?? d.id}</Text>
                  <Text style={styles.discoveredId}>{d.id}</Text>
                </View>
                <View style={[styles.typeBadge, {
                  backgroundColor: d.hrType === 'aerodrag' ? Colors.tealBg : Colors.amberBg,
                  borderColor:     d.hrType === 'aerodrag' ? Colors.teal   : Colors.amber,
                }]}>
                  <Text style={[styles.typeBadgeText, {
                    color: d.hrType === 'aerodrag' ? Colors.teal : Colors.amber,
                  }]}>
                    {d.hrType === 'aerodrag' ? 'AeroDrag' : 'Standard'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.btnPairSecondary} onPress={stopDiscovery}>
              <Text style={[styles.btnPairText, { color: Colors.muted }]}>Annulla ricerca</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.btnPair, { borderColor: Colors.red, backgroundColor: Colors.redBg }]}
            onPress={() => startDiscovery('hr')}
          >
            <Text style={[styles.btnPairText, { color: Colors.red }]}>
              {pairedHR ? 'Sostituisci fascia HR' : 'Cerca fascia HR'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Sensori BLE accoppiati (legacy ANT+ bridge) ── */}
      <Text style={styles.sectionTitle}>Sensori ANT+ (power meter, CSC)</Text>
      <View style={styles.card}>
        {sensorList.length === 0 ? (
          <Text style={styles.emptyText}>
            Nessun sensore salvato.{'\n'}
            I sensori vengono aggiunti automaticamente al primo collegamento.
          </Text>
        ) : (
          <>
            {sensorList.map(s => (
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
              <Text style={styles.dangerText}>Rimuovi tutti</Text>
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
          step={0.5} min={30} max={130}
          onChange={v => setCalib({ massRiderKg: v })}
        />
        <CalibRow
          label="Massa bici (kg)"
          value={calib.massBikeKg}
          step={0.5} min={3} max={30}
          onChange={v => setCalib({ massBikeKg: v })}
        />
        <CalibRow
          label="CRR"
          value={calib.crr}
          step={0.0005} min={0.001} max={0.015} decimals={4}
          onChange={v => setCalib({ crr: v })}
        />
        <CalibRow
          label="Offset Pitot (Pa)"
          value={calib.pitotOffset}
          step={0.5} min={-10} max={10}
          onChange={v => setCalib({ pitotOffset: v })}
        />
      </View>

      {/* ── Modalità simulazione ── */}
      <Text style={styles.sectionTitle}>Sviluppo</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.switchLabel}>Modalità simulazione</Text>
            <Text style={styles.switchHint}>Genera dati sintetici per tutti e 3 i device</Text>
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
  deviceName: { fontSize: 16, fontWeight: '600', color: Colors.textBright, flex: 1 },
  deviceId:   { fontSize: 11, color: Colors.muted, fontFamily: 'monospace' },
  deviceDate: { fontSize: 11, color: Colors.muted },

  typeBadge: {
    borderRadius:      6,
    borderWidth:       0.5,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  typeBadgeText: { fontSize: 10, fontWeight: '600' },

  emptyText: { fontSize: 13, color: Colors.muted, lineHeight: 20 },
  hint:      { fontSize: 11, color: Colors.muted, fontStyle: 'italic', lineHeight: 16 },

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
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.sm,
    alignItems:      'center',
    marginTop:       Sp.xs,
  },
  btnPairText: { color: Colors.teal, fontWeight: '600', fontSize: 13 },

  discoveringRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Sp.sm,
    paddingVertical: Sp.xs,
  },
  discoveringText: { fontSize: 13, color: Colors.muted },

  discoveredItem: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   Colors.s2,
    borderRadius:      Radius.sm,
    borderWidth:       0.5,
    borderColor:       Colors.border,
    padding:           Sp.sm,
  },
  discoveredName: { fontSize: 13, color: Colors.textBright, fontWeight: '500' },
  discoveredId:   { fontSize: 10, color: Colors.muted, fontFamily: 'monospace' },
  rssi:           { fontSize: 11, color: Colors.muted },

  sensorRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingVertical:   Sp.xs,
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
  calibBtnText: { fontSize: 18, color: Colors.text, lineHeight: 22 },
  calibValue:   { fontSize: 14, color: Colors.textBright, minWidth: 60, textAlign: 'center', fontVariant: ['tabular-nums'] },

  switchRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  switchLabel: { fontSize: 13, color: Colors.text },
  switchHint:  { fontSize: 11, color: Colors.muted },
});
