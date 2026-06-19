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
 * Wheel sensor (sensore ruota Crr):
 *   - Pairing NON esclusivo: il sensore ruota usa BLE aperto senza bonding
 *   - Qualsiasi app compatibile (Wahoo, Garmin, Strava) può leggere il profilo CSC standard
 *   - L'app AeroDrag salva un "sensore preferito" per riconnettersi automaticamente
 *   - Ma non blocca altri device dal leggere il sensore
 *   - Il sensore può essere accoppiato a più app contemporaneamente
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PAIRED_DEVICE    = 'aerodrag:paired_device_id';
const KEY_PAIRED_NAME      = 'aerodrag:paired_device_name';
const KEY_SENSOR_WHITELIST = 'aerodrag:sensor_whitelist';
const KEY_WHEEL_SENSORS    = 'aerodrag:wheel_sensors';      // lista sensori ruota
const KEY_WHEEL_ACTIVE_ID  = 'aerodrag:wheel_active_id';   // ID del sensore preferito
// KEY_WHEEL_SENSOR (legacy, singolo) letto in migrazione automatica
const KEY_WHEEL_SENSOR_OLD = 'aerodrag:wheel_sensor';

export interface PairedDevice {
  id:   string;   // MAC address BLE del device AeroDrag
  name: string;   // nome human-readable (es. "AeroDrag #001")
  pairedAt: number; // timestamp Unix
}

export interface SensorEntry {
  id:   string;   // MAC address sensore BLE (power meter, CSC, HR)
  name: string;   // nome sensore
  type: 'power' | 'csc' | 'hr';
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

// ── Wheel sensor (sensore ruota Crr) — pairing non esclusivo e MULTIPLO ──────
//
// Design:
//   - L'app mantiene una LISTA di sensori ruota registrati (per bici diverse)
//   - Uno dei sensori è "attivo" → l'app lo preferisce durante la scan
//   - Il sensore firmware accetta fino a 3 centrali simultanei (MAX_PRPH_CONNECTIONS)
//   - Non c'è bonding → qualsiasi app (Wahoo, Garmin, coach, atleta) si connette
//   - Lato app, la lista serve solo come "memoria" per identificare rapidamente
//     un sensore già visto — non è un filtro di sicurezza
//
// Casi d'uso multi-sensore:
//   • Atleta con 2 bici → sensore ruota A (bici strada) + B (bici crono)
//   • Team con più atleti → ogni atleta ha il suo sensore, il coach switcha
//   • Coaching remoto → coach e atleta connettono entrambi allo stesso sensore

export interface WheelSensorDevice {
  id:        string;   // MAC address BLE
  name:      string;   // es. "Wheel Bici Strada", "Wheel Bici Crono"
  pairedAt:  number;   // timestamp Unix
  firmware?: string;
  bikeLabel?: string;  // etichetta opzionale (es. "Factor O2", "Cervélo P5")
}

// Carica tutta la lista (con migrazione automatica dal formato legacy singolo)
export async function loadWheelSensorList(): Promise<WheelSensorDevice[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_WHEEL_SENSORS);
    if (raw) return JSON.parse(raw) as WheelSensorDevice[];

    // Migrazione: se esiste il vecchio formato singolo, lo importa nella lista
    const legacy = await AsyncStorage.getItem(KEY_WHEEL_SENSOR_OLD);
    if (legacy) {
      const device = JSON.parse(legacy) as WheelSensorDevice;
      const list = [device];
      await AsyncStorage.setItem(KEY_WHEEL_SENSORS, JSON.stringify(list));
      await AsyncStorage.removeItem(KEY_WHEEL_SENSOR_OLD);
      return list;
    }
    return [];
  } catch {
    return [];
  }
}

// Aggiunge o aggiorna un sensore nella lista
export async function saveWheelSensor(device: WheelSensorDevice): Promise<void> {
  const list = await loadWheelSensorList();
  const idx  = list.findIndex((s) => s.id === device.id);
  const next = idx >= 0
    ? list.map((s) => (s.id === device.id ? device : s))
    : [...list, device];
  await AsyncStorage.setItem(KEY_WHEEL_SENSORS, JSON.stringify(next));
}

// Rimuove un sensore dalla lista (e resetta active se era quello attivo)
export async function removeWheelSensor(id: string): Promise<void> {
  const list = await loadWheelSensorList();
  const next = list.filter((s) => s.id !== id);
  await AsyncStorage.setItem(KEY_WHEEL_SENSORS, JSON.stringify(next));
  const activeId = await loadActiveWheelSensorId();
  if (activeId === id) await AsyncStorage.removeItem(KEY_WHEEL_ACTIVE_ID);
}

// ID del sensore attivo (preferito durante la scan)
export async function loadActiveWheelSensorId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_WHEEL_ACTIVE_ID);
  } catch {
    return null;
  }
}

export async function setActiveWheelSensorId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(KEY_WHEEL_ACTIVE_ID, id);
  else    await AsyncStorage.removeItem(KEY_WHEEL_ACTIVE_ID);
}

// Shortcut: carica il sensore attivo (o il primo della lista se nessuno attivo)
export async function loadPreferredWheelSensor(): Promise<WheelSensorDevice | null> {
  const list     = await loadWheelSensorList();
  if (list.length === 0) return null;
  const activeId = await loadActiveWheelSensorId();
  return list.find((s) => s.id === activeId) ?? list[0];
}

// Compat legacy: alias per saveWheelSensor
export async function savePreferredWheelSensor(device: WheelSensorDevice): Promise<void> {
  await saveWheelSensor(device);
  await setActiveWheelSensorId(device.id);
}

// Compat legacy: rimuove solo il sensore attivo
export async function removePreferredWheelSensor(): Promise<void> {
  const active = await loadPreferredWheelSensor();
  if (active) await removeWheelSensor(active.id);
}

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