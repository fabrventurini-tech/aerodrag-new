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

const G = 9.80665;   // costante canonica (contract v0.1.0 §6, physics.h)

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
 * Estrae il Crr da un singolo run coast-down con una vera regressione ai
 * minimi quadrati sul modello  a(v) = -c1 - c2·v²  (y = -a = c1 + c2·v²):
 *   c1 = Crr·g·cosθ + g·sinθ   (rolling + gravità lungo la pendenza)
 *   c2 = ρ·CdA / (2·m)         (termine aerodinamico)
 * Crr si ricava da c1 al netto della pendenza; R² dai residui del fit.
 */
export function fitCrrFromRun(
  samples: WheelSample[],
  params: CrrRunParams,
): CrrRunResult {
  const INVALID: CrrRunResult = {
    crr: 0, speedStartMs: 0, speedEndMs: 0,
    durationS: 0, rSquared: 0, avgTempC: 0, avgVibRMS: 0, valid: false,
  };

  // `?? 2.0` cattura solo null/undefined: un `0` esplicito disattiverebbe il
  // filtro velocità. Soglia di default anche per valori non positivi.
  const minSpeed = params.minSpeedMs > 0 ? params.minSpeedMs : 2.0;
  const slopeRad = (params.slopeDeg * Math.PI) / 180;
  const cosT = Math.cos(slopeRad);
  const sinT = Math.sin(slopeRad);

  // Filtra campioni validi: decelerazione reale e velocità > soglia
  const valid = samples.filter(
    (s) => s.speedMs > minSpeed && s.accelMs2 < -0.005
  );
  if (valid.length < 15) return INVALID;

  // Regressione minimi quadrati  y = c1 + c2·x  con x = v², y = -a (decel > 0)
  const n   = valid.length;
  let Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
  for (const s of valid) {
    const x = s.speedMs * s.speedMs;
    const y = -s.accelMs2;
    Sx += x; Sy += y; Sxx += x * x; Sxy += x * y;
  }
  const denom = n * Sxx - Sx * Sx;

  let c1: number;   // termine costante (rolling + gravità)
  let c2: number;   // pendenza in v² (aero = ρ·CdA/2m)
  if (Math.abs(denom) > 1e-9) {
    c2 = (n * Sxy - Sx * Sy) / denom;
    // L'aero non può essere negativa: se la regressione la spinge < 0 (rumore /
    // poco spread in v²), la fissiamo a 0 e ri-stimiamo il solo termine costante.
    if (c2 < 0) { c2 = 0; c1 = Sy / n; }
    else        { c1 = (Sy - c2 * Sx) / n; }
  } else {
    // Spread in v² insufficiente: usa il CdA noto per l'aero, media per il resto
    c2 = params.cdaM2 > 0 ? (params.rhoKgM3 * params.cdaM2) / (2 * params.massKg) : 0;
    c1 = (Sy - c2 * Sx) / n;
  }

  // Crr dal termine costante, al netto della pendenza
  const crr = (c1 - G * sinT) / (G * cosT);

  // Bontà del fit: R² dai residui di y rispetto al modello (c1 + c2·x)
  const meanY = Sy / n;
  let ssTot = 0, ssRes = 0;
  for (const s of valid) {
    const x = s.speedMs * s.speedMs;
    const y = -s.accelMs2;
    ssTot += (y - meanY) ** 2;
    ssRes += (y - (c1 + c2 * x)) ** 2;
  }
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  const avgTempC = valid.reduce((s, x) => s + x.tempC, 0) / valid.length;
  const avgVibRMS = valid.reduce((s, x) => s + x.vibRMS, 0) / valid.length;
  // Metadati run dal subset filtrato `valid` (≥15 qui), non dai `samples` grezzi:
  // così durata/velocità riportate escludono spin-up e coda sotto-soglia.
  const first = valid[0];
  const last  = valid[valid.length - 1];

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
  const crrMin = crrValues.reduce((a, b) => Math.min(a, b));
  const crrMax = crrValues.reduce((a, b) => Math.max(a, b));
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
  const crrMin = allValid.reduce((a, r) => Math.min(a, r.crr), Infinity);
  const crrMax = allValid.reduce((a, r) => Math.max(a, r.crr), -Infinity);
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
