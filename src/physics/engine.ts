/**
 * AeroDrag Physics Engine — SOLO fallback/sim.
 *
 * La sorgente di verità del CdA è il firmware (BLE 0xaa09): quando il device
 * notifica la sua fisica, lo store la usa direttamente. Questo modulo entra in
 * gioco solo in sim mode o con firmware legacy che non espone 0xaa09.
 *
 * Per garantire che il display dell'app coincida con quello del device anche
 * nel fallback, queste formule replicano fedelmente il modello CANONICO
 * `aerodrag-firmware/components/pitot/physics.h` (contract v0.1.0 §6):
 *
 *   rho     = f(tempC, humidityPct, altM)            # ISO 2533 + Magnus
 *   v_air   = sqrt(2 · max(0, pitot − offset) / rho) # offset applicato a monte
 *   p_roll  = crr · mass · g · v_ground
 *   p_grav  = mass · g · sin(pitch) · v_ground
 *   p_mech  = power · (1 − MECH_EFF)                 # MECH_EFF = 0.975
 *   p_aero  = max(0, power − p_roll − p_grav − p_mech)
 *   CdA     = p_aero / (0.5 · rho · v_air³)          # solo se v_air³>1 e power>20 W
 *   pctAero = clamp(p_aero / power · 100, 0, 100)
 *
 * Costanti canoniche: g = 9.80665, RHO_STD = 1.225, CdA valido in [0.10, 0.60].
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

// Costanti canoniche da physics.h (§6)
const G        = 9.80665;   // GRAVITY_MS2 [m/s²]
const R_AIR    = 287.058;   // costante gas secco [J/(kg·K)]
const MECH_EFF = 0.975;     // efficienza trasmissione
const RHO_STD  = 1.225;     // densità aria standard [kg/m³]

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Densità aria ρ = f(T, RH, altitudine) — ISO 2533 semplificata + Magnus.
 * Replica `physics_calc_rho` di physics.h: barometrica dall'altitudine
 * (la statica misurata NON è usata, come sul device), con clamp degli input
 * e sanity finale su rho.
 */
function airDensity(tempC: number, humidity: number, altM: number): number {
  // Clamp input (evita NaN/negativi dalla formula di Magnus)
  const t   = clamp(tempC, -40, 60);
  const rh  = clamp(humidity * 100, 0, 100);   // SensorInput.humidity è [0-1]
  const alt = clamp(altM, 0, 5000);

  const T  = t + 273.15;
  const p0 = 101325;
  const p  = p0 * Math.exp((-0.0289644 * G * alt) / (8.31447 * T));
  const es = 610.78 * Math.exp((17.27 * t) / (t + 237.3));
  const pv = (rh / 100) * es;
  const rho = (p - 0.378 * pv) / (R_AIR * T);
  // Sanity: fuori range [0.8, 1.4] → densità standard (coerente con §6 physics_compute)
  return rho >= 0.8 && rho <= 1.4 ? rho : RHO_STD;
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

  // Densità aria (barometrica da altitudine, come sul device). airDensity()
  // applica già il sanity clamp unico a [0.8, 1.4] (§6 physics_compute):
  // nessun ri-clamp qui per evitare soglie divergenti.
  const rho = airDensity(s.tempC, s.humidity, s.altM);

  // Pitot: v_air = sqrt(2·ΔP/ρ). L'offset Pitot è già applicato a monte
  // (store.updateSensors), qui ci limitiamo a scartare i valori negativi.
  const dp   = Math.max(0, s.pitotPa);
  const vAir = Math.sqrt((2 * dp) / rho);

  const slope    = Math.sin((s.pitchDeg * Math.PI) / 180);
  const pRolling = crr * mass * G * s.speedMs;
  const pGravity = mass * G * slope * s.speedMs;
  const pMech    = s.powerW * (1 - MECH_EFF);
  const pAero    = Math.max(0, s.powerW - pRolling - pGravity - pMech);

  // CdA solo con flusso d'aria e potenza significativi (gate canonico)
  const v3  = vAir * vAir * vAir;
  const cda = v3 > 1 && s.powerW > 20 ? pAero / (0.5 * rho * v3) : 0;

  // Sanity device: CdA fuori [0.10, 0.60] → misura non valida (il device
  // azzera l'output; l'app lo tratta come fisica assente)
  if (cda < 0.1 || cda > 0.6) return INVALID;

  // pctAero continuo 0–100 come il modello canonico §6 (link.ts arrotonda a 1
  // decimale sul wire); il device lo tronca a uint8, qui restiamo continui.
  const pctAero = s.powerW > 0 ? clamp((pAero / s.powerW) * 100, 0, 100) : 0;

  return {
    cda,
    pAeroW:    pAero,
    pRollingW: pRolling,
    pGravityW: pGravity,
    vAirMs:    vAir,
    rhoKgM3:   rho,
    pctAero,
    valid:     true,
  };
}