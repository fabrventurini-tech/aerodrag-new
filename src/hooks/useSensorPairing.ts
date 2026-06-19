/**
 * useSensorPairing.ts — scansione BLE per il PAIRING dei sensori esterni.
 *
 * Contract v0.2.0 §2: i sensori esterni (power 0x1818, CSC 0x1816, HR 0x180D)
 * si bondano SOLO al firmware. L'app è broker di pairing: scansiona per far
 * SCEGLIERE il sensore all'utente, ne ricava il MAC e lo scrive nella whitelist
 * del firmware (CHR 0xaa0b via useBLE). Qui NON si apre alcuna connessione dati:
 * si fa solo discovery dall'advertisement.
 *
 * Nota iOS: react-native-ble-plx espone `device.id` che su iOS è un UUID
 * CoreBluetooth, NON il MAC hardware. Il MAC è disponibile solo su Android;
 * su iOS il sensore non è inseribile in whitelist da qui (vedi seam #14).
 */

import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import { SensorEntry } from '../security/pairing';

const SVC_POWER = '00001818-0000-1000-8000-00805f9b34fb';
const SVC_CSC   = '00001816-0000-1000-8000-00805f9b34fb';
const SVC_HR    = '0000180d-0000-1000-8000-00805f9b34fb';
const SVC_WHEEL = '0000bb00-0000-1000-8000-00805f9b34fb';   // sensore ruota Crr

export type SensorKind = SensorEntry['type'];   // 'power' | 'csc' | 'hr' | 'wheel'

export interface DiscoveredSensor {
  id:   string;          // device.id (MAC su Android, UUID su iOS)
  name: string;
  type: SensorKind;
}

function typeFromServices(uuids: string[] | null): SensorKind | null {
  if (!uuids) return null;
  const lower = uuids.map((u) => u.toLowerCase());
  if (lower.includes(SVC_POWER)) return 'power';
  if (lower.includes(SVC_WHEEL)) return 'wheel';   // prima di CSC: il sensore ruota espone anche 0x1816
  if (lower.includes(SVC_CSC))   return 'csc';
  if (lower.includes(SVC_HR))    return 'hr';
  return null;
}

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(results).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const r = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

// API a livello modulo: gestisce un BleManager dedicato solo durante la
// finestra di scansione del pairing (creato a startScan, distrutto a stopScan).
class SensorPairingScanner {
  private manager: BleManager | null = null;
  private seen = new Set<string>();

  async startScan(onFound: (s: DiscoveredSensor) => void, onError?: (e: string) => void): Promise<void> {
    const ok = await requestPermissions();
    if (!ok) { onError?.('Permessi BLE non concessi'); return; }
    this.stopScan();
    this.seen.clear();
    this.manager = new BleManager();
    this.manager.startDeviceScan(
      [SVC_POWER, SVC_CSC, SVC_HR, SVC_WHEEL],
      { allowDuplicates: false },
      (err: Error | null, device: Device | null) => {
        if (err) { onError?.(err.message); return; }
        if (!device || this.seen.has(device.id)) return;
        const type = typeFromServices(device.serviceUUIDs);
        if (!type) return;   // servizio non riconosciuto fra i tre supportati
        this.seen.add(device.id);
        onFound({
          id:   device.id,
          name: device.name ?? device.localName ?? `Sensore ${device.id.slice(-5)}`,
          type,
        });
      }
    );
  }

  stopScan(): void {
    if (this.manager) {
      try { this.manager.stopDeviceScan(); } catch {}
      try { this.manager.destroy(); } catch {}
      this.manager = null;
    }
  }
}

export const sensorPairing = new SensorPairingScanner();
