/**
 * crr.ts
 * Calcolo del Crr (Coefficient of Rolling Resistance) tramite coast-down.
 *
 * Modello fisico:
 *   a = -Crr·g·cos(θ) - (ρ·CdA·v²)/(2·m) - g·sin(θ)
 *
 * Indoor: θ≈0, vento≈0  → Crr = -(a + k_aero·v²) / g
 * Outdoor: protocollo bidirezionale A/B → componente vento si cancella dalla media
 *
 * Il firmware del sensore ruota (nRF52840 + ICM-42688) invia:
 *   - speedMs  : velocità lineare ricavata da ω_gyro × r_tire (m/s)
 *   - accelMs2 : decelerazione lineare gravity-compensated e low-pass 2Hz (m/s²)
 *   - tempC    : temperatura (°C)
 *   - vibRMS   : energia vibrazioni 2-20 Hz (m/s²) — indicatore qualità superficie
 */

const G = 9.81;

// ── Tipi pubblici ─────────────────────────────────────────────────────────────

export interface WheelSample {
  t:        number;   // timestamp Unix ms
  speedMs:  number;   // velocità lineare [m/s]
  accelMs2: number;   // decelerazione (negativa = rallentamento) [m/s²]
  tempC:    number;   // temperatura [°C]
  vibRMS:   number;   // vibrazione RMS [m/s²]
}

export interface CrrRunParams {
  massKg:       number;  // massa totale atleta + bici [kg]
  rhoKgM3:      number;  // densità aria [kg/m³]
  cdaM2:        number;  // CdA noto [m²] (da AeroDrag; 0 = ignora correzione aero)
  slopeDeg:     number;  // pendenza [°] (0 per indoor)
  minSpeedMs:   number;  // velocità minima per includere il campione (default 2 m/s)
}

export interface CrrRunResult {
  crr:          number;  // Crr calcolato [-]
  speedStartMs: number;  // velocità inizio run [m/s]
  speedEndMs:   number;  // velocità fine run [m/s]
  durationS:    number;  // durata run [s]
  rSquared:     number;  // bontà del fit [0-1]
  avgTempC:     number;  // temperatura media run [°C]
  avgVibRMS:    number;  // vibrazione media (qualità superficie) [m/s²]
  valid:        boolean;
}

export interface CrrCalibResult {
  crr:         number;  // Crr finale (media run validi) [-]
  crrMin:      number;
  crrMax:      number;
  confidence:  number;  // 0-100
  tempC:       number;
  vibRMS:      number;  // vibrazione media → qualità superficie
  runsUsed:    number;
  timestamp:   number;
  surfaceLabel?: string;
}

// ── Algoritmo principale ──────────────────────────────────────────────────────

/**
 * Estrae il Crr da un singolo run coast-down.
 * Usa regressione lineare sul modello a(v) = -Crr·g - k_aero·v²
 */
export function fitCrrFromRun(
  samples: WheelSample[],
  params: CrrRunParams,
): CrrRunResult {
  const INVALID: CrrRunResult = {
    crr: 0, speedStartMs: 0, speedEndMs: 0,
    durationS: 0, rSquared: 0, avgTempC: 0, avgVibRMS: 0, valid: false,
  };

  const minSpeed = params.minSpeedMs ?? 2.0;
  const slopeRad = (params.slopeDeg * Math.PI) / 180;

  // Filtra campioni validi: decelerazione reale e velocità > soglia
  const valid = samples.filter(
    (s) => s.speedMs > minSpeed && s.accelMs2 < -0.005
  );
  if (valid.length < 15) return INVALID;

  const k_aero = params.cdaM2 > 0
    ? (params.rhoKgM3 * params.cdaM2) / (2 * params.massKg)
    : 0;

  const crrValues = valid.map((s) => {
    // a_corretto = a + k_aero·v² + g·sin(θ) → quello che Crr·g deve spiegare
    const a_corrected = s.accelMs2 + k_aero * s.speedMs * s.speedMs + G * Math.sin(slopeRad);
    return -a_corrected / (G * Math.cos(slopeRad));
  });

  const crr = crrValues.reduce((s, x) => s + x, 0) / crrValues.length;

  // Bontà del fit: confronta la decelerazione predetta con quella misurata
  const meanA = valid.reduce((s, x) => s + x.accelMs2, 0) / valid.length;
  const ssTot = valid.reduce((s, x) => s + (x.accelMs2 - meanA) ** 2, 0);
  const ssRes = valid.reduce((s, x) => {
    const predicted = -crr * G * Math.cos(slopeRad)
      - k_aero * x.speedMs * x.speedMs
      - G * Math.sin(slopeRad);
    return s + (x.accelMs2 - predicted) ** 2;
  }, 0);
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  const avgTempC = valid.reduce((s, x) => s + x.tempC, 0) / valid.length;
  const avgVibRMS = valid.reduce((s, x) => s + x.vibRMS, 0) / valid.length;
  const first = samples[0];
  const last  = samples[samples.length - 1];

  return {
    crr:          Math.max(0.001, Math.min(0.025, crr)),
    speedStartMs: first?.speedMs ?? 0,
    speedEndMs:   last?.speedMs ?? 0,
    durationS:    ((last?.t ?? 0) - (first?.t ?? 0)) / 1000,
    rSquared:     Math.min(1, rSquared),
    avgTempC,
    avgVibRMS,
    valid:        crr > 0.001 && crr < 0.025 && rSquared > 0.75,
  };
}

/**
 * Combina 3 run indoor in un unico risultato con confidence score.
 */
export function combineIndoorRuns(
  runs: CrrRunResult[],
): CrrCalibResult {
  const valid = runs.filter((r) => r.valid);

  if (valid.length === 0) {
    return {
      crr: 0.004, crrMin: 0.004, crrMax: 0.004,
      confidence: 0, tempC: 20, vibRMS: 0,
      runsUsed: 0, timestamp: Date.now(),
    };
  }

  const crrValues = valid.map((r) => r.crr);
  const crr  = crrValues.reduce((s, x) => s + x, 0) / crrValues.length;
  const crrMin = Math.min(...crrValues);
  const crrMax = Math.max(...crrValues);
  const spread = crrMax - crrMin;

  const avgRSq  = valid.reduce((s, r) => s + r.rSquared, 0) / valid.length;
  const tempC   = valid.reduce((s, r) => s + r.avgTempC, 0) / valid.length;
  const vibRMS  = valid.reduce((s, r) => s + r.avgVibRMS, 0) / valid.length;

  // Penalizza spread elevato tra i run (instabilità del test)
  const spreadPenalty = Math.max(0, 1 - spread / 0.003);
  const confidence = Math.round(
    Math.min(100, avgRSq * 100 * spreadPenalty * (0.5 + 0.5 * valid.length / 3))
  );

  return {
    crr,
    crrMin,
    crrMax,
    confidence: Math.max(0, confidence),
    tempC,
    vibRMS,
    runsUsed:  valid.length,
    timestamp: Date.now(),
  };
}

/**
 * Protocollo outdoor bidirezionale: cancella algebricamente la componente vento.
 * runsA = runs direzione Nord, runsB = runs direzione Sud.
 * La media tra le due direzioni elimina la componente vento costante.
 */
export function combineOutdoorRuns(
  runsA: CrrRunResult[],
  runsB: CrrRunResult[],
): CrrCalibResult {
  const validA = runsA.filter((r) => r.valid);
  const validB = runsB.filter((r) => r.valid);

  if (validA.length === 0 && validB.length === 0) {
    return {
      crr: 0.004, crrMin: 0.004, crrMax: 0.004,
      confidence: 0, tempC: 20, vibRMS: 0,
      runsUsed: 0, timestamp: Date.now(),
    };
  }

  if (validA.length === 0 || validB.length === 0) {
    return combineIndoorRuns([...validA, ...validB]);
  }

  const avgA = validA.reduce((s, r) => s + r.crr, 0) / validA.length;
  const avgB = validB.reduce((s, r) => s + r.crr, 0) / validB.length;
  // Media bidirezionale: cancella vento
  const crr  = (avgA + avgB) / 2;

  const allValid = [...validA, ...validB];
  const crrMin = Math.min(...allValid.map((r) => r.crr));
  const crrMax = Math.max(...allValid.map((r) => r.crr));
  const windAsymmetry = Math.abs(avgA - avgB);

  const avgRSq  = allValid.reduce((s, r) => s + r.rSquared, 0) / allValid.length;
  const tempC   = allValid.reduce((s, r) => s + r.avgTempC, 0) / allValid.length;
  const vibRMS  = allValid.reduce((s, r) => s + r.avgVibRMS, 0) / allValid.length;

  // Alta asimmetria A/B indica vento molto forte → penalizza confidence
  const windPenalty = Math.max(0, 1 - windAsymmetry / 0.004);
  const confidence  = Math.round(
    Math.min(100, avgRSq * 100 * windPenalty)
  );

  return {
    crr:        Math.max(0.001, Math.min(0.025, crr)),
    crrMin,
    crrMax,
    confidence: Math.max(0, confidence),
    tempC,
    vibRMS,
    runsUsed:  allValid.length,
    timestamp: Date.now(),
  };
}

// ── Utilità ───────────────────────────────────────────────────────────────────

/**
 * Classifica il Crr in etichette descrittive per il database superfici.
 */
export function surfaceLabelFromCrr(crr: number): string {
  if (crr < 0.0030) return 'Velodromo legno';
  if (crr < 0.0038) return 'Asfalto liscio / pista';
  if (crr < 0.0048) return 'Asfalto buono';
  if (crr < 0.0060) return 'Rullo indoor';
  if (crr < 0.0080) return 'Asfalto mediocre';
  return 'Sterrato / acciottolato';
}

/**
 * Temperatura in pista influenza il Crr della gomma (~1% per °C).
 * Restituisce il Crr corretto a temperatura di riferimento (20°C).
 */
export function normalizeCrrToTemp(crr: number, tempC: number, refTempC = 20): number {
  const delta = tempC - refTempC;
  return crr * (1 - 0.01 * delta);
}
