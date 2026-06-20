/**
 * useWheelSensor.ts
 * Hook React Native per connessione BLE al sensore ruota AeroDrag Wheel.
 *
 * Pairing NON esclusivo: il sensore è sempre accessibile da qualsiasi app BLE.
 * L'app si connette al sensore preferito (se impostato) oppure al primo
 * sensore AeroDrag Wheel visibile nella scan list.
 *
 * Servizi BLE esposti dal sensore (nRF52840 + ICM-42688-P):
 *
 *   CSC standard (0x1816) — compatibilità universale:
 *     0x2A5B  CSC Measurement   NOTIFY  → cumRevolutions(uint32) + lastEventTime(uint16)
 *     0x2A5C  CSC Feature       READ    → bit0=wheel rev, bit1=crank rev
 *     0x2A5D  Sensor Location   READ    → 5 (front wheel)
 *
 *   AeroDrag Wheel (0xBB00) — funzionalità avanzate:
 *     0xBB01  Stream            NOTIFY 10Hz → float32×4: speedMs, accelMs2, tempC, vibRMS
 *     0xBB02  Crr Result        NOTIFY on complete → float32 crr + uint8 quality + uint8 runIdx
 *     0xBB03  Command           WRITE → uint8 cmd (vedi CMD_* constants)
 *     0xBB04  Config            R/W   → float32 tireCircM + float32 massKg
 *     0xBB05  Device Info       READ  → ASCII "AeroDragWheel/1.0"
 *
 * Comandi (CMD_*):
 *   0x01 = start_indoor_run   (coach ha confermato vento < 0.2 m/s)
 *   0x02 = start_outdoor_A    (run direzione A — es. Nord)
 *   0x03 = start_outdoor_B    (run direzione B — es. Sud)
 *   0xFF = cancel_run
 *
 * Interoperabilità velocità:
 *   - Il profilo CSC (0x1816) usa cumulative wheel revolutions standard
 *   - qualsiasi ciclocomputer o app (Wahoo, Garmin, Strava) legge la velocità
 *   - La velocità in speedMs è derivata dallo stesso conteggio CSC
 *   - La circonferenza pneumatico si configura via BB04 (default 2105 mm per 700c×25)
 */

import { useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { bleManager } from '../ble/manager';
import { useStore } from '../store';
import {
  loadPreferredWheelSensor, saveWheelSensor, loadActiveWheelSensorId,
  setActiveWheelSensorId,
} from '../security/pairing';

// ── UUID ──────────────────────────────────────────────────────────────────────

const SVC_WHEEL    = '0000bb00-0000-1000-8000-00805f9b34fb';
const CHR_STREAM   = '0000bb01-0000-1000-8000-00805f9b34fb';
const CHR_CMD      = '0000bb03-0000-1000-8000-00805f9b34fb';
const CHR_CONFIG   = '0000bb04-0000-1000-8000-00805f9b34fb';

export const WHEEL_CMD = {
  START_INDOOR:    0x01,
  START_OUTDOOR_A: 0x02,
  START_OUTDOOR_B: 0x03,
  CANCEL:          0xff,
} as const;

// API a livello modulo: il hook (montato una sola volta in App.tsx) registra
// qui le funzioni reali, così gli screen (es. SettingsScreen) possono inviare
// comandi al sensore senza rimontare il hook BLE.
export const wheelSensorApi = {
  sendCommand:  async (_cmd: number): Promise<boolean> => false,
  writeConfig:  async (_tireCircM: number, _massKg: number): Promise<boolean> => false,
  setPreferred: (_id: string | null): void => {},
};

// ── Parsing pacchetti ─────────────────────────────────────────────────────────

function parseStream(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 16) return null;  // pacchetto troncato → scarta
  return {
    speedMs:  buf.readFloatLE(0),
    accelMs2: buf.readFloatLE(4),
    tempC:    buf.readFloatLE(8),
    vibRMS:   buf.readFloatLE(12),
  };
}

// ── Hook principale ───────────────────────────────────────────────────────────

export function useWheelSensor() {
  const deviceRef          = useRef<Device | null>(null);
  const subs               = useRef<Subscription[]>([]);
  const disconnectSub      = useRef<Subscription | null>(null);
  const preferredIdRef     = useRef<string | null>(null);
  const scanStartedRef     = useRef(false);
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    setWheelSensorStatus,
    setWheelSensorId,
    updateWheelStream,
    isSimMode,
    wheelSensorId,
  } = useStore();

  // Carica il sensore attivo (preferito) dallo storage al mount
  useEffect(() => {
    loadActiveWheelSensorId().then((id) => {
      if (id) {
        preferredIdRef.current = id;
      } else {
        // Fallback: prende il primo della lista se nessuno esplicitamente attivo
        loadPreferredWheelSensor().then((d) => {
          preferredIdRef.current = d?.id ?? null;
        });
      }
    });
  }, []);

  useEffect(() => {
    preferredIdRef.current = wheelSensorId;
  }, [wheelSensorId]);

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

  // ── Sottoscrizioni ─────────────────────────────────────────────────────────
  function subscribeAll(device: Device) {
    const sub = (chr: string, handler: (v: string) => void) => {
      const s = device.monitorCharacteristicForService(
        SVC_WHEEL, chr,
        (err: Error | null, c: { value?: string | null } | null) => { if (!err && c?.value) handler(c.value); }
      );
      subs.current.push(s);
    };

    sub(CHR_STREAM,  (v) => {
      const s = parseStream(v);
      if (s) updateWheelStream(s);
    });
    // 0xBB02 (CHR_CRR_RES): il firmware notifica un risultato Crr parziale, ma
    // l'app calcola il Crr in autonomia (fitCrrFromRun) — nessuna sottoscrizione
    // per non decodificare invano. Vedi onCrrRunComplete (no-op) nello store.
  }

  // ── Connessione ────────────────────────────────────────────────────────────
  async function connect(device: Device) {
    try {
      setWheelSensorStatus('connecting');
      const connected = await device.connect({ autoConnect: false });
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setWheelSensorId(device.id);
      setWheelSensorStatus('connected');
      subscribeAll(connected);

      // Cancella il fallback timeout: il device si è connesso prima degli 8s
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }

      // Sincronizza configurazione (circonferenza pneumatico e massa) col firmware.
      // Usa la massa del profilo atleta attivo se presente — coerente con l'ESP32.
      const st = useStore.getState();
      const activeProfile = st.athleteProfiles.find((p) => p.id === st.activeAthleteId);
      const massKg = (activeProfile?.massRiderKg ?? st.calib.massRiderKg)
                   + (activeProfile?.massBikeKg  ?? st.calib.massBikeKg);
      writeConfig(st.calib.tireCircM, massKg).catch(() => {});

      // Salva nella lista dei sensori noti e imposta come attivo
      // (operazione idempotente: aggiorna se già presente)
      const name = device.name ?? `AeroDrag Wheel ${device.id.slice(-5)}`;
      saveWheelSensor({ id: device.id, name, pairedAt: Date.now() });
      setActiveWheelSensorId(device.id);

      disconnectSub.current?.remove();
      disconnectSub.current = connected.onDisconnected(() => {
        cleanupSubs();
        deviceRef.current = null;
        setWheelSensorStatus('scanning');
        startScan();
      });
    } catch {
      setWheelSensorStatus('error');
    }
  }

  // ── Scan ───────────────────────────────────────────────────────────────────
  // Scansione NON esclusiva: accetta qualsiasi device con servizio BB00.
  // Se è impostato un preferred device lo connette per primo, ma non blocca
  // la connessione ad altri sensori se il preferito non è visibile.
  function startScan() {
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;
    setWheelSensorStatus('scanning');

    bleManager.startDeviceScan(
      [SVC_WHEEL],
      { allowDuplicates: false },
      (err: Error | null, device: Device | null) => {
        if (err) { setWheelSensorStatus('error'); return; }
        if (!device) return;

        const preferred = preferredIdRef.current;
        // Se c'è un preferito e questo NON è quello preferito, continuiamo a
        // scansionare per 5 secondi prima di accettare il primo disponibile.
        // Questo evita connessioni a sensori di altri atleti vicini quando
        // il sensore preferito è solo momentaneamente fuori portata.
        if (preferred && device.id !== preferred) return;

        bleManager.stopDeviceScan();
        scanStartedRef.current = false;
        connect(device);
      }
    );

    // Fallback: se il preferred non si trova in 8 secondi, accetta il primo disponibile
    if (preferredIdRef.current) {
      fallbackTimeoutRef.current = setTimeout(() => {
        fallbackTimeoutRef.current = null;
        if (!deviceRef.current && scanStartedRef.current) {
          // Rilancia scan senza filtro preferred
          bleManager.stopDeviceScan();
          scanStartedRef.current = false;
          startScanAny();
        }
      }, 8000);
    }
  }

  // Scan senza filtro preferred (fallback o primo accoppiamento)
  function startScanAny() {
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;

    bleManager.startDeviceScan(
      [SVC_WHEEL],
      { allowDuplicates: false },
      (err: Error | null, device: Device | null) => {
        if (err) { setWheelSensorStatus('error'); return; }
        if (!device) return;
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

  // ── API pubblica — invia comando al sensore ────────────────────────────────
  async function sendCommand(cmd: number): Promise<boolean> {
    if (!deviceRef.current) return false;
    try {
      const buf = Buffer.alloc(1);
      buf.writeUInt8(cmd, 0);
      await deviceRef.current.writeCharacteristicWithResponseForService(
        SVC_WHEEL, CHR_CMD, buf.toString('base64')
      );
      return true;
    } catch {
      return false;
    }
  }

  async function writeConfig(tireCircM: number, massKg: number): Promise<boolean> {
    if (!deviceRef.current) return false;
    try {
      const buf = Buffer.alloc(8);
      buf.writeFloatLE(tireCircM, 0);
      buf.writeFloatLE(massKg, 4);
      await deviceRef.current.writeCharacteristicWithResponseForService(
        SVC_WHEEL, CHR_CONFIG, buf.toString('base64')
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Simulazione ────────────────────────────────────────────────────────────
  function startSimulation() {
    setWheelSensorStatus('connected');
    setWheelSensorId('SIM:00:00:00:00:01');
    let t = 0;
    const interval = setInterval(() => {
      t += 0.1;
      const speed = Math.max(0, 8.3 - t * 0.08 + Math.random() * 0.05) as number;
      const decel = speed > 0.5 ? -(0.004 * 9.81 + 0.00015 * speed * speed) + (Math.random() - 0.5) * 0.01 : 0;
      updateWheelStream({
        speedMs:  speed,
        accelMs2: decel,
        tempC:    22 + Math.sin(t * 0.05),
        vibRMS:   0.15 + Math.random() * 0.05,
      });
    }, 100);
    return () => clearInterval(interval);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isSimMode) {
      const cleanup = startSimulation();
      return cleanup;
    }

    const sub = bleManager.onStateChange((state: string) => {
      if (state === 'PoweredOn') {
        sub.remove();
        requestPermissions().then((ok) => {
          if (ok) startScan();
          else setWheelSensorStatus('error');
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
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      scanStartedRef.current = false;
    };
  }, [isSimMode]);

  // Registra le funzioni reali nell'API a livello modulo (per gli screen).
  // In un useEffect per non riassegnare ad ogni render (#19).
  useEffect(() => {
    wheelSensorApi.sendCommand  = sendCommand;
    wheelSensorApi.writeConfig  = writeConfig;
    wheelSensorApi.setPreferred = (id) => { preferredIdRef.current = id; };
  });

  return { sendCommand, writeConfig };
}
