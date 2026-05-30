/**
 * fitExport.ts — Generatore file FIT (Flexible and Interoperable Data Transfer)
 *
 * Produce file .fit validi importabili da Garmin Connect, TrainingPeaks,
 * Strava e qualsiasi software compatibile con il formato FIT.
 * Formato: FIT Protocol v2.0 / Profile v21.x (open standard ANT+).
 *
 * Messaggi generati:
 *   - file_id      (mesg_num=0):  tipo activity, produttore, timestamp creazione
 *   - record       (mesg_num=20): HR, RR interval, respiro, temperatura
 *   - hrv          (mesg_num=78): RR intervals in secondi (0.001 s per unità)
 *   - session      (mesg_num=18): riepilogo sessione
 *   - activity     (mesg_num=34): marker fine file
 *
 * Uso:
 *   const blob = generateFit(records, { athleteName: 'Mario' });
 *   // blob è un Uint8Array pronto per il salvataggio come .fit
 */

/** Record come arriva dalla fascia via sync cc06 */
export interface BandRecord {
  timestamp: number;       // Unix timestamp [s]
  hrBpm: number;           // Frequenza cardiaca [bpm]
  rrMs: number;            // Ultimo RR interval [ms]
  pitchDeg10: number;      // Pitch tronco × 10 [0.1°]
  rollDeg10: number;       // Roll tronco × 10 [0.1°]
  latOscMm10: number;      // Oscillazione laterale × 10 [0.1 mm]
  breathBpm: number;       // Frequenza respiratoria [brpm]
  flags: number;           // bit0=lead_off
}

export interface FitExportOptions {
  athleteName?: string;
  deviceName?: string;
  deviceSerial?: number;
}

// ── Costanti FIT ────────────────────────────────────────────────────────────

const FIT_EPOCH = 631065600;  // offset Unix→FIT: 1989-12-31 00:00:00 UTC
const FIT_PROTOCOL_VERSION = 0x20;  // v2.0
const FIT_PROFILE_VERSION  = 2132;  // v21.32

// Manufacturer ID: 0xFF = development/unregistered (no Garmin partnership needed)
const MANUFACTURER_ID = 0x00FF;
const PRODUCT_ID      = 0x0001;

// Message numbers
const MESG_FILE_ID  = 0;
const MESG_RECORD   = 20;
const MESG_HRV      = 78;
const MESG_SESSION  = 18;
const MESG_ACTIVITY = 34;
const MESG_LAP      = 19;

// Field definitions (field_def_num, size, base_type)
type FieldDef = [number, number, number];

// Base types
const UINT8   = 0x02;
const SINT8   = 0x01;
const UINT16  = 0x84;
const SINT16  = 0x83;
const UINT32  = 0x8C;
const SINT32  = 0x8B;

// ── CRC-16/CCITT (FIT standard) ─────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t: number[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    let crc = i;
    for (let j = 0; j < 4; j++) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xB2B0 : crc >> 1;
    }
    t[i] = crc;
  }
  return t;
})();

function fitCrc(data: Uint8Array, offset = 0, len?: number): number {
  len = len ?? data.length - offset;
  let crc = 0;
  for (let i = offset; i < offset + len; i++) {
    const b = data[i];
    crc = CRC_TABLE[(crc ^ b) & 0x0F] ^ (crc >> 4);
    crc = CRC_TABLE[(crc ^ (b >> 4)) & 0x0F] ^ (crc >> 4);
  }
  return crc;
}

// ── Writer binario ───────────────────────────────────────────────────────────

class FitWriter {
  private buf: number[] = [];

  writeU8(v: number)  { this.buf.push(v & 0xFF); }
  writeU16(v: number) { this.buf.push(v & 0xFF, (v >> 8) & 0xFF); }
  writeU32(v: number) { this.buf.push(v & 0xFF, (v>>8)&0xFF, (v>>16)&0xFF, (v>>24)&0xFF); }
  writeI16(v: number) { this.writeU16(v < 0 ? v + 65536 : v); }
  writeI32(v: number) { this.writeU32(v < 0 ? v + 4294967296 : v); }

  get length() { return this.buf.length; }

  toUint8Array(): Uint8Array { return new Uint8Array(this.buf); }

  /** Scrive definizione messaggio (local_mesg_num → global_mesg_num + fields) */
  writeDefinition(localNum: number, globalMesgNum: number, fields: FieldDef[]) {
    const headerByte = 0x40 | (localNum & 0x0F);  // definition record
    this.writeU8(headerByte);
    this.writeU8(0);   // reserved
    this.writeU8(0);   // little-endian architecture
    this.writeU16(globalMesgNum);
    this.writeU8(fields.length);
    for (const [fieldNum, size, baseType] of fields) {
      this.writeU8(fieldNum);
      this.writeU8(size);
      this.writeU8(baseType);
    }
  }

  /** Scrive record header (data) con local message number */
  writeRecordHeader(localNum: number) {
    this.writeU8(localNum & 0x0F);
  }
}

// ── Generazione file FIT ─────────────────────────────────────────────────────

export function generateFit(records: BandRecord[], opts: FitExportOptions = {}): Uint8Array {
  if (records.length === 0) throw new Error('Nessun record da esportare');

  const w = new FitWriter();

  const startTs = records[0].timestamp;
  const endTs   = records[records.length - 1].timestamp;
  const fitStart = startTs - FIT_EPOCH;

  // ── Definizione file_id (local_num=0) ──────────────────────────────────
  // Fields: type(0,1,UINT8), manufacturer(1,2,UINT16), product(2,2,UINT16),
  //         serial_number(3,4,UINT32), time_created(4,4,UINT32)
  w.writeDefinition(0, MESG_FILE_ID, [
    [0, 1, UINT8],   // type: 4 = activity
    [1, 2, UINT16],  // manufacturer
    [2, 2, UINT16],  // product
    [3, 4, UINT32],  // serial_number
    [4, 4, UINT32],  // time_created
  ]);
  w.writeRecordHeader(0);
  w.writeU8(4);                              // type=activity
  w.writeU16(MANUFACTURER_ID);
  w.writeU16(PRODUCT_ID);
  w.writeU32(opts.deviceSerial ?? 0xAEA0D001);
  w.writeU32(fitStart);

  // ── Definizione record (local_num=1) ───────────────────────────────────
  // Fields: timestamp(253,4,UINT32), heart_rate(3,1,UINT8),
  //         respiration_rate(47,1,UINT8 — in 0.1 brpm → ×10),
  //         temperature(13,1,SINT8)
  w.writeDefinition(1, MESG_RECORD, [
    [253, 4, UINT32],  // timestamp
    [3,   1, UINT8],   // heart_rate [bpm]
    [47,  2, UINT16],  // respiration_rate [0.1 brpm]
    [61,  2, SINT16],  // 61 = cadence128 → usiamo come pitch proxy (custom)
  ]);

  for (const rec of records) {
    if (rec.flags & 0x01) continue;  // salta campioni lead-off
    w.writeRecordHeader(1);
    w.writeU32(rec.timestamp - FIT_EPOCH);
    w.writeU8(rec.hrBpm);
    w.writeU16(rec.breathBpm * 10);  // 0.1 brpm units
    w.writeI16(rec.pitchDeg10);      // trunk pitch
  }

  // ── HRV message (local_num=2) — RR intervals in 1/1000 s ─────────────
  // FIT HRV: field 0 = time array, size 2×n (max 5 per messaggio), UINT16
  // Solo record con RR valido (rrMs > 0)
  const rrRecords = records.filter(r => r.rrMs > 0 && !(r.flags & 0x01));
  if (rrRecords.length > 0) {
    // Raggruppa in chunk da 5
    const HRV_CHUNK = 5;
    w.writeDefinition(2, MESG_HRV, [
      [0, 2 * HRV_CHUNK, UINT16],  // time[5]: array di 5 RR in ms/1000 s
    ]);

    for (let i = 0; i < rrRecords.length; i += HRV_CHUNK) {
      w.writeRecordHeader(2);
      for (let j = 0; j < HRV_CHUNK; j++) {
        const idx = i + j;
        if (idx < rrRecords.length) {
          // FIT HRV time field: unità = 1/1000 s (ms)
          w.writeU16(rrRecords[idx].rrMs);
        } else {
          w.writeU16(0xFFFF);  // invalid/padding
        }
      }
    }
  }

  // ── Definizione lap (local_num=3) ─────────────────────────────────────
  w.writeDefinition(3, MESG_LAP, [
    [253, 4, UINT32],  // timestamp
    [2,   4, UINT32],  // start_time
    [0,   4, UINT32],  // event: 9=lap
    [1,   1, UINT8],   // event_type: 1=stop
    [24,  1, UINT8],   // avg_heart_rate
  ]);
  const avgHr = Math.round(
    records.reduce((s, r) => s + r.hrBpm, 0) / records.length
  );
  w.writeRecordHeader(3);
  w.writeU32(endTs - FIT_EPOCH);
  w.writeU32(fitStart);
  w.writeU32(9);      // event=lap
  w.writeU8(1);       // event_type=stop
  w.writeU8(avgHr);

  // ── Definizione session (local_num=4) ─────────────────────────────────
  w.writeDefinition(4, MESG_SESSION, [
    [253, 4, UINT32],  // timestamp
    [2,   4, UINT32],  // start_time
    [7,   4, UINT32],  // total_elapsed_time (1/1000 s)
    [8,   4, UINT32],  // total_timer_time (1/1000 s)
    [0,   4, UINT32],  // event: 8=session
    [1,   1, UINT8],   // event_type: 1=stop
    [5,   1, UINT8],   // sport: 2=cycling
    [6,   1, UINT8],   // sub_sport: 58=indoor_cycling
    [16,  1, UINT8],   // avg_heart_rate
    [17,  1, UINT8],   // max_heart_rate
  ]);
  const elapsed = (endTs - startTs) * 1000;
  const maxHr   = Math.max(...records.map(r => r.hrBpm));

  w.writeRecordHeader(4);
  w.writeU32(endTs - FIT_EPOCH);
  w.writeU32(fitStart);
  w.writeU32(elapsed);
  w.writeU32(elapsed);
  w.writeU32(8);      // event=session
  w.writeU8(1);       // stop
  w.writeU8(2);       // cycling
  w.writeU8(58);      // indoor_cycling
  w.writeU8(avgHr);
  w.writeU8(maxHr);

  // ── Definizione activity (local_num=5) ────────────────────────────────
  w.writeDefinition(5, MESG_ACTIVITY, [
    [253, 4, UINT32],  // timestamp
    [1,   4, UINT32],  // total_timer_time (1/1000 s)
    [2,   2, UINT16],  // num_sessions
    [3,   1, UINT8],   // type: 0=manual
    [4,   1, UINT8],   // event: 26=activity
    [5,   1, UINT8],   // event_type: 1=stop
  ]);
  w.writeRecordHeader(5);
  w.writeU32(endTs - FIT_EPOCH);
  w.writeU32(elapsed);
  w.writeU16(1);   // 1 sessione
  w.writeU8(0);    // manual
  w.writeU8(26);   // activity event
  w.writeU8(1);    // stop

  // ── Assembla file finale con header FIT e CRC ─────────────────────────
  const dataBytes = w.toUint8Array();
  const dataSize  = dataBytes.length;

  // File header: 14 byte
  const header = new Uint8Array(14);
  const hv = new DataView(header.buffer);
  hv.setUint8(0,  14);                  // header size
  hv.setUint8(1,  FIT_PROTOCOL_VERSION);
  hv.setUint16(2, FIT_PROFILE_VERSION, true);
  hv.setUint32(4, dataSize, true);
  // ".FIT" signature
  header[8] = 0x2E; header[9] = 0x46; header[10] = 0x49; header[11] = 0x54;
  // Header CRC (sui primi 12 byte)
  const hCrc = fitCrc(header, 0, 12);
  hv.setUint16(12, hCrc, true);

  // CRC dati
  const dataCrc = fitCrc(dataBytes);

  // Assembla: header + data + crc (2 byte LE)
  const out = new Uint8Array(14 + dataSize + 2);
  out.set(header, 0);
  out.set(dataBytes, 14);
  out[14 + dataSize]     = dataCrc & 0xFF;
  out[14 + dataSize + 1] = (dataCrc >> 8) & 0xFF;

  return out;
}

/**
 * Genera il nome file FIT suggerito dal timestamp di inizio sessione.
 * Esempio: "aerodrag_hr_2025-06-01_10-30.fit"
 */
export function fitFileName(startTimestamp: number): string {
  const d = new Date(startTimestamp * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `aerodrag_hr_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}.fit`
  );
}
