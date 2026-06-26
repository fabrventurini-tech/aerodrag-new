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
 *   0xaa09 PHYSICS  NOTIFY 10 Hz    28 B:  float×7 cda, vAir, rho, pctAero(0-100), pAero, pRoll, pGrav
 *          tutti 0 se misura non valida
 *   0xaa0a BATTERY  NOTIFY 0.1 Hz    1 B:  uint8 pct 0-100
 *   0xaa0f COACH_LINK NOTIFY (v0.3.0) 2 B: uint8 type + uint8 arg — relay comandi
 *          coach→app (0x01 start, 0x02 stop, 0x03 lap). Recisione live app↔Pi.
 *   0xaa10 TIME     R+W (v0.3.0)     8 B:  uint64 epochMs LE — orologio UTC del
 *          device; l'app lo scrive on-connect (clock del telefono) → abilita tUtc.
 *
 * Note:
 *   - Tutti i multi-byte little-endian; float IEEE-754 32 bit raw.
 *   - MTU: PHYSICS (28 B) richiede MTU ≥ 31, READ IDENTITY (50 B) MTU ≥ 53.
 *     Si negozia requestMTU 185 alla connect (Android; iOS automatico).
 *   - 0xaa05 letto on-connect: il device_id (MAC) è l'IDENTITÀ CANONICA del
 *     device (contract v0.1.4/v0.2.0 §2) → unica sorgente del campo `device`
 *     dei frame coach. device.id BLE (UUID su iOS) NON è l'identità.
 *   - 0xaa08 (contract v0.2.0): l'app è autorevole per mass/crr/wheelCircM e li
 *     scrive on-connect + a ogni cambio in app; la READ è solo default/echo
 *     (il wheelCircM NON viene più adottato dal device).
 *   - 0xaa09 è la sorgente di verità del CdA — l'ESP32 calcola in autonomia;
 *     il calcolo locale in engine.ts resta solo per sim mode / firmware vecchio.
 */

import { useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { PhysicsOutput } from '../physics/engine';
import {
  isValidMAC, loadSensorWhitelist, macToWhitelistBytes,
  SENSOR_TYPE_CODE, SENSOR_TYPE_FROM_CODE, SENSOR_WL_MAX, DiscoveredSensor,
} from '../security/pairing';

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
const CHR_SENSOR_WL = '0000aa0b-0000-1000-8000-00805f9b34fb';  // whitelist sensori (v0.2.0)
const CHR_WHEEL_STREAM = '0000aa0c-0000-1000-8000-00805f9b34fb';  // relay stream ruota Crr (v0.2.0)
const CHR_WHEEL_CMD    = '0000aa0d-0000-1000-8000-00805f9b34fb';  // comando coast-down (v0.2.0)

const CHR_SENSOR_SCAN  = '0000aa0e-0000-1000-8000-00805f9b34fb';  // discovery sensori firmware (v0.2.2)
const CHR_COACH_LINK   = '0000aa0f-0000-1000-8000-00805f9b34fb';  // relay comandi coach→app (v0.3.0)
const CHR_TIME         = '0000aa10-0000-1000-8000-00805f9b34fb';  // orologio UTC oggettivo (v0.3.0)

// Comandi coast-down inoltrati al sensore ruota via WHEEL_CMD 0xaa0d
export const WHEEL_CMD = {
  START_INDOOR:    0x01,
  START_OUTDOOR_A: 0x02,
  START_OUTDOOR_B: 0x03,
  CANCEL:          0xff,
} as const;

// API a livello modulo: permette agli screen (SettingsScreen) di ri-scrivere la
// whitelist sensori sul firmware dopo un add/remove, senza rimontare il hook.
export const bleApi = {
  syncSensorWhitelist: async (): Promise<void> => {},
  // Invia un comando coast-down (0x01/0x02/0x03/0xFF) al sensore ruota tramite
  // il device principale (WHEEL_CMD 0xaa0d → il firmware inoltra al sensore).
  sendWheelCommand: async (_cmd: number): Promise<boolean> => false,
  // Discovery sensori pilotata dal firmware (SENSOR_SCAN 0xaa0e, v0.2.2):
  // il firmware scansiona e notifica i candidati con MAC reale (iOS+Android).
  startSensorDiscovery: async (): Promise<void> => {},
  stopSensorDiscovery:  async (): Promise<void> => {},
};

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
    pctAero:   buf.readFloatLE(12),        // contract v0.1.0: percentuale 0-100
    pAeroW:    buf.readFloatLE(16),
    pRollingW: buf.readFloatLE(20),
    pGravityW: buf.readFloatLE(24),
    valid:     cda > 0.01 && vAirMs > 0.5,
  };
}

// WHEEL_STREAM 0xaa0c (NOTIFY, 16 B): relay grezzo del sensore ruota Crr
// (contract v0.2.0 §2). float speedMs, accelMs2, tempC, vibRMS.
function parseWheelStream(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 16) return null;
  return {
    speedMs:  buf.readFloatLE(0),
    accelMs2: buf.readFloatLE(4),
    tempC:    buf.readFloatLE(8),
    vibRMS:   buf.readFloatLE(12),
  };
}

// SENSOR_SCAN 0xaa0e (NOTIFY, contract v0.2.2): una entry per sensore scoperto
// dal firmware. type(1) + mac[6] display-order + rssi(int8) + nameLen(1) + name.
function parseSensorScanEntry(b64: string): DiscoveredSensor | null {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 9) return null;
  const type = SENSOR_TYPE_FROM_CODE[buf.readUInt8(0)];
  if (!type) return null;
  const mac = Array.from(buf.subarray(1, 7))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
  const rssi    = buf.readInt8(7);
  const nameLen = buf.readUInt8(8);
  // Entry troncata dopo nameLen → scarta (come gli altri parser), niente degrado
  // silenzioso con nome di fallback su un pacchetto incompleto.
  if (nameLen > 0 && buf.length < 9 + nameLen) return null;
  const name = nameLen > 0
    ? buf.toString('utf8', 9, 9 + nameLen)
    : `Sensore ${mac.slice(-5)}`;
  return { type, mac, name, rssi };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// IDENTITY 0xaa05 (READ, 50 B): char device_id[18] ("AA:BB:..\0") + char
// athlete_name[32]. Estrae il MAC canonico (contract v0.1.4/v0.2.0 §2): è
// l'unica sorgente del campo `device` dei frame coach, indipendente dall'id
// di connessione BLE (su iOS è un UUID, non il MAC).
function parseIdentityMac(b64: string): string | null {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 17) return null;
  let end = 0;
  while (end < 18 && end < buf.length && buf[end] !== 0) end++;
  const mac = buf.toString('ascii', 0, end).trim().toUpperCase();
  return isValidMAC(mac) ? mac : null;
}

// Tronca una stringa a maxBytes UTF-8 SENZA spezzare un carattere multibyte:
// un byte orfano (≥ 0x80) passerebbe la sanitizzazione del firmware e
// finirebbe come UTF-8 invalido nel JSON dei frame WebSocket verso il Pi.
function utf8Truncate(s: string, maxBytes: number): Buffer {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return buf;
  let end = maxBytes;
  // Arretra finché punta a un continuation byte (10xxxxxx): il carattere
  // a cavallo del limite viene escluso per intero
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.slice(0, end);
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
  // device.id NATIVO del device confermato (su iOS è un UUID, non il MAC):
  // usato per il fast-path di riconnessione, mai come identità (§2 v0.1.4).
  const confirmedNativeIdRef = useRef<string | null>(null);
  // device.id nativi già scartati (identità 0xaa05 ≠ MAC del QR): evita di
  // riconnetterli a ogni ciclo di scan.
  const rejectedIdsRef = useRef<Set<string>>(new Set());

  const wheelFreshRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensorScanSub  = useRef<Subscription | null>(null);
  const sensorScanStop = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    setBleStatus, setBattery, updateSensors, setPhysicsFromDevice,
    setDeviceIdentity, updateWheelStream, setWheelSensorStatus, setWheelSensorId,
    tick, isSimMode, pairedDeviceId,
    activeAthleteId, athleteProfiles,
  } = useStore(useShallow((s) => ({
    setBleStatus: s.setBleStatus, setBattery: s.setBattery,
    updateSensors: s.updateSensors, setPhysicsFromDevice: s.setPhysicsFromDevice,
    setDeviceIdentity: s.setDeviceIdentity, updateWheelStream: s.updateWheelStream,
    setWheelSensorStatus: s.setWheelSensorStatus, setWheelSensorId: s.setWheelSensorId,
    tick: s.tick, isSimMode: s.isSimMode, pairedDeviceId: s.pairedDeviceId,
    activeAthleteId: s.activeAthleteId, athleteProfiles: s.athleteProfiles,
  })));

  // Sync ref → leggi sempre il valore corrente nello scan callback. Al cambio
  // di device accoppiato azzera anche i ref di pairing (id nativo confermato e
  // scartati): altrimenti su iOS si potrebbe restare agganciati al device vecchio.
  useEffect(() => {
    pairedIdRef.current = pairedDeviceId;
    confirmedNativeIdRef.current = null;
    rejectedIdsRef.current.clear();
  }, [pairedDeviceId]);

  // Re-scrive il nome atleta su CHR_IDENTITY quando i profili sono caricati dopo
  // la connessione BLE (risolve il race condition tra connect() e loadAthleteProfiles())
  useEffect(() => {
    if (!deviceRef.current) return;
    const profile = athleteProfiles.find((p) => p.id === activeAthleteId);
    if (!profile?.name) return;
    // Troncamento a 31 byte al confine di carattere UTF-8
    const nameBytes = utf8Truncate(profile.name, 31);
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
    // CHR_WHEEL_STREAM (0xaa0c): relay del sensore ruota Crr (contract v0.2.0).
    // Lo stream arriva dal firmware (broker): segna il sensore ruota come
    // connesso finché i frame sono freschi.
    subscribe(CHR_WHEEL_STREAM, (v) => {
      const w = parseWheelStream(v);
      if (!w) return;
      updateWheelStream(w);
      setWheelSensorStatus('connected');
      if (wheelFreshRef.current) clearTimeout(wheelFreshRef.current);
      wheelFreshRef.current = setTimeout(() => setWheelSensorStatus('idle'), 2000);
    });
    // CHR_COACH_LINK (0xaa0f, v0.3.0): relay dei comandi coach via firmware.
    // Con la recisione del live app↔Pi (§3) l'app è solo-BLE: i comandi del coach
    // (start/stop/lap) non arrivano più dal /coach del Pi ma in NOTIFY qui.
    // Payload 2 B esatti: uint8 type + uint8 arg. Set esaustivo: 0x01 start,
    // 0x02 stop, 0x03 lap. REC si DERIVA da start/stop. type sconosciuti →
    // ignorati (riservati, forward-compat). NOTIFY-only: non si scrive su 0xaa0f.
    subscribe(CHR_COACH_LINK, (v) => {
      const buf = Buffer.from(v, 'base64');
      if (buf.length < 2) return;
      const type = buf.readUInt8(0);   // arg = buf.readUInt8(1) — non usato (lapNum non noto)
      const st = useStore.getState();
      switch (type) {
        case 0x01: if (!st.isRecording) st.startSession(); break;  // start → REC on
        case 0x02: if (st.isRecording)  st.stopSession();  break;  // stop  → REC off
        case 0x03: if (st.isRecording)  st.addLap();       break;  // lap
        default: break;  // riservati → ignora
      }
    });
    // CHR_IDENTITY (0xaa05) is READ+WRITE only — read once in connect(), not here
  }

  // Applica power/cad/hr allo store. Contract v0.2.0 §2: i sensori esterni si
  // bondano SOLO al firmware (broker model) → power/cad/hr arrivano sempre da
  // 0xaa04, niente più override da un sensore cadenza connesso dall'app.
  function applySensors(raw: NonNullable<ReturnType<typeof parseSensors>>) {
    updateSensors(raw);
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
      // APP-3 (audit v0.3.1): azzera eventuali subscription residue PRIMA di
      // riconnettere → niente accumulo di listener su reconnect o su connect
      // fallito a metà (es. read IDENTITY ko che ritorna senza disconnect event).
      cleanupSubs();
      // MTU ≥ 53 obbligatorio: PHYSICS (28 B) e READ IDENTITY (50 B)
      // arriverebbero troncate con l'MTU default di 23
      const connected = await device.connect({ autoConnect: false, requestMTU: 185 });
      await connected.discoverAllServicesAndCharacteristics();

      // ── Identità canonica (contract v0.1.4/v0.2.0 §2) ──────────────────────
      // Legge il MAC da IDENTITY 0xaa05 e lo confronta col MAC del QR (se
      // presente). Su iOS device.id è un UUID CoreBluetooth (non il MAC),
      // quindi la verifica del device corretto avviene QUI, dopo la connessione
      // e la lettura di 0xaa05 — non col filtro di scan sul MAC.
      let identityMac: string | null = null;
      try {
        const idc = await connected.readCharacteristicForService(SVC, CHR_IDENTITY);
        if (idc.value) identityMac = parseIdentityMac(idc.value);
      } catch {}

      const wantMac = pairedIdRef.current?.toUpperCase() ?? null;
      if (wantMac && identityMac && identityMac !== wantMac) {
        // Device sbagliato (es. un altro AeroDrag Pro vicino): scarta questo
        // device.id nativo e riprende la scansione.
        rejectedIdsRef.current.add(device.id);
        try { await connected.cancelConnection(); } catch {}
        setBleStatus('scanning');
        startScan();
        return;
      }

      deviceRef.current = connected;
      confirmedNativeIdRef.current = device.id;
      // Identità coach = 0xaa05 (fallback al MAC del QR se la READ fallisce)
      setDeviceIdentity(identityMac ?? wantMac);
      setBleStatus('connected');
      subscribeAll(connected);
      startAntPolling(connected);

      // TIME 0xaa10 (contract v0.3.0): il telefono ha un clock affidabile →
      // imposta l'orologio UTC del device alla connessione. Abilita `tUtc` nei
      // frame /device (ordinamento/dedup assoluti lato cloud). Best-effort: gli
      // errori ATT (len≠8 / epoch<2020) sono gestiti senza far cadere il connect.
      await writeDeviceTime(connected);

      // CONFIG 0xaa08 (contract v0.2.0): l'app è autorevole per TUTTI e tre i
      // parametri (mass/crr/wheelCircM). NON adottiamo più il wheelCircM dal
      // device — la READ è solo default/echo; è l'app a scrivere il proprio
      // valore (vedi writeDeviceConfig sotto).

      // Write active athlete name to firmware NVS (shown on display and in coach frames)
      const state         = useStore.getState();
      const activeProfile = state.athleteProfiles.find((p) => p.id === state.activeAthleteId);
      const athleteName   = activeProfile?.name ?? '';
      if (athleteName) {
        try {
          // Troncamento a 31 byte al confine di carattere UTF-8
          const nameBytes = utf8Truncate(athleteName, 31);
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

      // Scrive la whitelist sensori sul firmware (broker di pairing, v0.2.0 §2)
      await writeSensorWhitelist(connected);

      // Rilevamento disconnessione
      disconnectSub.current?.remove();
      disconnectSub.current = connected.onDisconnected(() => {
        cleanupSubs();
        stopAntPolling();
        deviceRef.current = null;
        setDeviceIdentity(null);   // l'identità sarà riletta da 0xaa05 al reconnect
        // #35: lo stream del sensore ruota è relayato dal device principale →
        // alla sua disconnessione il wheel non è più "connesso" (evita stato
        // stantio nella UI). Il freshness-timeout viene annullato.
        if (wheelFreshRef.current) { clearTimeout(wheelFreshRef.current); wheelFreshRef.current = null; }
        setWheelSensorStatus('idle');
        setWheelSensorId(null);
        setBleStatus('scanning');
        startScan();
      });
    } catch {
      setBleStatus('error');
    }
  }

  // ── Scrittura orologio UTC → ESP32 (TIME 0xaa10, v0.3.0) ───────────────────
  // uint64 epochMs little-endian, ESATTAMENTE 8 byte. Scritto come due word LE
  // (evita dipendenze da BigInt/writeBigUInt64LE). Date.now() è ben oltre la
  // soglia firmware del 2020 → la WRITE è accettata; eventuali errori ATT sono
  // assorbiti (best-effort, non blocca la connessione).
  async function writeDeviceTime(device: Device): Promise<void> {
    try {
      const ms  = Date.now();
      // APP-1 (audit v0.3.1): non tentare la WRITE se il clock del telefono non
      // è valido (< 2020-01-01): eviterebbe l'errore ATT VALUE_NOT_ALLOWED e
      // lascia tUtc=0 sul device → consumer usa il fallback serverTs.
      if (ms < 1577836800000) return;
      const buf = Buffer.alloc(8);
      buf.writeUInt32LE(ms >>> 0, 0);                       // 32 bit bassi
      buf.writeUInt32LE(Math.floor(ms / 0x100000000), 4);  // 32 bit alti
      await device.writeCharacteristicWithResponseForService(
        SVC, CHR_TIME, buf.toString('base64')
      );
    } catch {}
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

  // ── Whitelist sensori → SENSOR_WHITELIST 0xaa0b (contract v0.2.0 §2) ────────
  // L'app è broker di pairing: scrive sul firmware l'elenco dei sensori
  // autorizzati (power/csc/hr). Il central del firmware si connette SOLO a
  // questi MAC. Payload: [count] + count×([type][mac0..5]) in display order
  // (mac[0]=primo ottetto del MAC, contract v0.2.3 §2).
  // I sensori senza MAC valido (es. iOS, dove l'id BLE è un UUID) vengono
  // esclusi: non possono essere inseriti nella whitelist (vedi seam #14).
  async function writeSensorWhitelist(device: Device): Promise<void> {
    try {
      const list = (await loadSensorWhitelist()).slice(0, SENSOR_WL_MAX);
      // #35: l'id del sensore ruota (per la UI "Connesso · …xxxx") viene dalla
      // whitelist autorizzata, non da una connessione diretta (l'app è broker).
      setWheelSensorId(list.find((s) => s.type === 'wheel')?.id ?? null);
      const entries: { type: number; mac: number[] }[] = [];
      for (const s of list) {
        const mac  = macToWhitelistBytes(s.id);
        const type = SENSOR_TYPE_CODE[s.type];
        if (mac && type) entries.push({ type, mac });
      }
      const buf = Buffer.alloc(1 + entries.length * 7);
      buf.writeUInt8(entries.length, 0);
      entries.forEach((e, i) => {
        buf.writeUInt8(e.type, 1 + i * 7);
        for (let j = 0; j < 6; j++) buf.writeUInt8(e.mac[j], 2 + i * 7 + j);
      });
      await device.writeCharacteristicWithResponseForService(
        SVC, CHR_SENSOR_WL, buf.toString('base64')
      );
    } catch {}
  }

  // Pubblica: ri-scrive la whitelist sul device connesso (dopo add/remove in UI)
  async function syncSensorWhitelist(): Promise<void> {
    if (deviceRef.current) await writeSensorWhitelist(deviceRef.current);
  }

  // ── Discovery sensori firmware-driven (SENSOR_SCAN 0xaa0e, v0.2.2) ─────────
  // L'app non scansiona più i sensori col proprio stack BLE (su iOS non avrebbe
  // i MAC reali). Avvia la discovery sul firmware (0x01), si iscrive alle NOTIFY
  // e accumula i candidati {type, mac, rssi, name} nello store (dedup per MAC).
  async function startSensorDiscovery(): Promise<void> {
    const dev = deviceRef.current;
    if (!dev) return;
    const { clearDiscoveredSensors, addDiscoveredSensor } = useStore.getState();
    clearDiscoveredSensors();
    try {
      sensorScanSub.current?.remove();
      sensorScanSub.current = dev.monitorCharacteristicForService(
        SVC, CHR_SENSOR_SCAN,
        (err, c) => {
          if (err || !c?.value) return;
          const s = parseSensorScanEntry(c.value);
          if (s) useStore.getState().addDiscoveredSensor(s);
        }
      );
      const buf = Buffer.alloc(1);
      buf.writeUInt8(0x01, 0);
      await dev.writeCharacteristicWithResponseForService(
        SVC, CHR_SENSOR_SCAN, buf.toString('base64')
      );
      // Safeguard lato app: il firmware auto-stoppa ~15 s, ma rimuoviamo la
      // sottoscrizione comunque per non lasciare il monitor appeso.
      if (sensorScanStop.current) clearTimeout(sensorScanStop.current);
      sensorScanStop.current = setTimeout(() => { stopSensorDiscovery().catch(() => {}); }, 15000);
    } catch {}
  }

  async function stopSensorDiscovery(): Promise<void> {
    if (sensorScanStop.current) { clearTimeout(sensorScanStop.current); sensorScanStop.current = null; }
    sensorScanSub.current?.remove();
    sensorScanSub.current = null;
    const dev = deviceRef.current;
    if (!dev) return;
    try {
      const buf = Buffer.alloc(1);
      buf.writeUInt8(0x00, 0);
      await dev.writeCharacteristicWithResponseForService(
        SVC, CHR_SENSOR_SCAN, buf.toString('base64')
      );
    } catch {}
  }

  // WHEEL_CMD 0xaa0d: inoltra il comando coast-down al sensore ruota via firmware
  async function sendWheelCommand(cmd: number): Promise<boolean> {
    if (!deviceRef.current) return false;
    try {
      const buf = Buffer.alloc(1);
      buf.writeUInt8(cmd, 0);
      await deviceRef.current.writeCharacteristicWithResponseForService(
        SVC, CHR_WHEEL_CMD, buf.toString('base64')
      );
      return true;
    } catch {
      return false;
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

        if (confirmedNativeIdRef.current) {
          // Device già confermato in precedenza: fast-path sul device.id
          // nativo (vale anche su iOS, dove è un UUID stabile per-installazione).
          if (device.id !== confirmedNativeIdRef.current) return;
        } else {
          if (rejectedIdsRef.current.has(device.id)) return;
          // NESSUN pre-filtro per MAC qui: `device.id` è l'id di trasporto BLE,
          // platform-specific, e NON è l'identità (CONTRACT §2 v0.1.4). Su iOS è
          // un UUID; su Android l'adv MAC dell'ESP32 = MAC identità +2, quindi un
          // confronto col MAC del QR scarterebbe sempre il device giusto. Ci si
          // connette a ogni candidato col service-UUID corretto e si verifica
          // l'identità leggendo `IDENTITY 0xaa05` in connect() (che tiene la
          // connessione solo se `== MAC del QR`, altrimenti → rejectedIdsRef).
        }

        manager.current?.stopDeviceScan();
        connect(device);
      }
    );
  }

  // ── Simulazione ────────────────────────────────────────────────────────────
  function startSimulation() {
    setBleStatus('connected');
    // In sim mode anche il sensore ruota è "connesso": lo stream Crr è
    // sintetizzato qui (in produzione arriva dal firmware via 0xaa0c).
    setWheelSensorStatus('connected');
    let t = 0;
    let coastV = 0;   // velocità ruota durante il coast-down (sim Crr)
    tickRef.current = setInterval(() => {
      t += 0.1;
      const speedMs = 10 + Math.sin(t * 0.15) * 2;
      updateSensors({
        pitotPa:    35 + Math.sin(t * 0.3) * 10,
        staticPa:   101325,
        tempC:      22 + Math.sin(t * 0.1) * 2,
        humidity:   0.5,
        altM:       150,
        pitchDeg:   Math.sin(t * 0.05) * 3,
        rollDeg:    0,
        powerW:     250 + Math.sin(t * 0.2) * 50,
        speedMs,
        cadenceRpm: 90 + Math.round(Math.sin(t * 0.1) * 5),
        hrBpm:      140 + Math.round(Math.sin(t * 0.07) * 10),
      });

      // Sensore ruota: durante un coast-down la velocità decade fisicamente
      // (a = -(crr·g + k_aero·v²)), così la calibrazione Crr è completabile in
      // sim e il fit recupera crr≈0.004; altrimenti gira alla velocità nominale.
      const mode = useStore.getState().crrCalib.mode;
      const coasting = mode === 'coast_indoor' || mode === 'coast_outdoor_a' || mode === 'coast_outdoor_b';
      let wheelV: number;
      let wheelA: number;
      if (coasting) {
        if (coastV <= 0) {
          coastV = Math.max(6, (useStore.getState().crrCalib.targetSpeedKmh || 30) / 3.6);
        }
        wheelA = -(0.004 * 9.80665 + 0.00015 * coastV * coastV);
        coastV = Math.max(0, coastV + wheelA * 0.1);
        wheelV = coastV;
      } else {
        coastV = 0;
        wheelV = speedMs;
        wheelA = -(0.004 * 9.80665 + 0.00015 * speedMs * speedMs);
      }
      updateWheelStream({
        speedMs:  wheelV,
        accelMs2: wheelA,
        tempC:    22 + Math.sin(t * 0.05),
        vibRMS:   0.15 + Math.abs(Math.sin(t * 0.4)) * 0.05,
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
      if (wheelFreshRef.current) clearTimeout(wheelFreshRef.current);
      if (sensorScanStop.current) clearTimeout(sensorScanStop.current);
      sensorScanSub.current?.remove();
      sensorScanSub.current = null;
      manager.current?.destroy();
      manager.current = null;
    };
  }, [isSimMode]);

  // Registra le funzioni reali nell'API a livello modulo (per gli screen).
  // In un effect (non nel corpo del render): le funzioni chiudono solo su ref
  // stabili e useStore.getState(), quindi basta registrarle al mount.
  useEffect(() => {
    bleApi.syncSensorWhitelist  = syncSensorWhitelist;
    bleApi.sendWheelCommand     = sendWheelCommand;
    bleApi.startSensorDiscovery = startSensorDiscovery;
    bleApi.stopSensorDiscovery  = stopSensorDiscovery;
  }, []);

  return { syncConfigToDevice, syncSensorWhitelist, sendWheelCommand };
}