/**
 * pairing.ts
 * Gestione pairing sicuro tra app e device AeroDrag.
 *
 * Meccanismo:
 *   1. L'utente scansiona il QR sul device (contiene deviceId + challenge)
 *   2. L'app salva il deviceId in AsyncStorage
 *   3. useBLE si connette SOLO al deviceId salvato (whitelist MAC)
 *   4. BLE bonding garantisce che i dati siano cifrati AES-CCM
 *
 * Anti-sniffing:
 *   - Il filtro MAC impedisce connessioni a device non accoppiati
 *   - I dati BLE sono cifrati a livello link (BLE 4.2+ con bonding)
 *   - Il device ESP32 accetta connessioni solo dal MAC dell'app accoppiata
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PAIRED_DEVICE   = 'aerodrag:paired_device_id';
const KEY_PAIRED_NAME     = 'aerodrag:paired_device_name';
const KEY_SENSOR_WHITELIST = 'aerodrag:sensor_whitelist';

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

// ── Validazione QR code device ────────────────────────────────────────────────
// Il QR contiene: "aerodrag://pair?id=XX:XX:XX:XX:XX:XX&name=AeroDrag%20001"

export function parseDeviceQR(qrData: string): PairedDevice | null {
  try {
    const url    = new URL(qrData);
    const id     = url.searchParams.get('id');
    const name   = url.searchParams.get('name') ?? 'AeroDrag';

    if (!id || !isValidMAC(id)) return null;

    return { id, name, pairedAt: Date.now() };
  } catch {
    return null;
  }
}

function isValidMAC(mac: string): boolean {
  return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac);
}