/**
 * useBLE.ts
 * Hook React Native per connessione BLE al device AeroDrag.
 *
 * UUID servizi/caratteristiche (firmware ESP32 ble_server.h):
 *   Servizio principale: 0000aa00-0000-1000-8000-00805f9b34fb
 *   0000aa01 → Pitot + pressione statica      (float32 ×2: pitotPa, staticPa)
 *   0000aa02 → IMU pitch + roll               (float32 ×2: pitch, roll)
 *   0000aa03 → Ambiente + velocità            (float32 ×4: temp, humidity×100, alt, speed_ms)
 *   0000aa04 → ANT+ power/cad/hr              (uint16 power + uint8 cad + uint8 hr = 4 B)
 *   0000aa05 → Identità device (R/W)          (device_id[18] + athlete_name[32])
 *   0000aa06 → Versione firmware (R)          (stringa ASCII)
 *   0000aa07 → OTA trigger (W)                (URL HTTP del .bin)
 *   0000aa08 → Config parametri (W)           (float32×3: massKg, crr, pitotOffset)
 *   0000aa09 → Physics output (NOTIFY 10 Hz)  (float32×7: cda, vAir, rho, pctAero, pAero, pRoll, pGrav)
 *
 * Note:
 *   - La velocità arriva da 0xaa03[3] come float32 m/s, NON da 0xaa04.
 *   - La batteria NON è esposta via BLE; compare solo nei frame Wi-Fi coach.
 *   - Scrivere il nome atleta su 0xaa05 sincronizza il display e i frame coach.
 *   - 0xaa08 va scritto on-connect e ad ogni cambio di massa/Crr/pitotOffset in app.
 *   - 0xaa09 è la sorgente di verità del CdA — l'ESP32 calcola in autonomia.
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

// ── Parsing pacchetti BLE ─────────────────────────────────────────────────────

function parsePitot(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  return {
    pitotPa:  buf.readFloatLE(0),
    staticPa: buf.readFloatLE(4),
  };
}

function parseIMU(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  return {
    pitchDeg: buf.readFloatLE(0),
    rollDeg:  buf.readFloatLE(4),
  };
}

function parseEnv(b64: string) {
  const buf = Buffer.from(b64, 'base64');
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
    pctAero:   buf.readFloatLE(12),
    pAeroW:    buf.readFloatLE(16),
    pRollingW: buf.readFloatLE(20),
    pGravityW: buf.readFloatLE(24),
    valid:     cda > 0.01 && vAirMs > 0.5,
  };
}

// ── Hook principale ───────────────────────────────────────────────────────────

export function useBLE() {
  const manager        = useRef<BleManager | null>(null);
  const deviceRef      = useRef<Device | null>(null);
  const tickRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const subs           = useRef<Subscription[]>([]);
  const disconnectSub  = useRef<Subscription | null>(null);
  const pairedIdRef    = useRef<string | null>(null);

  const {
    setBleStatus, updateSensors, setPhysicsFromDevice,
    tick, isSimMode, pairedDeviceId,
  } = useStore();

  // Sync ref → leggi sempre il valore corrente nello scan callback
  useEffect(() => { pairedIdRef.current = pairedDeviceId; }, [pairedDeviceId]);

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

    subscribe(CHR_PITOT,   (v) => updateSensors(parsePitot(v)));
    subscribe(CHR_IMU,     (v) => updateSensors(parseIMU(v)));
    subscribe(CHR_ENV,     (v) => updateSensors(parseEnv(v)));   // includes speedMs
    subscribe(CHR_SENSORS, (v) => updateSensors(parseSensors(v)));
    // CHR_PHYSICS (0xaa09): fisica calcolata dall'ESP32 — sorgente di verità del CdA
    subscribe(CHR_PHYSICS, (v) => {
      const p = parsePhysics(v);
      if (p) setPhysicsFromDevice(p);
    });
    // CHR_IDENTITY (0xaa05) is READ+WRITE only — read once in connect(), not here
  }

  // ── Connessione ────────────────────────────────────────────────────────────
  async function connect(device: Device) {
    try {
      setBleStatus('connecting');
      const connected = await device.connect({ autoConnect: false });
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setBleStatus('connected');
      subscribeAll(connected);

      // Write active athlete name to firmware NVS (shown on display and in coach frames)
      const state         = useStore.getState();
      const activeProfile = state.athleteProfiles.find((p) => p.id === state.activeAthleteId);
      const athleteName   = activeProfile?.name ?? '';
      if (athleteName) {
        try {
          const nameBytes = Buffer.from(athleteName.slice(0, 31), 'utf8');
          await connected.writeCharacteristicWithResponseForService(
            SVC, CHR_IDENTITY, nameBytes.toString('base64')
          );
        } catch {}
      }

      // Sincronizza i parametri fisici con il firmware ESP32 (massa, Crr, pitotOffset)
      // in modo che physics_compute() usi i valori aggiornati dall'utente
      try {
        const { calib } = useStore.getState();
        const mass = (activeProfile?.massRiderKg ?? calib.massRiderKg)
                   + (activeProfile?.massBikeKg  ?? calib.massBikeKg);
        const crr  = activeProfile?.crr ?? calib.crr;
        await writeDeviceConfig(connected, mass, crr, calib.pitotOffset);
      } catch {}

      // Rilevamento disconnessione
      disconnectSub.current?.remove();
      disconnectSub.current = connected.onDisconnected(() => {
        cleanupSubs();
        deviceRef.current = null;
        setBleStatus('scanning');
        startScan();
      });
    } catch {
      setBleStatus('error');
    }
  }

  // ── Scrittura config → ESP32 ──────────────────────────────────────────────
  // Invia massa, Crr e pitotOffset al firmware; chiamata on-connect e ad ogni
  // modifica dei parametri dall'utente (setCalib / cambio profilo atleta).
  async function writeDeviceConfig(
    device: Device,
    massKg: number,
    crr: number,
    pitotOffset: number,
  ): Promise<void> {
    try {
      const buf = Buffer.alloc(12);
      buf.writeFloatLE(massKg,      0);
      buf.writeFloatLE(crr,         4);
      buf.writeFloatLE(pitotOffset, 8);
      await device.writeCharacteristicWithResponseForService(
        SVC, CHR_CONFIG, buf.toString('base64')
      );
    } catch {}
  }

  // Versione pubblica che usa il device attualmente connesso (per chiamate esterne)
  async function syncConfigToDevice(massKg: number, crr: number, pitotOffset: number): Promise<void> {
    if (deviceRef.current) await writeDeviceConfig(deviceRef.current, massKg, crr, pitotOffset);
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
      disconnectSub.current?.remove();
      disconnectSub.current = null;
      if (tickRef.current) clearInterval(tickRef.current);
      manager.current?.destroy();
      manager.current = null;
    };
  }, [isSimMode]);

  return { syncConfigToDevice };
}