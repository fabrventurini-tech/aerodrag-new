/**
 * useCadenceSensor.ts
 * Hook BLE per sensore di cadenza pedalata.
 *
 * Compatibile con qualsiasi sensore BLE CSC (0x1816) che supporti Crank
 * Revolution Data (bit1 di CSC Feature 0x2A5C):
 *   - AeroDrag Cadence Sensor (0xCC00 + 0x1816)
 *   - Wahoo RPM Cadence, Garmin Cadence, 4iiii, Polar, Stages, ecc.
 *
 * Protocollo CSC Measurement (0x2A5B):
 *   Byte 0:     Flags — bit0=WheelRevPresent, bit1=CrankRevPresent
 *   [se bit0]:  CumWheelRevs(u32) + LastWheelEventTime(u16)
 *   [se bit1]:  CumCrankRevs(u16) + LastCrankEventTime(u16, 1/1024 s)
 *
 * Calcolo cadenza:
 *   cadenceRpm = (deltaCrankRevs × 1024 × 60) / deltaEventTime
 *   Timeout 3 s senza nuovi eventi → cadenceRpm = 0 (atleta fermo)
 *
 * Anti-conflitto con sensore ruota:
 *   Dopo la connessione, verifica CSC Feature (0x2A5C) bit1.
 *   Se il device supporta solo ruota (bit0 set, bit1 unset) → disconnette
 *   e continua la scansione evitando quel device.
 */

import { useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { bleManager } from '../ble/manager';
import { useStore } from '../store';
import {
  loadPreferredCadenceSensor,
  saveCadenceSensor,
  loadActiveCadenceSensorId,
  setActiveCadenceSensorId,
} from '../security/pairing';

// ── UUID ──────────────────────────────────────────────────────────────────────

const SVC_CSC      = '00001816-0000-1000-8000-00805f9b34fb';
const CHR_CSC_MEAS = '00002a5b-0000-1000-8000-00805f9b34fb';
const CHR_CSC_FEAT = '00002a5c-0000-1000-8000-00805f9b34fb';

// API a livello modulo (vedi wheelSensorApi): permette agli screen di
// aggiornare il sensore preferito senza rimontare il hook BLE.
export const cadenceSensorApi = {
  setPreferred: (_id: string | null): void => {},
};

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseCscCrank(b64: string): { cumCrankRevs: number; lastCrankEventTime: number } | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 1) return null;
    const flags = buf.readUInt8(0);
    if (!(flags & 0x02)) return null;      // bit1 = Crank Revolution Data Present
    let offset = 1;
    if (flags & 0x01) offset += 6;         // salta wheel rev data (uint32 + uint16)
    if (buf.length < offset + 4) return null;
    return {
      cumCrankRevs:       buf.readUInt16LE(offset),
      lastCrankEventTime: buf.readUInt16LE(offset + 2),
    };
  } catch {
    return null;
  }
}

function readCscFeatureCrank(b64: string): boolean {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 1) return false;
    return (buf.readUInt8(0) & 0x02) !== 0;  // bit1 = Crank Revolution Supported
  } catch {
    return false;
  }
}

// ── Hook principale ───────────────────────────────────────────────────────────

export function useCadenceSensor() {
  const deviceRef          = useRef<Device | null>(null);
  const subs               = useRef<Subscription[]>([]);
  const disconnectSub      = useRef<Subscription | null>(null);
  const preferredIdRef     = useRef<string | null>(null);
  const wheelSensorIdRef   = useRef<string | null>(null);
  const scanStartedRef     = useRef(false);
  const rejectedIdsRef     = useRef<Set<string>>(new Set());
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stato cadenza (refs per closure nei callback BLE)
  const prevCrankRevRef    = useRef(-1);
  const prevCrankTimeRef   = useRef(0);
  const cadenceTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    setCadenceSensorStatus,
    setCadenceSensorId,
    updateSensors,
    isSimMode,
    cadenceSensorId,
    wheelSensorId,
  } = useStore();

  // Carica ID preferito dallo storage al mount
  useEffect(() => {
    loadActiveCadenceSensorId().then((id) => {
      if (id) {
        preferredIdRef.current = id;
      } else {
        loadPreferredCadenceSensor().then((d) => {
          preferredIdRef.current = d?.id ?? null;
        });
      }
    });
  }, []);

  // Sync refs per usare i valori aggiornati nei callback BLE
  useEffect(() => { preferredIdRef.current   = cadenceSensorId; }, [cadenceSensorId]);
  useEffect(() => { wheelSensorIdRef.current = wheelSensorId;   }, [wheelSensorId]);

  // Registra il setter nell'API a livello modulo (per SettingsScreen).
  // In un useEffect per non riassegnare ad ogni render (#19).
  useEffect(() => {
    cadenceSensorApi.setPreferred = (id) => { preferredIdRef.current = id; };
  });

  // ── Permessi ───────────────────────────────────────────────────────────────
  async function requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (Platform.Version >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(results).every(
        (r) => r === PermissionsAndroid.RESULTS.GRANTED
      );
    }
    const r = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return r === PermissionsAndroid.RESULTS.GRANTED;
  }

  // ── Calcolo cadenza da dati CSC ────────────────────────────────────────────
  function processCrankData(cumRevs: number, eventTime: number) {
    // Watchdog: riarma ad OGNI notifica ricevuta (anche senza nuova rivoluzione),
    // così 3 s di silenzio totale del sensore azzerano la cadenza (#3).
    if (cadenceTimeoutRef.current) clearTimeout(cadenceTimeoutRef.current);
    cadenceTimeoutRef.current = setTimeout(() => {
      updateSensors({ cadenceRpm: 0 });
    }, 3000);

    if (prevCrankRevRef.current < 0) {
      // Prima lettura: salva stato senza calcolare
      prevCrankRevRef.current  = cumRevs;
      prevCrankTimeRef.current = eventTime;
      return;
    }

    // Gestione overflow uint16 (65536 → 0)
    const deltaRevs = (cumRevs  - prevCrankRevRef.current  + 65536) % 65536;
    const deltaTime = (eventTime - prevCrankTimeRef.current + 65536) % 65536;

    prevCrankRevRef.current  = cumRevs;
    prevCrankTimeRef.current = eventTime;

    if (deltaTime === 0 || deltaRevs === 0) return; // stesso evento, nessuna nuova rivoluzione

    // deltaTime è in unità di 1/1024 s → cadence = (rev/s) × 60
    const cadenceRpm = Math.min(Math.round((deltaRevs * 1024 * 60) / deltaTime), 250);

    updateSensors({ cadenceRpm });
  }

  // ── Sottoscrizioni ─────────────────────────────────────────────────────────
  function subscribeAll(device: Device) {
    const sub = device.monitorCharacteristicForService(
      SVC_CSC, CHR_CSC_MEAS,
      (err: Error | null, c: { value?: string | null } | null) => {
        if (err || !c?.value) return;
        const parsed = parseCscCrank(c.value);
        if (parsed) processCrankData(parsed.cumCrankRevs, parsed.lastCrankEventTime);
      }
    );
    subs.current.push(sub);
  }

  // ── Connessione ────────────────────────────────────────────────────────────
  async function connect(device: Device) {
    try {
      setCadenceSensorStatus('connecting');
      const connected = await device.connect({ autoConnect: false });
      await connected.discoverAllServicesAndCharacteristics();

      // Verifica che il device supporti Crank Revolution (CSC Feature bit1)
      try {
        const feat = await connected.readCharacteristicForService(SVC_CSC, CHR_CSC_FEAT);
        if (!feat.value || !readCscFeatureCrank(feat.value)) {
          // Device CSC senza cadenza (es. sensore velocità puro) → skip
          await connected.cancelConnection();
          rejectedIdsRef.current.add(device.id);
          setCadenceSensorStatus('scanning');
          startScanAny();
          return;
        }
      } catch {
        // Dispositivi legacy che non espongono CSC Feature: assume supporto crank
      }

      deviceRef.current = connected;
      setCadenceSensorId(device.id);
      setCadenceSensorStatus('connected');
      prevCrankRevRef.current = -1; // reset stato cadenza

      // Cancella il fallback timeout: connesso prima degli 8s
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }

      subscribeAll(connected);

      const name = device.name ?? `Cadence ${device.id.slice(-5)}`;
      saveCadenceSensor({ id: device.id, name, pairedAt: Date.now() });
      setActiveCadenceSensorId(device.id);

      disconnectSub.current?.remove();
      disconnectSub.current = connected.onDisconnected(() => {
        cleanupSubs();
        deviceRef.current = null;
        if (cadenceTimeoutRef.current) clearTimeout(cadenceTimeoutRef.current);
        updateSensors({ cadenceRpm: 0 });
        setCadenceSensorStatus('scanning');
        startScan();
      });
    } catch {
      setCadenceSensorStatus('error');
    }
  }

  // ── Scan (preferito prima) ─────────────────────────────────────────────────
  function startScan() {
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;
    setCadenceSensorStatus('scanning');

    bleManager.startDeviceScan(
      [SVC_CSC],
      { allowDuplicates: false },
      (err: Error | null, device: Device | null) => {
        if (err) { setCadenceSensorStatus('error'); return; }
        if (!device) return;

        const preferred = preferredIdRef.current;
        if (preferred && device.id !== preferred) return;

        // Evita di agganciarsi al sensore ruota Crr (gestito da useWheelSensor)
        if (device.id === wheelSensorIdRef.current) return;
        if (rejectedIdsRef.current.has(device.id)) return;

        bleManager.stopDeviceScan();
        scanStartedRef.current = false;
        connect(device);
      }
    );

    // Fallback: se il preferito non risponde in 8 s, accetta qualsiasi CSC
    if (preferredIdRef.current) {
      fallbackTimeoutRef.current = setTimeout(() => {
        fallbackTimeoutRef.current = null;
        if (!deviceRef.current && scanStartedRef.current) {
          bleManager.stopDeviceScan();
          scanStartedRef.current = false;
          startScanAny();
        }
      }, 8000);
    }
  }

  // Scan senza filtro preferred (fallback / primo accoppiamento)
  function startScanAny() {
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;

    bleManager.startDeviceScan(
      [SVC_CSC],
      { allowDuplicates: false },
      (err: Error | null, device: Device | null) => {
        if (err) { setCadenceSensorStatus('error'); return; }
        if (!device) return;
        if (device.id === wheelSensorIdRef.current) return;
        if (rejectedIdsRef.current.has(device.id)) return;
        bleManager.stopDeviceScan();
        scanStartedRef.current = false;
        connect(device);
      }
    );
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  function cleanupSubs() {
    subs.current.forEach((s) => s.remove());
    subs.current = [];
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isSimMode) return; // la simulazione è gestita in useBLE (cadenceRpm sintetica)

    const sub = bleManager.onStateChange((state: string) => {
      if (state === 'PoweredOn') {
        sub.remove();
        requestPermissions().then((ok) => {
          if (ok) startScan();
          else setCadenceSensorStatus('error');
        });
      }
    }, true);

    return () => {
      // NB: il BleManager è condiviso (src/ble/manager.ts) — NON va distrutto qui.
      sub.remove();
      bleManager.stopDeviceScan();
      cleanupSubs();
      disconnectSub.current?.remove();
      disconnectSub.current = null;
      if (cadenceTimeoutRef.current) clearTimeout(cadenceTimeoutRef.current);
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      scanStartedRef.current = false;
    };
  }, [isSimMode]);
}
