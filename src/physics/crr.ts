/**
 * AeroDrag Crr Engine — Misura della resistenza al rotolamento.
 *
 * Metodo coast-down: il sensore IMU sul mozzo anteriore registra la
 * decelerazione lineare durante il freewheeling. Con massa nota e
 * decelerazione precisa il Crr è calcolabile senza hardware aggiuntivo.
 *
 * Formula: Crr = a / (g × cos θ)
 *   a = decelerazione misurata [m/s²]
 *   θ = angolo pendenza strada [rad] (da barometro/GPS)
 *   g = 9.81 m/s²
 *
 * Protocollo outdoor bidirezionale: run A (Nord) + run B (Sud) × 3 ripetizioni.
 * La componente vento si cancella algebricamente dalla media dei due sensi.
 */

const G = 9.81;

// Limiti plausibilità Crr (superfici reali: 0.001–0.020)
const CRR_MIN = 0.0005;
const CRR_MAX = 0.025;

export interface CrrSample {
  timestamp: number;
  speedMs:   number;
  decelMs2:  number;   // decelerazione positiva [m/s²]
  gradient:  number;   // pendenza strada [rad], positivo = salita
}

export interface CrrRunResult {
  crr:        number;
  sampleCount: number;
  valid:       boolean;
}

export interface CrrResult {
  crr:        number;  // Crr finale
  crrStd:     number;  // deviazione standard tra i run
  confidence: number;  // 0–1
  runCount:   number;
}

/**
 * Calcola il Crr da un singolo run di coast-down.
 * Ritorna null se i dati non sono sufficienti o non validi.
 */
export function computeCrrFromRun(samples: CrrSample[]): CrrRunResult {
  // Filtra: solo campioni con decelerazione positiva e velocità > 0.5 m/s
  const valid = samples.filter(
    s => s.speedMs > 0.5 && s.decelMs2 > 0 && Math.abs(s.gradient) < 0.2  // < ~11°
  );

  if (valid.length < 10) return { crr: 0, sampleCount: valid.length, valid: false };

  const rawCrrs = valid.map(s => {
    const cosGrad = Math.cos(s.gradient);
    return s.decelMs2 / (G * cosGrad);
  });

  // Elimina outlier con metodo IQR
  const sorted = [...rawCrrs].sort((a, b) => a - b);
  const q1     = sorted[Math.floor(sorted.length * 0.25)];
  const q3     = sorted[Math.floor(sorted.length * 0.75)];
  const iqr    = q3 - q1;
  const filtered = rawCrrs.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);

  if (filtered.length < 5) return { crr: 0, sampleCount: filtered.length, valid: false };

  const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const crr  = Math.max(CRR_MIN, Math.min(CRR_MAX, mean));

  return { crr, sampleCount: filtered.length, valid: true };
}

/**
 * Aggrega più run (indoor: 3 su rullo; outdoor: 3A + 3B bidirezionali)
 * in un valore Crr finale con indice di confidenza.
 */
export function aggregateCrr(runCrrs: number[]): CrrResult {
  if (runCrrs.length === 0) {
    return { crr: 0, crrStd: 0, confidence: 0, runCount: 0 };
  }

  const avg      = runCrrs.reduce((a, b) => a + b, 0) / runCrrs.length;
  const variance = runCrrs.reduce((acc, c) => acc + (c - avg) ** 2, 0) / runCrrs.length;
  const std      = Math.sqrt(variance);

  // Confidenza: penalizza alta variazione tra run e pochi campioni
  const cv         = avg > 0 ? std / avg : 1;
  const confidence = Math.max(0, Math.min(1, (runCrrs.length / 3) * (1 - cv * 10)));

  return {
    crr:        Math.max(CRR_MIN, Math.min(CRR_MAX, avg)),
    crrStd:     std,
    confidence,
    runCount:   runCrrs.length,
  };
}

/**
 * Stima Crr in tempo reale da un singolo campione (per display live durante il coast-down).
 * Ritorna null se il campione non è plausibile.
 */
export function estimateCrrRealtime(decelMs2: number, gradient: number): number | null {
  if (decelMs2 <= 0 || Math.abs(gradient) > 0.2) return null;
  const cosGrad = Math.cos(gradient);
  const crr     = decelMs2 / (G * cosGrad);
  return crr >= CRR_MIN && crr <= CRR_MAX ? crr : null;
}
