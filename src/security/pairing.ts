/**
 * pairing.ts
 * Gestione pairing multi-device: device principale AeroDrag, sensore ruota, fascia HR.
 *
 * Ogni device ha il proprio slot di storage separato.
 * La fascia HR può essere un device AeroDrag proprietario oppure qualsiasi
 * monitor cardiaco con BLE Heart Rate Service standard (Garmin, Wahoo, Polar…).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PAIRED_MAIN  = 'aerodrag:paired_device_id';
const KEY_PAIRED_WHEEL = 'aerodrag:paired_wheel_id';
const KEY_PAIRED_HR    = 'aerodrag:paired_hr_id';
const KEY_PAIRED_HR_TYPE = 'aerodrag:paired_hr_type';

export interface PairedDevice {
  id:       string;    // MAC address BLE
  name:     string;    // nome human-readable
  pairedAt: number;    // timestamp Unix ms
}

/** Tipo di device HR: fascia AeroDrag con IMU oppure monitor standard di terze parti */
export type HRDeviceType = 'aerodrag' | 'standard';

export interface SensorEntry {
  id:   string;
  name: string;
  type: 'power' | 'csc' | 'hr';
}

// ── Device AeroDrag principale ────────────────────────────────────────────────

export async function savePairedDevice(device: PairedDevice): Promise<void> {
  await AsyncStorage.setItem(KEY_PAIRED_MAIN, JSON.stringify(device));
}

export async function loadPairedDevice(): Promise<PairedDevice | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PAIRED_MAIN);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function unpairDevice(): Promise<void> {
  await AsyncStorage.removeItem(KEY_PAIRED_MAIN);
}

// ── Sensore IMU mozzo (AeroDrag-Wheel) ───────────────────────────────────────

export async function savePairedWheel(device: PairedDevice): Promise<void> {
  await AsyncStorage.setItem(KEY_PAIRED_WHEEL, JSON.stringify(device));
}

export async function loadPairedWheel(): Promise<PairedDevice | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PAIRED_WHEEL);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function unpairWheel(): Promise<void> {
  await AsyncStorage.removeItem(KEY_PAIRED_WHEEL);
}

// ── Fascia HR+IMU o monitor HR standard ──────────────────────────────────────

export async function savePairedHR(device: PairedDevice, hrType: HRDeviceType): Promise<void> {
  await AsyncStorage.multiSet([
    [KEY_PAIRED_HR,      JSON.stringify(device)],
    [KEY_PAIRED_HR_TYPE, hrType],
  ]);
}

export async function loadPairedHR(): Promise<{ device: PairedDevice; hrType: HRDeviceType } | null> {
  try {
    const [[, rawDevice], [, rawType]] = await AsyncStorage.multiGet([
      KEY_PAIRED_HR, KEY_PAIRED_HR_TYPE,
    ]);
    if (!rawDevice) return null;
    const device: PairedDevice = JSON.parse(rawDevice);
    const hrType: HRDeviceType = (rawType as HRDeviceType) ?? 'standard';
    return { device, hrType };
  } catch {
    return null;
  }
}

export async function unpairHR(): Promise<void> {
  await AsyncStorage.multiRemove([KEY_PAIRED_HR, KEY_PAIRED_HR_TYPE]);
}

// ── Validazione QR code device principale ────────────────────────────────────
// Formato: "aerodrag://pair?id=XX:XX:XX:XX:XX:XX&name=AeroDrag%20001"

export function parseDeviceQR(qrData: string): PairedDevice | null {
  try {
    const url  = new URL(qrData);
    const id   = url.searchParams.get('id');
    const name = url.searchParams.get('name') ?? 'AeroDrag';
    if (!id || !isValidMAC(id)) return null;
    return { id, name, pairedAt: Date.now() };
  } catch {
    return null;
  }
}

function isValidMAC(mac: string): boolean {
  return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac);
}

// ── Whitelist sensori ANT+ legacy (power meter, CSC) ─────────────────────────

const KEY_SENSOR_WHITELIST = 'aerodrag:sensor_whitelist';

export async function loadSensorWhitelist(): Promise<SensorEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SENSOR_WHITELIST);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addSensorToWhitelist(entry: SensorEntry): Promise<void> {
  const list     = await loadSensorWhitelist();
  const filtered = list.filter(s => s.type !== entry.type);
  await AsyncStorage.setItem(KEY_SENSOR_WHITELIST, JSON.stringify([...filtered, entry]));
}

export async function removeSensorFromWhitelist(id: string): Promise<void> {
  const list = await loadSensorWhitelist();
  await AsyncStorage.setItem(KEY_SENSOR_WHITELIST, JSON.stringify(list.filter(s => s.id !== id)));
}

export async function clearSensorWhitelist(): Promise<void> {
  await AsyncStorage.removeItem(KEY_SENSOR_WHITELIST);
}
