/**
 * useBLE.ts
 * Hook React Native per connessione BLE al device AeroDrag.
 *
 * UUID servizi/caratteristiche (firmware ESP32 "AeroDrag Pro", commit a972c56):
 *   Servizio principale: 0000aa00-0000-1000-8000-00805f9b34fb
 *   0xaa01 PITOT    R+NOTIFY 10 Hz   8 B:  float pitot_pa + float static_pa (static fissa 101325)
 *   0xaa02 IMU      R+NOTIFY 10 Hz   8 B:  float pitch_deg + float roll_deg
 *   0xaa03 ENV      R+NOTIFY 1 Hz   16 B:  float temp_c, humidity_pct, altitude_m, speed_ms
 *   0xaa04 ANT      R+NOTIFY         4 B:  uint16 power_w + uint8 cad + uint8 hr
 *          ⚠ la NOTIFY arriva SOLO come sentinella LAP (power=0xFFFF, cad=0, hr=0);
 *            i dati reali power/cad/hr si ottengono con READ periodiche (poll 1 Hz)
 *   0xaa05 IDENTITY R (50 B) + W     WRITE: nome atleta 1-31 byte ASCII (NVS)
 *   0xaa06 VERSION  R                stringa "1.0.0 (...)" NUL-terminated
 *   0xaa07 OTA_URL  W                URL http del .bin (1-199 B) → avvia OTA
 *   0xaa08 CONFIG   R+W             12 B:  float mass_kg + float crr + float wheel_circ_m
 *          range firmware: mass ∈ [33,200], crr ∈ [0.001,0.025], wheel ∈ [1.0,2.5]
 *          fuori range → errore ATT e nessun campo scritto (clampare prima!)
 *   0xaa09 PHYSICS  NOTIFY 10 Hz    28 B:  float×7 cda, vAir, rho, pctAero(0-1), pAero, pRoll, pGrav
 *          tutti 0 se misura non valida
 *   0xaa0a BATTERY  NOTIFY 0.1 Hz    1 B:  uint8 pct 0-100
 *
 * Note:
 *   - Tutti i multi-byte little-endian; float IEEE-754 32 bit raw.
 *   - MTU: PHYSICS (28 B) richiede MTU ≥ 31, READ IDENTITY (50 B) MTU ≥ 53.
 *     Si negozia requestMTU 185 alla connect (Android; iOS automatico).
 *   - 0xaa08 letto on-connect (la circonferenza ruota è del device) e scritto
 *     on-connect + ad ogni cambio massa/Crr in app (i profili guidano massa/Crr).
 *   - 0xaa09 è la sorgente di verità del CdA — l'ESP32 calcola in autonomia;
 *     il calcolo locale in engine.ts resta solo per sim mode / firmware vecchio.
 */

import { useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { useStore } from '../store';
import { PhysicsOutput } from '../physics/engine';

// ── UUID ──────────────────────────────────────────────────────────────────────
const SVC          = '0000aa00-0000-1000-8000-00805f9b34fb';
const CHR_PITOT    = '0000aa01-0000-1000-8000-00805f9b34fb';
const CHR_IMU      = '0000aa02-0000-1000-8000-00805f9b34fb';
const CHR_ENV      = '0000aa03-0000-1000-8000-00805f9b34fb';
const CHR_SENSORS  = '0000aa04-0000-1000-8000-00805f9b34fb';
const CHR_IDENTITY = '0000aa05-0000-1000-8000-00805f9b34fb';
const CHR_CONFIG   = '0000aa08-0000-1000-8000-00805f9b34fb';
const CHR_PHYSICS  = '0000aa09-0000-1000-8000-00805f9b34fb';
const CHR_BATTERY  = '0000aa0a-0000-1000-8000-00805f9b34fb';

// ── Parsing pacchetti BLE ─────────────────────────────────────────────────────

// Tutti i parser scartano i pacchetti troncati (return null): un RangeError
// dentro il callback BLE farebbe crashare l'app.

function parsePitot(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 8) return null;
  return {
    pitotPa:  buf.readFloatLE(0),
    staticPa: buf.readFloatLE(4),
  };
}

function parseIMU(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 8) return null;
  return {
    pitchDeg: buf.readFloatLE(0),
    rollDeg:  buf.readFloatLE(4),
  };
}

function parseEnv(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 16) return null;
  return {
    tempC:    buf.readFloatLE(0),
    humidity: buf.readFloatLE(4) / 100,  // firmware sends 0-100
    altM:     buf.readFloatLE(8),
    speedMs:  buf.readFloatLE(12),        // firmware sends float m/s at offset 12
  };
}

function parseSensors(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  // firmware CHR_ANT = power(2) + cad(1) + hr(1) = 4 bytes; speed is NOT here
  if (buf.length < 4) return null;
  return {
    powerW:     buf.readUInt16LE(0),
    cadenceRpm: buf.readUInt8(2),
    hrBpm:      buf.readUInt8(3),
  };
}

function parsePhysics(b64: string): PhysicsOutput | null {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 28) return null;
  const cda    = buf.readFloatLE(0);
  const vAirMs = buf.readFloatLE(4);
  return {
    cda,
    vAirMs,
    rhoKgM3:   buf.readFloatLE(8),
    pctAero:   buf.readFloatLE(12) * 100,  // firmware invia 0.0-1.0, app usa 0-100
    pAeroW:    buf.readFloatLE(16),
    pRollingW: buf.readFloatLE(20),
    pGravityW: buf.readFloatLE(24),
    valid:     cda > 0.01 && vAirMs > 0.5,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ── Hook principale ───────────────────────────────────────────────────────────

export function useBLE() {
  const manager        = useRef<BleManager | null>(null);
  const deviceRef      = useRef<Device | null>(null);
  const tickRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const antPollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const subs           = useRef<Subscription[]>([]);
  const disconnectSub  = useRef<Subscription | null>(null);
  const pairedIdRef    = useRef<string | null>(null);

  const {
    setBleStatus, setBattery, updateSensors, setPhysicsFromDevice,
    tick, isSimMode, pairedDeviceId,
    activeAthleteId, athleteProfiles,
  } = useStore();

  // Sync ref → leggi sempre il valore corrente nello scan callback
  useEffect(() => { pairedIdRef.current = pairedDeviceId; }, [pairedDeviceId]);

  // Re-scrive il nome atleta su CHR_IDENTITY quando i profili sono caricati dopo
  // la connessione BLE (risolve il race condition tra connect() e loadAthleteProfiles())
  useEffect(() => {
    if (!deviceRef.current) return;
    const profile = athleteProfiles.find((p) => p.id === activeAthleteId);
    if (!profile?.name) return;
    // Troncamento per byte: nomi con accenti (es. "Niccolò") superano
    // i 31 byte anche sotto i 31 caratteri
    const nameBytes = Buffer.from(profile.name, 'utf8').slice(0, 31);
    deviceRef.current.writeCharacteristicWithResponseForService(
      SVC, CHR_IDENTITY, nameBytes.toString('base64')
    ).catch(() => {});
  }, [activeAthleteId, athleteProfiles]);

  // ── Permessi Android ───────────────────────────────────────────────────────
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
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  // ── Sottoscrizione caratteristiche ─────────────────────────────────────────
  function subscribeAll(device: Device) {
    const subscribe = (chr: string, handler: (v: string) => void) => {
      const sub = device.monitorCharacteristicForService(
        SVC, chr,
        (err, c) => { if (!err && c?.value) handler(c.value); }
      );
      subs.current.push(sub);
    };

    subscribe(CHR_PITOT,   (v) => { const p = parsePitot(v); if (p) updateSensors(p); });
    subscribe(CHR_IMU,     (v) => { const p = parseIMU(v);   if (p) updateSensors(p); });
    subscribe(CHR_ENV,     (v) => { const p = parseEnv(v);   if (p) updateSensors(p); });  // includes speedMs
    // ⚠ La notify su 0xaa04 arriva SOLO come sentinella LAP (power=0xFFFF):
    // il pulsante lap sul device. I dati reali arrivano dal poll READ a 1 Hz.
    subscribe(CHR_SENSORS, (v) => {
      const raw = parseSensors(v);
      if (!raw) return;
      if (raw.powerW === 0xffff) {
        const st = useStore.getState();
        if (st.isRecording) st.addLap();
        return;
      }
      applySensors(raw);  // robustezza verso firmware vecchi che notificano dati reali
    });
    // CHR_PHYSICS (0xaa09): fisica calcolata dall'ESP32 — sorgente di verità del CdA
    subscribe(CHR_PHYSICS, (v) => {
      const p = parsePhysics(v);
      if (p) setPhysicsFromDevice(p);
    });
    // CHR_BATTERY (0xaa0a): % batteria a 0.1 Hz
    subscribe(CHR_BATTERY, (v) => {
      const buf = Buffer.from(v, 'base64');
      if (buf.length >= 1) setBattery(buf.readUInt8(0));
    });
    // CHR_IDENTITY (0xaa05) is READ+WRITE only — read once in connect(), not here
  }

  // Applica power/cad/hr allo store rispettando il sensore cadenza dedicato
  function applySensors(raw: NonNullable<ReturnType<typeof parseSensors>>) {
    const parsed: Partial<typeof raw> = { ...raw };
    // Se il sensore cadenza BLE dedicato è connesso, ignora la cadenza
    // dell'ESP32 (manderebbe 0 schiacciando il valore reale)
    if (useStore.getState().cadenceSensorStatus === 'connected') {
      delete parsed.cadenceRpm;
    }
    updateSensors(parsed);
  }

  // ── Poll ANT (1 Hz) ──────────────────────────────────────────────────────
  // power/cad/hr correnti si ottengono SOLO con READ esplicite su 0xaa04
  // (la notify è riservata alla sentinella lap).
  function startAntPolling(device: Device) {
    stopAntPolling();
    antPollRef.current = setInterval(async () => {
      try {
        const c = await device.readCharacteristicForService(SVC, CHR_SENSORS);
        if (!c.value) return;
        const raw = parseSensors(c.value);
        if (raw && raw.powerW !== 0xffff) applySensors(raw);
      } catch {}
    }, 1000);
  }

  function stopAntPolling() {
    if (antPollRef.current) {
      clearInterval(antPollRef.current);
      antPollRef.current = null;
    }
  }

  // ── Connessione ────────────────────────────────────────────────────────────
  async function connect(device: Device) {
    try {
      setBleStatus('connecting');
      // MTU ≥ 53 obbligatorio: PHYSICS (28 B) e READ IDENTITY (50 B)
      // arriverebbero troncate con l'MTU default di 23
      const connected = await device.connect({ autoConnect: false, requestMTU: 185 });
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setBleStatus('connected');
      subscribeAll(connected);
      startAntPolling(connected);

      // Legge la CONFIG dal device (12 B): la circonferenza ruota è di
      // proprietà del device; massa e Crr restano guidati dall'app (profili)
      try {
        const cfg = await connected.readCharacteristicForService(SVC, CHR_CONFIG);
        if (cfg.value) {
          const buf = Buffer.from(cfg.value, 'base64');
          if (buf.length >= 12) {
            const wheel = buf.readFloatLE(8);
            const { calib, setCalib } = useStore.getState();
            if (wheel >= 1.0 && wheel <= 2.5 && Math.abs(wheel - calib.tireCircM) > 0.0005) {
              setCalib({ tireCircM: wheel });
            }
          }
        }
      } catch {}

      // Write active athlete name to firmware NVS (shown on display and in coach frames)
      const state         = useStore.getState();
      const activeProfile = state.athleteProfiles.find((p) => p.id === state.activeAthleteId);
      const athleteName   = activeProfile?.name ?? '';
      if (athleteName) {
        try {
          // Troncamento per byte (non per caratteri): il firmware accetta 1-31 byte
          const nameBytes = Buffer.from(athleteName, 'utf8').slice(0, 31);
          await connected.writeCharacteristicWithResponseForService(
            SVC, CHR_IDENTITY, nameBytes.toString('base64')
          );
        } catch {}
      }

      // Sincronizza massa e Crr con il firmware ESP32 (pitotOffset gestito dal device)
      try {
        const { calib } = useStore.getState();
        const mass = (activeProfile?.massRiderKg ?? calib.massRiderKg)
                   + (activeProfile?.massBikeKg  ?? calib.massBikeKg);
        const crr  = activeProfile?.crr ?? calib.crr;
        await writeDeviceConfig(connected, mass, crr);
      } catch {}

      // Rilevamento disconnessione
      disconnectSub.current?.remove();
      disconnectSub.current = connected.onDisconnected(() => {
        cleanupSubs();
        stopAntPolling();
        deviceRef.current = null;
        setBleStatus('scanning');
        startScan();
      });
    } catch {
      setBleStatus('error');
    }
  }

  // ── Scrittura config → ESP32 ──────────────────────────────────────────────
  // 12 byte: mass_kg + crr + wheel_circ_m. Chiamata on-connect e ad ogni
  // modifica dei parametri dall'utente (setCalib / cambio profilo atleta).
  // I valori sono clampati nei range firmware: fuori range il device
  // risponde con errore ATT e NESSUN campo viene scritto.
  // NB: pitotOffset NON viene inviato — la calibrazione pitot avviene sul device.
  async function writeDeviceConfig(
    device: Device,
    massKg: number,
    crr: number,
  ): Promise<void> {
    try {
      const { calib } = useStore.getState();
      const buf = Buffer.alloc(12);
      buf.writeFloatLE(clamp(massKg, 33, 200),           0);
      buf.writeFloatLE(clamp(crr, 0.001, 0.025),         4);
      buf.writeFloatLE(clamp(calib.tireCircM, 1.0, 2.5), 8);
      await device.writeCharacteristicWithResponseForService(
        SVC, CHR_CONFIG, buf.toString('base64')
      );
    } catch {}
  }

  // Versione pubblica che usa il device attualmente connesso (per chiamate esterne)
  async function syncConfigToDevice(massKg: number, crr: number): Promise<void> {
    if (deviceRef.current) await writeDeviceConfig(deviceRef.current, massKg, crr);
  }

  // ── Scan ───────────────────────────────────────────────────────────────────
  function startScan() {
    if (!manager.current) return;
    setBleStatus('scanning');

    manager.current.startDeviceScan(
      [SVC],
      { allowDuplicates: false },
      (err, device) => {
        if (err) { setBleStatus('error'); return; }
        if (!device) return;

        // Se c'è un device accoppiato, connetti solo quello (via ref per leggere il valore aggiornato)
        const pid = pairedIdRef.current;
        if (pid && device.id !== pid) return;

        manager.current?.stopDeviceScan();
        connect(device);
      }
    );
  }

  // ── Simulazione ────────────────────────────────────────────────────────────
  function startSimulation() {
    setBleStatus('connected');
    let t = 0;
    tickRef.current = setInterval(() => {
      t += 0.1;
      updateSensors({
        pitotPa:    35 + Math.sin(t * 0.3) * 10,
        staticPa:   101325,
        tempC:      22 + Math.sin(t * 0.1) * 2,
        humidity:   0.5,
        altM:       150,
        pitchDeg:   Math.sin(t * 0.05) * 3,
        rollDeg:    0,
        powerW:     250 + Math.sin(t * 0.2) * 50,
        speedMs:    10 + Math.sin(t * 0.15) * 2,
        cadenceRpm: 90 + Math.round(Math.sin(t * 0.1) * 5),
        hrBpm:      140 + Math.round(Math.sin(t * 0.07) * 10),
      });
    }, 100);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  function cleanupSubs() {
    subs.current.forEach((s) => s.remove());
    subs.current = [];
  }

  // ── Tick sessione (1 Hz) ───────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [tick]);

  // ── Init BLE ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isSimMode) {
      startSimulation();
      return () => {
        if (tickRef.current) clearInterval(tickRef.current);
      };
    }

    manager.current = new BleManager();

    const sub = manager.current.onStateChange((state) => {
      if (state === 'PoweredOn') {
        sub.remove();
        requestPermissions().then((ok) => {
          if (ok) startScan();
          else setBleStatus('error');
        });
      }
    }, true);

    return () => {
      cleanupSubs();
      stopAntPolling();
      disconnectSub.current?.remove();
      disconnectSub.current = null;
      if (tickRef.current) clearInterval(tickRef.current);
      manager.current?.destroy();
      manager.current = null;
    };
  }, [isSimMode]);

  return { syncConfigToDevice };
}