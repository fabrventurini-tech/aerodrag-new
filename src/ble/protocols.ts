/**
 * BLE protocol definitions per tutti i device AeroDrag + standard HR di terze parti.
 *
 * Convenzione UUID:
 *   0x...aa00  → Device principale AeroDrag (ESP32, esistente)
 *   0x...bb00  → Sensore IMU mozzo (AeroDrag-Wheel, nRF52840)
 *   0x...cc00  → Fascia HR+IMU (AeroDrag-HR, nRF52840)
 *   0x180D     → Standard BLE Heart Rate Service (Garmin/Wahoo/Polar/generici)
 */

import { Buffer } from 'buffer';

// ── Service UUIDs ─────────────────────────────────────────────────────────────

export const MAIN_SVC   = '0000aa00-0000-1000-8000-00805f9b34fb';
export const WHEEL_SVC  = '0000bb00-0000-1000-8000-00805f9b34fb';
export const HRBAND_SVC = '0000cc00-0000-1000-8000-00805f9b34fb';
/** BLE Heart Rate Service standard (GATT org.bluetooth.service.heart_rate) */
export const STD_HR_SVC = '0000180d-0000-1000-8000-00805f9b34fb';

// ── Device principale — caratteristiche ──────────────────────────────────────
// Invarianti rispetto al firmware ESP32 esistente.

export const MAIN_PITOT    = '0000aa01-0000-1000-8000-00805f9b34fb';
export const MAIN_IMU      = '0000aa02-0000-1000-8000-00805f9b34fb';
export const MAIN_ENV      = '0000aa03-0000-1000-8000-00805f9b34fb';
export const MAIN_SENSORS  = '0000aa04-0000-1000-8000-00805f9b34fb';
export const MAIN_IDENTITY = '0000aa05-0000-1000-8000-00805f9b34fb';

// ── Sensore IMU mozzo (AeroDrag-Wheel) — caratteristiche ─────────────────────
// NOTIFY float32×6 (24 B): ax, ay, az [g], gx, gy, gz [°/s] @ 50 Hz
export const WHEEL_IMU   = '0000bb01-0000-1000-8000-00805f9b34fb';
// NOTIFY float32×3 + uint16 (14 B): speedMs, decelMs2, tempC, vibIdx @ 10 Hz
export const WHEEL_STATE = '0000bb02-0000-1000-8000-00805f9b34fb';
// READ uint8: batteria %
export const WHEEL_BATT  = '0000bb03-0000-1000-8000-00805f9b34fb';
// READ/WRITE uint16 circumMm + 18 B deviceId
export const WHEEL_CFG   = '0000bb04-0000-1000-8000-00805f9b34fb';

// ── Fascia HR+IMU (AeroDrag-HR) — caratteristiche ────────────────────────────
// NOTIFY uint8 bpm + uint16×8 rrMs[8] (17 B) @ 1 Hz
export const HRBAND_HR   = '0000cc01-0000-1000-8000-00805f9b34fb';
// NOTIFY float32×4 (16 B): pitchDeg, rollDeg, lateralOscMm, respBreathMin @ 10 Hz
export const HRBAND_IMU  = '0000cc02-0000-1000-8000-00805f9b34fb';
// NOTIFY float32×3 (12 B): skinTempC, pressurePa, altM @ 1 Hz
export const HRBAND_ENV  = '0000cc03-0000-1000-8000-00805f9b34fb';
// READ uint8: batteria %
export const HRBAND_BATT = '0000cc04-0000-1000-8000-00805f9b34fb';
// READ/WRITE name[32] + deviceId[18]
export const HRBAND_CFG  = '0000cc05-0000-1000-8000-00805f9b34fb';

// ── Standard BLE HR — caratteristiche ────────────────────────────────────────
// NOTIFY flags(1) + bpm(1|2) + ee(0|2) + rr[0..n×2]
export const STD_HR_MEAS = '00002a37-0000-1000-8000-00805f9b34fb';
// READ uint8 body location
export const STD_HR_LOC  = '00002a38-0000-1000-8000-00805f9b34fb';

// ── Parser device principale ──────────────────────────────────────────────────

export function parseMainPitot(b64: string): { pitotPa: number; staticPa: number } {
  const buf = Buffer.from(b64, 'base64');
  return { pitotPa: buf.readFloatLE(0), staticPa: buf.readFloatLE(4) };
}

export function parseMainIMU(b64: string): { pitchDeg: number; rollDeg: number } {
  const buf = Buffer.from(b64, 'base64');
  return { pitchDeg: buf.readFloatLE(0), rollDeg: buf.readFloatLE(4) };
}

export function parseMainEnv(b64: string): {
  tempC: number; humidity: number; altM: number; speedMs: number;
} {
  const buf = Buffer.from(b64, 'base64');
  return {
    tempC:    buf.readFloatLE(0),
    humidity: buf.readFloatLE(4) / 100,  // firmware invia 0–100
    altM:     buf.readFloatLE(8),
    speedMs:  buf.readFloatLE(12),
  };
}

export function parseMainSensors(b64: string): {
  powerW: number; cadenceRpm: number; hrBpm: number;
} {
  const buf = Buffer.from(b64, 'base64');
  return {
    powerW:     buf.readUInt16LE(0),
    cadenceRpm: buf.readUInt8(2),
    hrBpm:      buf.readUInt8(3),
  };
}

// ── Parser IMU mozzo ──────────────────────────────────────────────────────────

export interface WheelImuPacket {
  ax: number; ay: number; az: number;
  gx: number; gy: number; gz: number;
}

export function parseWheelImu(b64: string): WheelImuPacket {
  const buf = Buffer.from(b64, 'base64');
  return {
    ax: buf.readFloatLE(0),  ay: buf.readFloatLE(4),  az: buf.readFloatLE(8),
    gx: buf.readFloatLE(12), gy: buf.readFloatLE(16), gz: buf.readFloatLE(20),
  };
}

export interface WheelStatePacket {
  speedMs: number;
  decelMs2: number;
  tempC: number;
  vibrationIndex: number;
}

export function parseWheelState(b64: string): WheelStatePacket {
  const buf = Buffer.from(b64, 'base64');
  return {
    speedMs:        buf.readFloatLE(0),
    decelMs2:       buf.readFloatLE(4),
    tempC:          buf.readFloatLE(8),
    vibrationIndex: buf.readUInt16LE(12),
  };
}

// ── Parser fascia HR+IMU ──────────────────────────────────────────────────────

export interface HRBandHRPacket {
  hrBpm: number;
  rrMs: number[];
}

export function parseHRBandHR(b64: string): HRBandHRPacket {
  const buf   = Buffer.from(b64, 'base64');
  const hrBpm = buf.readUInt8(0);
  const rrMs: number[] = [];
  for (let i = 0; i < 8; i++) {
    const rr = buf.readUInt16LE(1 + i * 2);
    // Plausibilità: 20–300 bpm → 200–3000 ms
    if (rr > 200 && rr < 3000) rrMs.push(rr);
  }
  return { hrBpm, rrMs };
}

export interface HRBandImuPacket {
  pitchDeg: number;
  rollDeg: number;
  lateralOscMm: number;
  respBreathMin: number;
}

export function parseHRBandImu(b64: string): HRBandImuPacket {
  const buf = Buffer.from(b64, 'base64');
  return {
    pitchDeg:      buf.readFloatLE(0),
    rollDeg:       buf.readFloatLE(4),
    lateralOscMm:  buf.readFloatLE(8),
    respBreathMin: buf.readFloatLE(12),
  };
}

export interface HRBandEnvPacket {
  skinTempC: number;
  pressurePa: number;
  altM: number;
}

export function parseHRBandEnv(b64: string): HRBandEnvPacket {
  const buf = Buffer.from(b64, 'base64');
  return {
    skinTempC:  buf.readFloatLE(0),
    pressurePa: buf.readFloatLE(4),
    altM:       buf.readFloatLE(8),
  };
}

// ── Parser standard BLE HR (Garmin, Wahoo, Polar, Bryton…) ───────────────────

export interface StdHRPacket {
  hrBpm: number;
  rrMs: number[];
}

export function parseStdHR(b64: string): StdHRPacket {
  const buf   = Buffer.from(b64, 'base64');
  const flags = buf.readUInt8(0);
  const is16  = (flags & 0x01) !== 0;
  const hasEE = (flags & 0x08) !== 0;
  const hasRR = (flags & 0x10) !== 0;

  let offset  = 1;
  const hrBpm = is16 ? buf.readUInt16LE(offset) : buf.readUInt8(offset);
  offset += is16 ? 2 : 1;
  if (hasEE) offset += 2; // energy expended, non usato

  const rrMs: number[] = [];
  if (hasRR) {
    // Standard BLE: unità = 1/1024 secondi
    while (offset + 2 <= buf.length) {
      const rr1024 = buf.readUInt16LE(offset);
      const rrMsVal = Math.round((rr1024 / 1024) * 1000);
      if (rrMsVal > 200 && rrMsVal < 3000) rrMs.push(rrMsVal);
      offset += 2;
    }
  }
  return { hrBpm, rrMs };
}

// ── HRV — RMSSD ──────────────────────────────────────────────────────────────
// Root Mean Square of Successive Differences degli intervalli RR.
// Indice parasimpatico standard, alto = buona recovery, basso = fatica/stress.

export function computeRMSSD(rrMs: number[]): number {
  if (rrMs.length < 2) return 0;
  let sumSq = 0;
  for (let i = 1; i < rrMs.length; i++) {
    const d = rrMs[i] - rrMs[i - 1];
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (rrMs.length - 1));
}
