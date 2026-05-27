/**
 * useBLE.ts
 * Hook React Native per connessione BLE al device AeroDrag.
 *
 * UUID servizi/caratteristiche (devono corrispondere al firmware ESP32):
 *   Servizio principale: 0000aa00-0000-1000-8000-00805f9b34fb
 *   0000aa01 → Pitot + pressione statica  (float32 x2, 10 Hz)
 *   0000aa02 → IMU pitch + roll           (float32 x2, 10 Hz)
 *   0000aa03 → Ambiente temp/hum/alt      (float32 x3,  1 Hz)
 *   0000aa04 → Sensori esterni power/cad/hr/speed (packed uint8/16, 4 Hz)
 *   0000aa05 → Batteria                   (uint8, 0.1 Hz)
 */

import { useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { useStore } from '../store';

// ── UUID ──────────────────────────────────────────────────────────────────────
const SVC     = '0000aa00-0000-1000-8000-00805f9b34fb';
const CHR_PITOT   = '0000aa01-0000-1000-8000-00805f9b34fb';
const CHR_IMU     = '0000aa02-0000-1000-8000-00805f9b34fb';
const CHR_ENV     = '0000aa03-0000-1000-8000-00805f9b34fb';
const CHR_SENSORS = '0000aa04-0000-1000-8000-00805f9b34fb';
const CHR_BATTERY = '0000aa05-0000-1000-8000-00805f9b34fb';

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
    humidity: buf.readFloatLE(4) / 100,  // firmware invia 0-100
    altM:     buf.readFloatLE(8),
  };
}

function parseSensors(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  return {
    powerW:     buf.readUInt16LE(0),
    cadenceRpm: buf.readUInt8(2),
    hrBpm:      buf.readUInt8(3),
    speedMs:    buf.readUInt16LE(4) / 100,  // firmware invia cm/s
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
    setBleStatus, setBattery, updateSensors,
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
    subscribe(CHR_ENV,     (v) => updateSensors(parseEnv(v)));
    subscribe(CHR_SENSORS, (v) => updateSensors(parseSensors(v)));
    subscribe(CHR_BATTERY, (v) => {
      const buf = Buffer.from(v, 'base64');
      setBattery(buf.readUInt8(0));
    });
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
}