/**
 * useMultiBLE — Multi-device BLE manager.
 *
 * Gestisce in parallelo fino a 3 connessioni BLE simultanee:
 *   1. Device principale AeroDrag (ESP32) — service 0xaa00
 *   2. Sensore IMU mozzo anteriore (AeroDrag-Wheel) — service 0xbb00
 *   3. Fascia HR+IMU AeroDrag OPPURE monitor HR standard (Garmin/Wahoo/Polar) — service 0xcc00/0x180D
 *
 * Architettura:
 *   - Un singolo BleManager gestisce tutte le connessioni.
 *   - Una scan unica filtra simultaneamente tutti i service UUID non ancora connessi.
 *   - Ogni dispositivo ha il proprio set di subscription e si riconnette indipendentemente.
 *   - In modalità discovery (store.isDiscovering = true) la scan normale si sospende e parte
 *     una scan specifica per il target, i device trovati confluiscono in store.discoveredDevices.
 */

import { useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

import { useStore, DeviceRole } from '../store';
import {
  MAIN_SVC, MAIN_PITOT, MAIN_IMU, MAIN_ENV, MAIN_SENSORS, MAIN_IDENTITY,
  WHEEL_SVC, WHEEL_IMU, WHEEL_STATE, WHEEL_BATT,
  HRBAND_SVC, HRBAND_HR, HRBAND_IMU, HRBAND_ENV, HRBAND_BATT,
  STD_HR_SVC, STD_HR_MEAS,
  parseMainPitot, parseMainIMU, parseMainEnv, parseMainSensors,
  parseWheelImu, parseWheelState,
  parseHRBandHR, parseHRBandImu, parseHRBandEnv,
  parseStdHR,
} from '../ble/protocols';

type ConnMap = Map<string, Device>;
type SubsMap = Map<string, Subscription[]>;
type DisMap  = Map<string, Subscription>;

// ── Permessi Android ─────────────────────────────────────────────────────────

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(results).every(r => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

// ── Hook principale ───────────────────────────────────────────────────────────

export function useMultiBLE() {
  const manager   = useRef<BleManager | null>(null);
  const connected = useRef<ConnMap>(new Map());
  const subsMap   = useRef<SubsMap>(new Map());
  const disMap    = useRef<DisMap>(new Map());
  const isScanning = useRef(false);
  const simTick    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Legge sempre lo stato corrente dallo store (evita stale closures nei callback BLE)
  const store = useStore;

  // ── Tick sessione 1 Hz ─────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => store.getState().tick(), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Sottoscrizione reattiva ───────────────────────────────────────────────
  const {
    isSimMode,
    isDiscovering, discoveryTarget,
    pairedDeviceId, pairedWheelId, pairedHRId,
  } = useStore(s => ({
    isSimMode:       s.isSimMode,
    isDiscovering:   s.isDiscovering,
    discoveryTarget: s.discoveryTarget,
    pairedDeviceId:  s.pairedDeviceId,
    pairedWheelId:   s.pairedWheelId,
    pairedHRId:      s.pairedHRId,
  }));

  // ── Init BLE ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isSimMode) {
      startSimulation();
      return () => stopSimulation();
    }

    manager.current = new BleManager();
    store.getState().setDeviceStatus('main',  'scanning');

    const sub = manager.current.onStateChange(state => {
      if (state !== 'PoweredOn') return;
      sub.remove();
      requestPermissions().then(ok => {
        if (ok) startScan();
        else store.getState().setDeviceStatus('main', 'error');
      });
    }, true);

    return () => {
      cleanupAll();
      manager.current?.destroy();
      manager.current = null;
    };
  }, [isSimMode]);

  useEffect(() => {
    if (!manager.current) return;
    stopScan();
    if (isDiscovering && discoveryTarget) {
      startDiscoveryScan(discoveryTarget);
    } else {
      startScan();
    }
  }, [isDiscovering, discoveryTarget, pairedDeviceId, pairedWheelId, pairedHRId]);

  // ── Scan auto-connessione ─────────────────────────────────────────────────

  function buildScanUUIDs(): string[] {
    const state = store.getState();
    const uuids: string[] = [];
    if (state.pairedDeviceId && !connected.current.has(state.pairedDeviceId))
      uuids.push(MAIN_SVC);
    if (state.pairedWheelId && !connected.current.has(state.pairedWheelId))
      uuids.push(WHEEL_SVC);
    if (state.pairedHRId && !connected.current.has(state.pairedHRId)) {
      // Scansiona sia il servizio AeroDrag sia quello standard per coprire entrambi i tipi
      uuids.push(HRBAND_SVC);
      uuids.push(STD_HR_SVC);
    }
    return uuids;
  }

  function startScan() {
    if (!manager.current || isScanning.current) return;
    const uuids = buildScanUUIDs();
    if (uuids.length === 0) return;

    isScanning.current = true;
    manager.current.startDeviceScan(
      uuids,
      { allowDuplicates: false },
      (_err, device) => {
        if (!device) return;
        routeDevice(device);
      }
    );
  }

  function stopScan() {
    if (!isScanning.current) return;
    manager.current?.stopDeviceScan();
    isScanning.current = false;
  }

  function checkStopScan() {
    const state    = store.getState();
    const paired   = [state.pairedDeviceId, state.pairedWheelId, state.pairedHRId].filter(Boolean);
    const allConn  = paired.every(id => connected.current.has(id!));
    if (allConn) stopScan();
  }

  function routeDevice(device: Device) {
    const state = store.getState();

    if (state.pairedDeviceId === device.id && !connected.current.has(device.id)) {
      connectDevice(device, 'main');
    } else if (state.pairedWheelId === device.id && !connected.current.has(device.id)) {
      connectDevice(device, 'wheel');
    } else if (state.pairedHRId === device.id && !connected.current.has(device.id)) {
      connectDevice(device, 'hr');
    }
  }

  // ── Discovery scan (per schermate settings) ───────────────────────────────

  function startDiscoveryScan(target: 'wheel' | 'hr') {
    if (!manager.current) return;
    const uuids = target === 'wheel'
      ? [WHEEL_SVC]
      : [HRBAND_SVC, STD_HR_SVC];

    isScanning.current = true;
    manager.current.startDeviceScan(
      uuids,
      { allowDuplicates: false },
      (_err, device) => {
        if (!device) return;
        // Determina il tipo HR dal servizio annunciato
        let hrType: 'aerodrag' | 'standard' | undefined;
        if (target === 'hr') {
          hrType = device.serviceUUIDs?.includes(HRBAND_SVC) ? 'aerodrag' : 'standard';
        }
        store.getState().addDiscoveredDevice({
          id:     device.id,
          name:   device.name,
          rssi:   device.rssi ?? -100,
          hrType,
        });
      }
    );
  }

  // ── Connessione dispositivo ───────────────────────────────────────────────

  async function connectDevice(device: Device, role: DeviceRole) {
    try {
      store.getState().setDeviceStatus(role, 'connecting');
      const conn = await device.connect({ autoConnect: false });
      await conn.discoverAllServicesAndCharacteristics();
      connected.current.set(device.id, conn);
      store.getState().setDeviceStatus(role, 'connected');

      subscribeDevice(conn, role);
      setupDisconnectHandler(conn, role);

      if (role === 'main') await writeAthleteName(conn);
      if (role === 'wheel') readWheelBattery(conn);
      if (role === 'hr')    readHRBattery(conn);

      checkStopScan();
    } catch {
      store.getState().setDeviceStatus(role, 'error');
    }
  }

  // ── Subscription per tipo di device ──────────────────────────────────────

  function subscribeDevice(device: Device, role: DeviceRole) {
    const subs: Subscription[] = [];

    function sub(svc: string, chr: string, handler: (v: string) => void) {
      const s = device.monitorCharacteristicForService(
        svc, chr,
        (err, c) => { if (!err && c?.value) handler(c.value); }
      );
      subs.push(s);
    }

    if (role === 'main') {
      sub(MAIN_SVC, MAIN_PITOT,   v => store.getState().updateSensors(parseMainPitot(v)));
      sub(MAIN_SVC, MAIN_IMU,     v => store.getState().updateSensors(parseMainIMU(v)));
      sub(MAIN_SVC, MAIN_ENV,     v => store.getState().updateSensors(parseMainEnv(v)));
      sub(MAIN_SVC, MAIN_SENSORS, v => {
        const { powerW, cadenceRpm, hrBpm } = parseMainSensors(v);
        // Aggiorna HR solo se non c'è una fascia HR dedicata connessa
        const state = store.getState();
        const hrConnected = state.pairedHRId && connected.current.has(state.pairedHRId);
        const update: any = { powerW, cadenceRpm };
        if (!hrConnected) update.hrBpm = hrBpm;
        state.updateSensors(update);
      });
    }

    if (role === 'wheel') {
      sub(WHEEL_SVC, WHEEL_IMU, v => {
        const p = parseWheelImu(v);
        store.getState().updateWheel({ ax: p.ax, ay: p.ay, az: p.az, gx: p.gx, gy: p.gy, gz: p.gz });
      });
      sub(WHEEL_SVC, WHEEL_STATE, v => {
        const p = parseWheelState(v);
        store.getState().updateWheel({
          speedMs:        p.speedMs,
          decelMs2:       p.decelMs2,
          wheelTempC:     p.tempC,
          vibrationIndex: p.vibrationIndex,
        });
      });
    }

    if (role === 'hr') {
      const state = store.getState();
      if (state.pairedHRType === 'aerodrag') {
        sub(HRBAND_SVC, HRBAND_HR, v => {
          const { hrBpm, rrMs } = parseHRBandHR(v);
          state.updateSensors({ hrBpm });
          if (rrMs.length > 0) store.getState().appendRR(rrMs);
        });
        sub(HRBAND_SVC, HRBAND_IMU, v => {
          const { pitchDeg, rollDeg, lateralOscMm, respBreathMin } = parseHRBandImu(v);
          store.getState().updateSensors({
            trunkPitchDeg: pitchDeg,
            trunkRollDeg:  rollDeg,
            lateralOscMm,
            respBreathMin,
          });
        });
        sub(HRBAND_SVC, HRBAND_ENV, v => {
          const { skinTempC } = parseHRBandEnv(v);
          store.getState().updateSensors({ skinTempC });
        });
      } else {
        // Standard BLE HR: Garmin, Wahoo, Polar, Bryton, qualsiasi monitor cardiaco
        sub(STD_HR_SVC, STD_HR_MEAS, v => {
          const { hrBpm, rrMs } = parseStdHR(v);
          store.getState().updateSensors({ hrBpm });
          if (rrMs.length > 0) store.getState().appendRR(rrMs);
        });
      }
    }

    subsMap.current.set(device.id, subs);
  }

  // ── Gestione disconnessione ────────────────────────────────────────────────

  function setupDisconnectHandler(device: Device, role: DeviceRole) {
    disMap.current.get(device.id)?.remove();
    const sub = device.onDisconnected(() => {
      cleanupDevice(device.id, role);
      store.getState().setDeviceStatus(role, 'scanning');
      if (!store.getState().isDiscovering) startScan();
    });
    disMap.current.set(device.id, sub);
  }

  function cleanupDevice(id: string, role: DeviceRole) {
    subsMap.current.get(id)?.forEach(s => s.remove());
    subsMap.current.delete(id);
    disMap.current.get(id)?.remove();
    disMap.current.delete(id);
    connected.current.delete(id);
    store.getState().setDeviceStatus(role, 'idle');
  }

  function cleanupAll() {
    stopScan();
    connected.current.forEach((_, id) => {
      subsMap.current.get(id)?.forEach(s => s.remove());
      disMap.current.get(id)?.remove();
    });
    connected.current.clear();
    subsMap.current.clear();
    disMap.current.clear();
  }

  // ── Scrittura nome atleta su device principale ────────────────────────────

  async function writeAthleteName(device: Device) {
    const state    = store.getState();
    const profile  = state.athleteProfiles.find(p => p.id === state.activeAthleteId);
    const name     = profile?.name ?? '';
    if (!name) return;
    try {
      const bytes = Buffer.from(name.slice(0, 31), 'utf8');
      await device.writeCharacteristicWithResponseForService(
        MAIN_SVC, MAIN_IDENTITY, bytes.toString('base64')
      );
    } catch {}
  }

  // ── Lettura batteria ──────────────────────────────────────────────────────

  async function readWheelBattery(device: Device) {
    try {
      const c = await device.readCharacteristicForService(WHEEL_SVC, WHEEL_BATT);
      if (c?.value) store.getState().setWheelBattery(Buffer.from(c.value, 'base64').readUInt8(0));
    } catch {}
  }

  async function readHRBattery(device: Device) {
    try {
      const svc = store.getState().pairedHRType === 'aerodrag' ? HRBAND_SVC : STD_HR_SVC;
      const chr = store.getState().pairedHRType === 'aerodrag' ? HRBAND_BATT : '00002a19-0000-1000-8000-00805f9b34fb';
      const c   = await device.readCharacteristicForService(svc, chr);
      if (c?.value) store.getState().setHRBattery(Buffer.from(c.value, 'base64').readUInt8(0));
    } catch {}
  }

  // ── Simulazione ──────────────────────────────────────────────────────────

  function startSimulation() {
    store.getState().setDeviceStatus('main', 'connected');
    store.getState().setDeviceStatus('wheel', 'connected');
    store.getState().setDeviceStatus('hr', 'connected');

    let t = 0;
    simTick.current = setInterval(() => {
      t += 0.1;
      const speedMs = 10 + Math.sin(t * 0.15) * 2;

      store.getState().updateSensors({
        pitotPa:       35 + Math.sin(t * 0.3) * 10,
        staticPa:      101325,
        tempC:         22 + Math.sin(t * 0.1) * 2,
        humidity:      0.5,
        altM:          150,
        pitchDeg:      Math.sin(t * 0.05) * 3,
        rollDeg:       0,
        powerW:        250 + Math.sin(t * 0.2) * 50,
        speedMs,
        cadenceRpm:    90 + Math.round(Math.sin(t * 0.1) * 5),
        hrBpm:         140 + Math.round(Math.sin(t * 0.07) * 10),
        trunkPitchDeg: 18 + Math.sin(t * 0.04) * 5,
        trunkRollDeg:  Math.sin(t * 0.08) * 2,
        lateralOscMm:  12 + Math.sin(t * 0.12) * 4,
        respBreathMin: 22 + Math.sin(t * 0.03) * 3,
        skinTempC:     34 + Math.sin(t * 0.02) * 0.5,
      });

      store.getState().updateWheel({
        speedMs,
        decelMs2:       0,
        wheelTempC:     24,
        vibrationIndex: Math.round(100 + Math.sin(t * 0.5) * 50),
        ax: 0, ay: 0, az: 9.81,
        gx: speedMs * 100, gy: 0, gz: 0,
      });

      // Simula RR intervals (60000/bpm ± variabilità)
      const hr  = 140 + Math.round(Math.sin(t * 0.07) * 10);
      const rr  = Math.round(60000 / hr + (Math.random() - 0.5) * 30);
      store.getState().appendRR([rr]);
    }, 100);
  }

  function stopSimulation() {
    if (simTick.current) clearInterval(simTick.current);
    simTick.current = null;
  }
}
