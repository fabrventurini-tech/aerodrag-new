/**
 * AeroDrag Physics Engine
 * Calcola CdA, potenza aerodinamica e breakdown delle resistenze.
 *
 * Formula centrale:
 *   P_aero = 0.5 * rho * CdA * v_aria^3
 *   CdA = (P_tot - P_rolling - P_gravity - P_accel) / (0.5 * rho * v_aria^3)
 */

export interface SensorInput {
  pitotPa:    number;   // pressione differenziale Pitot [Pa]
  staticPa:   number;   // pressione statica [Pa]
  tempC:      number;   // temperatura [°C]
  humidity:   number;   // umidità relativa [0-1]
  altM:       number;   // altitudine [m]
  pitchDeg:   number;   // inclinazione longitudinale [°]
  rollDeg:    number;   // inclinazione laterale [°]
  powerW:     number;   // potenza pedivella [W]
  speedMs:    number;   // velocità ruota [m/s]
  cadenceRpm: number;   // cadenza [rpm]
  hrBpm:      number;   // frequenza cardiaca [bpm]
  // ── Fascia HR+IMU (biomeccanica tronco) ──────────────────────────────────
  trunkPitchDeg:  number;   // angolo tronco longitudinale [°]
  trunkRollDeg:   number;   // angolo tronco laterale [°]
  lateralOscMm:   number;   // oscillazione laterale [mm]
  respBreathMin:  number;   // frequenza respiratoria [breath/min]
  skinTempC:      number;   // temperatura cutanea [°C]
}

export interface PhysicsOutput {
  cda:         number;  // CdA [m²]
  pAeroW:      number;  // potenza aerodinamica [W]
  pRollingW:   number;  // potenza rolling [W]
  pGravityW:   number;  // potenza gravità [W]
  vAirMs:      number;  // velocità aria [m/s]
  rhoKgM3:     number;  // densità aria [kg/m³]
  pctAero:     number;  // % potenza aerodinamica
  valid:       boolean;
}

const G = 9.81;
const R_AIR = 287.058;   // costante gas secco [J/(kg·K)]
const Rv    = 461.495;   // costante vapor acqua [J/(kg·K)]

/**
 * Calcola densità aria tenendo conto di temperatura, pressione e umidità.
 */
function airDensity(tempC: number, staticPa: number, humidity: number): number {
  const T = tempC + 273.15;
  // Pressione vapor saturo (Magnus formula)
  const pSat = 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const pV   = humidity * pSat;
  const pD   = staticPa - pV;
  return (pD / (R_AIR * T)) + (pV / (Rv * T));
}

/**
 * Velocità aria dal tubo Pitot.
 * v = sqrt(2 * deltaP / rho)
 */
function pitotVelocity(pitotPa: number, rho: number): number {
  if (pitotPa <= 0 || rho <= 0) return 0;
  return Math.sqrt((2 * pitotPa) / rho);
}

export function computePhysics(
  s: SensorInput,
  mass: number,       // kg atleta + bici
  crr: number,        // coefficiente rolling resistance
): PhysicsOutput
{
  const INVALID: PhysicsOutput = {
    cda: 0, pAeroW: 0, pRollingW: 0, pGravityW: 0,
    vAirMs: 0, rhoKgM3: 0, pctAero: 0, valid: false,
  };

  if (s.powerW <= 0 || s.speedMs <= 0) return INVALID;

  const rho    = airDensity(s.tempC, s.staticPa, s.humidity);
  const vAir   = pitotVelocity(s.pitotPa, rho);
  const slope  = Math.sin((s.pitchDeg * Math.PI) / 180);

  if (rho <= 0 || vAir <= 0.5) return INVALID;

  const pRolling = crr * mass * G * s.speedMs;
  const pGravity = mass * G * slope * s.speedMs;
  const pAero    = Math.max(s.powerW - pRolling - pGravity, 0);

  const denominator = 0.5 * rho * Math.pow(vAir, 3);
  if (denominator <= 0) return INVALID;

  const cda     = pAero / denominator;
  const pctAero = s.powerW > 0 ? (pAero / s.powerW) * 100 : 0;

  return {
    cda:       Math.max(0, Math.min(cda, 1.5)),
    pAeroW:    pAero,
    pRollingW: pRolling,
    pGravityW: pGravity,
    vAirMs:    vAir,
    rhoKgM3:   rho,
    pctAero:   Math.max(0, Math.min(pctAero, 100)),
    valid:     true,
  };
}