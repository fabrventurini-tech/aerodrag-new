/**
 * signal_proc.h
 * DSP per il sensore ruota AeroDrag.
 *
 * Principio fisico:
 *   Il sensore è montato sul mozzo anteriore. L'asse del giroscopio
 *   allineato con l'assale della ruota misura la velocità angolare ω.
 *   La velocità lineare è:  v = |ω_axle| × r_tire
 *   La decelerazione è:     a = dv/dt = r_tire × dω/dt
 *
 *   Usando il giroscopio (invece dell'accelerometro) si evita il problema
 *   della gravità che ruota con la ruota — il giroscopio misura sempre
 *   la stessa componente rotazionale indipendentemente dall'orientamento.
 *
 * Auto-rilevamento asse di rotazione:
 *   Durante lo spin-up (v > 2 m/s) il firmware campiona la varianza dei
 *   3 assi giroscopio su 1 secondo. L'asse con varianza massima è quello
 *   allineato con l'assale → memorizzato in rotAxisIdx.
 */

#pragma once
#include <Arduino.h>
#include "icm42688.h"

// ── Costanti ──────────────────────────────────────────────────────────────────

#define GRAVITY_MS2       9.81f
#define EMA_ALPHA_2HZ     0.063f   // α = 1 - e^(-2π·fc/fs) con fc=2Hz, fs=200Hz
#define VIB_ALPHA         0.1f     // EMA per vibrazione RMS (aggiornata a 200Hz)
#define MIN_SPEED_MS      0.5f     // sotto questa soglia la ruota è ferma

// ── Struttura stato DSP ───────────────────────────────────────────────────────

struct SignalState {
  // Velocità
  float   speedMs       = 0.0f;    // velocità lineare filtrata [m/s]
  float   speedRaw      = 0.0f;    // velocità istantanea grezza [m/s]
  float   omegaPrev     = 0.0f;    // ω precedente per dω/dt

  // Decelerazione
  float   accelMs2      = 0.0f;    // decelerazione filtrata EMA 2Hz [m/s²]
  float   accelRaw      = 0.0f;    // decelerazione istantanea [m/s²]

  // Temperatura
  float   tempC         = 25.0f;

  // Vibrazione RMS (banda 2–20 Hz)
  float   vibRMS        = 0.0f;    // running RMS energia accel
  float   vibEnergy     = 0.0f;    // EMA energia quadratica

  // Asse rotazione (0=X, 1=Y, 2=Z, -1=non rilevato)
  int8_t  rotAxisIdx    = -1;
  float   axisVariance[3] = {0};   // per rilevamento asse

  // Conteggio rivoluzioni (per CSC standard)
  uint32_t cumulRevs   = 0;        // rivoluzioni cumulative
  uint16_t lastEvtTime = 0;        // timestamp ultima rivoluzione [1/1024 s]
  float    revAccum    = 0.0f;     // accumulo parziale rivoluzione
};

// ── Funzioni DSP ─────────────────────────────────────────────────────────────

/**
 * Aggiorna lo stato DSP con un nuovo campione IMU.
 * Chiamare a 200 Hz (ogni 5 ms).
 *
 * @param s     stato interno (modificato in-place)
 * @param raw   campione IMU dal driver
 * @param rTire raggio pneumatico [m] (es. 0.336 per 700c×25)
 * @param dtS   intervallo di campionamento [s] (es. 0.005 per 200 Hz)
 */
inline void signalUpdate(SignalState& s, const ImuRaw& raw, float rTire, float dtS) {
  // ── 1. Seleziona asse rotazione ─────────────────────────────────────────────
  const float gyro[3] = { raw.gx, raw.gy, raw.gz };

  if (s.rotAxisIdx < 0) {
    // Fase rilevamento: accumula varianza su ~1 s (200 campioni)
    static uint16_t detectCnt = 0;
    static float    mean[3]   = {0};
    static float    m2[3]     = {0};
    detectCnt++;
    for (int i = 0; i < 3; i++) {
      float delta = gyro[i] - mean[i];
      mean[i] += delta / detectCnt;
      m2[i]   += delta * (gyro[i] - mean[i]);
    }
    if (detectCnt >= 200) {
      float maxVar = 0;
      for (int i = 0; i < 3; i++) {
        s.axisVariance[i] = m2[i] / (detectCnt - 1);
        if (s.axisVariance[i] > maxVar) { maxVar = s.axisVariance[i]; s.rotAxisIdx = i; }
      }
      // Valido solo se c'è effettiva rotazione (v > ~1 m/s)
      if (maxVar < 0.01f) { s.rotAxisIdx = -1; detectCnt = 0; memset(mean,0,sizeof(mean)); memset(m2,0,sizeof(m2)); }
    }
    // Durante rilevamento usa asse Z come default
  }

  const int8_t axis = (s.rotAxisIdx >= 0) ? s.rotAxisIdx : 2;
  const float  omega = fabsf(gyro[axis]);      // rad/s

  // ── 2. Velocità lineare ─────────────────────────────────────────────────────
  s.speedRaw = omega * rTire;

  // EMA sulla velocità per ridurre jitter (α = 0.3 → ~10 campioni)
  s.speedMs = 0.3f * s.speedRaw + 0.7f * s.speedMs;

  // ── 3. Decelerazione lineare ────────────────────────────────────────────────
  // a_raw = r × dω/dt  (negativa in frenata)
  if (dtS > 0) {
    s.accelRaw = rTire * (gyro[axis] - s.omegaPrev) / dtS;
  }
  s.omegaPrev = gyro[axis];

  // Filtro EMA a 2 Hz per isolare la decelerazione da coast-down
  // (rimuove oscillazioni ad alta frequenza dovute a vibrazioni e granularità)
  s.accelMs2 = EMA_ALPHA_2HZ * s.accelRaw + (1.0f - EMA_ALPHA_2HZ) * s.accelMs2;

  // ── 4. Rivoluzioni cumulative (per CSC standard) ────────────────────────────
  if (s.speedMs > MIN_SPEED_MS && rTire > 0) {
    float revPerSec = omega / (2.0f * PI);
    s.revAccum += revPerSec * dtS;
    if (s.revAccum >= 1.0f) {
      uint32_t newRevs = (uint32_t)s.revAccum;
      s.cumulRevs   += newRevs;
      s.revAccum    -= newRevs;
      // Timestamp in unità 1/1024 s
      s.lastEvtTime  = (uint16_t)(millis() * 1024UL / 1000UL);
    }
  }

  // ── 5. Temperatura ─────────────────────────────────────────────────────────
  s.tempC = 0.01f * raw.tempC + 0.99f * s.tempC;  // EMA lenta

  // ── 6. Vibrazione RMS (banda 2–20 Hz) ──────────────────────────────────────
  // L'accel totale include la componente gravitazionale (9.81 m/s²) che ruota
  // con la ruota. La vibrazione è la deviazione dall'ampiezza media.
  float accelMag   = sqrtf(raw.ax*raw.ax + raw.ay*raw.ay + raw.az*raw.az);
  float deviation  = accelMag - GRAVITY_MS2;         // scostamento da 1g
  float energyInst = deviation * deviation;
  s.vibEnergy = VIB_ALPHA * energyInst + (1.0f - VIB_ALPHA) * s.vibEnergy;
  s.vibRMS    = sqrtf(s.vibEnergy);
}

/**
 * Resetta il rilevamento asse (es. se il sensore viene rimontato).
 */
inline void resetAxisDetection(SignalState& s) {
  s.rotAxisIdx = -1;
  memset(s.axisVariance, 0, sizeof(s.axisVariance));
}
