/**
 * pairing.ts
 * Gestione del pairing tra app e device AeroDrag.
 *
 * Meccanismo (contract v0.1.4/v0.2.0 §2):
 *   1. L'utente scansiona il QR sul device → contiene SOLO il MAC
 *      (`AERODRAG://PAIR/<MAC>`). Nessun challenge crittografico.
 *   2. L'app salva il MAC in AsyncStorage (whitelist: quale device accoppiare).
 *   3. useBLE conferma il device leggendo l'identità da IDENTITY `0xaa05` e
 *      verificando che coincida col MAC del QR (iOS-safe: l'id di connessione
 *      BLE è un UUID, non il MAC).
 *
 * NOTA sicurezza: allo stato attuale NON è implementato alcun bonding/cifratura
 * a livello link né alcun challenge nel QR. Il QR è solo la sorgente del MAC
 * autorevole; il filtro MAC riduce le connessioni accidentali ma non è una
 * misura anti-sniffing.
 *
 * Sensori esterni (potenza/CSC/HR/ruota Crr) — modello broker (contract v0.2.0+):
 *   - I sensori si bondano SOLO al firmware del device, non all'app.
 *   - L'app è BROKER di pairing: la scoperta la fa il firmware (SENSOR_SCAN
 *     0xaa0e), l'utente sceglie e l'app scrive i MAC autorizzati nella whitelist
 *     del firmware (SENSOR_WHITELIST 0xaa0b, `SensorEntry` type 4 per la ruota Crr).
 *   - L'app NON apre connessioni dati ai sensori: i dati arrivano relayati dal
 *     firmware (es. ruota Crr su WHEEL_STREAM 0xaa0c, servizio custom 0xBB00 lato
 *     sensore — NON il profilo CSC standard).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PAIRED_DEVICE    = 'aerodrag:paired_device_id';
const KEY_PAIRED_NAME      = 'aerodrag:paired_device_name';
const KEY_SENSOR_WHITELIST = 'aerodrag:sensor_whitelist';

export interface PairedDevice {
  id:   string;   // MAC address BLE del device AeroDrag
  name: string;   // nome human-readable (es. "AeroDrag #001")
  pairedAt: number; // timestamp Unix
}

export interface SensorEntry {
  id:   string;   // MAC address sensore BLE (power meter, CSC, HR, ruota Crr)
  name: string;   // nome sensore
  type: 'power' | 'csc' | 'hr' | 'wheel';
}

// ── Device AeroDrag principale ────────────────────────────────────────────────

export async function savePairedDevice(device: PairedDevice): Promise<void> {
  await AsyncStorage.setItem(KEY_PAIRED_DEVICE, JSON.stringify(device));
}

export async function loadPairedDevice(): Promise<PairedDevice | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PAIRED_DEVICE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function unpairDevice(): Promise<void> {
  await AsyncStorage.multiRemove([KEY_PAIRED_DEVICE, KEY_PAIRED_NAME]);
}

// ── Whitelist sensori BLE (power meter, CSC, HR) ──────────────────────────────
// Impedisce che il device si agganci ai sensori di un atleta vicino.

export async function loadSensorWhitelist(): Promise<SensorEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SENSOR_WHITELIST);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addSensorToWhitelist(entry: SensorEntry): Promise<void> {
  const list = await loadSensorWhitelist();
  // Sostituisce se esiste già un sensore dello stesso tipo
  const filtered = list.filter((s) => s.type !== entry.type);
  await AsyncStorage.setItem(
    KEY_SENSOR_WHITELIST,
    JSON.stringify([...filtered, entry])
  );
}

export async function removeSensorFromWhitelist(id: string): Promise<void> {
  const list = await loadSensorWhitelist();
  await AsyncStorage.setItem(
    KEY_SENSOR_WHITELIST,
    JSON.stringify(list.filter((s) => s.id !== id))
  );
}

export async function clearSensorWhitelist(): Promise<void> {
  await AsyncStorage.removeItem(KEY_SENSOR_WHITELIST);
}

// ── Sensore ruota Crr — gestito via whitelist firmware ────────────────────────
// Il sensore ruota è un `SensorEntry` di type 'wheel' nella whitelist (0xaa0b),
// scoperto via SENSOR_SCAN 0xaa0e e brokerato dal firmware (servizio custom
// 0xBB00 lato sensore, NON CSC standard). Il vecchio store locale dedicato
// (`WheelSensorDevice` + chiavi `wheel_sensors`/`wheel_active_id`) è stato rimosso
// in quanto codice morto dopo il modello broker v0.2.0/v0.2.2 (#35).

// ── Cadence sensor — pairing non esclusivo ────────────────────────────────────
//
// Compatibile con qualsiasi sensore BLE CSC (0x1816) che supporti Crank
// Revolution Data (bit1 di CSC Feature): Wahoo RPM Cadence, Garmin Cadence,
// 4iiii, Polar, Stages, nonché il sensore AeroDrag Cadence proprietario.
// Lo stesso meccanismo del wheel sensor: lista + active ID.

const KEY_CADENCE_SENSORS   = 'aerodrag:cadence_sensors';
const KEY_CADENCE_ACTIVE_ID = 'aerodrag:cadence_active_id';

export interface CadenceSensorDevice {
  id:        string;
  name:      string;
  pairedAt:  number;
  firmware?: string;
  bikeLabel?: string;
}

export async function loadCadenceSensorList(): Promise<CadenceSensorDevice[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CADENCE_SENSORS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveCadenceSensor(device: CadenceSensorDevice): Promise<void> {
  const list = await loadCadenceSensorList();
  const idx  = list.findIndex((s) => s.id === device.id);
  const next = idx >= 0
    ? list.map((s) => (s.id === device.id ? device : s))
    : [...list, device];
  await AsyncStorage.setItem(KEY_CADENCE_SENSORS, JSON.stringify(next));
}

export async function removeCadenceSensor(id: string): Promise<void> {
  const list = await loadCadenceSensorList();
  const next = list.filter((s) => s.id !== id);
  await AsyncStorage.setItem(KEY_CADENCE_SENSORS, JSON.stringify(next));
  const activeId = await loadActiveCadenceSensorId();
  if (activeId === id) await AsyncStorage.removeItem(KEY_CADENCE_ACTIVE_ID);
}

export async function loadActiveCadenceSensorId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_CADENCE_ACTIVE_ID);
  } catch {
    return null;
  }
}

export async function setActiveCadenceSensorId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(KEY_CADENCE_ACTIVE_ID, id);
  else    await AsyncStorage.removeItem(KEY_CADENCE_ACTIVE_ID);
}

export async function loadPreferredCadenceSensor(): Promise<CadenceSensorDevice | null> {
  const list     = await loadCadenceSensorList();
  if (list.length === 0) return null;
  const activeId = await loadActiveCadenceSensorId();
  return list.find((s) => s.id === activeId) ?? list[0];
}

// ── Validazione QR code device ────────────────────────────────────────────────
// Formati supportati:
//   1. "aerodrag://pair?id=XX:XX:XX:XX:XX:XX&name=AeroDrag%20001"  (app standard)
//   2. "AERODRAG://PAIR/XX:XX:XX:XX:XX:XX"                         (firmware ESP32)

export function parseDeviceQR(qrData: string): PairedDevice | null {
  try {
    const normalized = qrData.trim();

    // Formato firmware: AERODRAG://PAIR/<MAC>
    const firmwareMatch = normalized
      .toUpperCase()
      .match(/^AERODRAG:\/\/PAIR\/([0-9A-F]{2}(?::[0-9A-F]{2}){5})$/);
    if (firmwareMatch) {
      const id = firmwareMatch[1].toUpperCase();
      return { id, name: 'AeroDrag', pairedAt: Date.now() };
    }

    // Formato standard: aerodrag://pair?id=<MAC>&name=<name>
    const url  = new URL(normalized);
    const id   = url.searchParams.get('id');
    const name = url.searchParams.get('name') ?? 'AeroDrag';
    if (!id || !isValidMAC(id)) return null;

    return { id: id.toUpperCase(), name, pairedAt: Date.now() };
  } catch {
    return null;
  }
}

export function isValidMAC(mac: string): boolean {
  return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac);
}

// ── Whitelist sensori firmware (contract v0.2.0 §2, BLE 0xaa0b) ──────────────
// L'elenco SensorEntry (power/csc/hr) NON è più vestigiale: è la sorgente
// autorevole della whitelist scritta sul firmware via 0xaa0b. Il central del
// firmware si connette SOLO ai MAC autorizzati (anti cross-talk); l'app non
// apre più connessioni dati ai sensori (broker di pairing).
export const SENSOR_WL_MAX = 5;   // come SENSOR_WL_MAX lato firmware

// Codici tipo del wire 0xaa0b: 1=power, 2=csc, 3=hr, 4=wheel
export const SENSOR_TYPE_CODE: Record<SensorEntry['type'], number> = {
  power: 1,
  csc:   2,
  hr:    3,
  wheel: 4,
};

// Mappa inversa per il parsing delle entry di SENSOR_SCAN 0xaa0e (v0.2.2)
export const SENSOR_TYPE_FROM_CODE: Record<number, SensorEntry['type']> = {
  1: 'power',
  2: 'csc',
  3: 'hr',
  4: 'wheel',
};

// Sensore scoperto dalla discovery firmware-driven (SENSOR_SCAN 0xaa0e, v0.2.2):
// il MAC arriva dal firmware (che vede i MAC reali) → funziona anche su iOS.
export interface DiscoveredSensor {
  type: SensorEntry['type'];
  mac:  string;   // "AA:BB:CC:DD:EE:FF"
  name: string;
  rssi: number;
}

// Converte "AA:BB:CC:DD:EE:FF" nei 6 byte in DISPLAY ORDER attesi dal firmware
// (contract v0.2.3 §2): mac[0] = primo ottetto (0xAA), mac[5] = ultimo (0xFF).
// NON è l'ordine little-endian dello stack BLE (il firmware converte internamente).
// Ritorna null se non è un MAC valido — es. su iOS, dove l'id di connessione BLE
// è un UUID e non il MAC hardware.
export function macToWhitelistBytes(mac: string): number[] | null {
  if (!isValidMAC(mac)) return null;
  return mac.split(':').map((h) => parseInt(h, 16));
}