import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SensorInput, PhysicsOutput, computePhysics } from '../physics/engine';
import { loadPairedDevice, DiscoveredSensor } from '../security/pairing';
import { WheelSample, CrrRunResult, CrrCalibResult, fitCrrFromRun, combineIndoorRuns, combineOutdoorRuns, surfaceLabelFromCrr } from '../physics/crr';

// ── Tipi ──────────────────────────────────────────────────────────────────────

export interface DataPoint {
  t:       number;   // timestamp ms
  physics: PhysicsOutput;
  sensor:  SensorInput;
}

export interface LapStats {
  index:      number;
  startT:     number;
  endT:       number;
  avgCda:     number;
  avgPowerW:  number;
  avgSpeedMs: number;
  avgHrBpm:   number;
  points:     number;
}

export interface AthleteProfile {
  id:          string;
  name:        string;
  massRiderKg: number;
  massBikeKg:  number;
  crr:         number;
}

export interface CalibrationParams {
  massRiderKg:   number;
  massBikeKg:    number;
  crr:           number;
  pitotOffset:   number;
  tireCircM:     number;  // circonferenza pneumatico [m] (default 2.105 per 700c×25)
}

// ── Crr calibrazione state ────────────────────────────────────────────────────

export type CrrCalibMode =
  | 'idle'
  | 'setup'
  | 'spinup'
  | 'coast_indoor'    // coast-down indoor (run 1/2/3)
  | 'coast_outdoor_a' // run direzione A
  | 'coast_outdoor_b' // run direzione B
  | 'computing'
  | 'done'
  | 'error';

export interface CrrCalibState {
  mode:            CrrCalibMode;
  protocol:        'indoor' | 'outdoor';
  targetSpeedKmh:  number;          // velocità target spin-up [km/h]: 20 | 25 | 30
  currentRun:      number;          // 1-3
  totalRuns:       number;          // 3 per indoor, 6 per outdoor (3A+3B)
  indoorRuns:      CrrRunResult[];
  outdoorRunsA:    CrrRunResult[];
  outdoorRunsB:    CrrRunResult[];
  activeSamples:   WheelSample[];   // campioni del run in corso
  result:          CrrCalibResult | null;
  history:         CrrCalibResult[];
}

// ── Wheel sensor state ────────────────────────────────────────────────────────

export interface WheelStream {
  speedMs:  number;
  accelMs2: number;
  tempC:    number;
  vibRMS:   number;
}

// ── Stato default ─────────────────────────────────────────────────────────────

const DEFAULT_CALIB: CalibrationParams = {
  massRiderKg: 70,
  massBikeKg:  8,
  crr:         0.004,
  pitotOffset: 0,
  tireCircM:   2.105,
};

const DEFAULT_CRR_CALIB: CrrCalibState = {
  mode:           'idle',
  protocol:       'indoor',
  targetSpeedKmh: 30,
  currentRun:     1,
  totalRuns:      3,
  indoorRuns:     [],
  outdoorRunsA:   [],
  outdoorRunsB:   [],
  activeSamples:  [],
  result:         null,
  history:      [],
};

const EMPTY_SENSOR: SensorInput = {
  pitotPa: 0, staticPa: 101325, tempC: 20, humidity: 0.5,
  altM: 0, pitchDeg: 0, rollDeg: 0, powerW: 0,
  speedMs: 0, cadenceRpm: 0, hrBpm: 0,
};

const EMPTY_PHYSICS: PhysicsOutput = {
  cda: 0, pAeroW: 0, pRollingW: 0, pGravityW: 0,
  vAirMs: 0, rhoKgM3: 1.225, pctAero: 0, valid: false,
};

// ── Store ─────────────────────────────────────────────────────────────────────

interface AeroDragStore {
  // Stato BLE (device principale AeroDrag)
  bleStatus:  'idle' | 'scanning' | 'connecting' | 'connected' | 'error';
  batteryPct: number;
  isSimMode:  boolean;
  pairedDeviceId: string | null;
  // Identità canonica del device, letta da IDENTITY 0xaa05 alla connessione
  // (contract v0.1.4/v0.2.0 §2): è l'UNICA sorgente del campo `device` dei
  // frame coach (§3). Il MAC del QR (pairedDeviceId) resta solo whitelist.
  deviceIdentity: string | null;

  // Stato BLE sensore ruota
  wheelSensorStatus: 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';
  wheelSensorId:     string | null;
  wheelStream:       WheelStream;

  // Stato BLE sensore cadenza
  cadenceSensorStatus: 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';
  cadenceSensorId:     string | null;

  // Discovery sensori firmware-driven (SENSOR_SCAN 0xaa0e, contract v0.2.2):
  // i candidati arrivano dal firmware (MAC reale), l'app li mostra e autorizza.
  discoveredSensors: DiscoveredSensor[];

  // Stato connessione dashboard coach (gestita da src/coach/link.ts)
  coachStatus:   'idle' | 'connecting' | 'connected' | 'error';
  coachErrorMsg: string;

  // Calibrazione Crr
  crrCalib: CrrCalibState;

  // Provenienza del Crr attivo — mostrata in LiveScreen
  // 'default'    → 0.004 hardcoded, nessuna calibrazione
  // 'manual'     → impostato manualmente in Impostazioni
  // 'calibrated' → misurato dal sensore ruota AeroDrag
  // 'profile'    → sovrascitto dal profilo atleta attivo
  crrSource: 'default' | 'manual' | 'calibrated' | 'profile';
  crrActive: number;  // valore Crr effettivamente usato nell'ultimo calcolo

  // Dati live
  sensor:  SensorInput;
  physics: PhysicsOutput;
  history: DataPoint[];
  lastDevicePhysicsAt: number;  // timestamp ultima fisica ricevuta da 0xaa09

  // Sessione
  isRecording:  boolean;
  elapsed:      number;
  sessionStart: number | null;
  currentLap:   number;
  laps:         LapStats[];
  lapStartIdx:  number;

  // Sessioni precedenti
  previousSessions: DataPoint[][];

  // Calibrazione e profili
  calib:           CalibrationParams;
  athleteProfiles: AthleteProfile[];
  activeAthleteId: string | null;

  // Actions BLE device principale
  setBleStatus:     (s: AeroDragStore['bleStatus']) => void;
  setBattery:       (pct: number) => void;
  setSimMode:       (v: boolean) => void;
  setPairedDevice:  (id: string | null) => void;
  setDeviceIdentity: (mac: string | null) => void;

  // Actions BLE sensore ruota
  setWheelSensorStatus: (s: AeroDragStore['wheelSensorStatus']) => void;
  setWheelSensorId:     (id: string | null) => void;
  updateWheelStream:    (s: WheelStream) => void;

  // Actions BLE sensore cadenza
  setCadenceSensorStatus: (s: AeroDragStore['cadenceSensorStatus']) => void;
  setCadenceSensorId:     (id: string | null) => void;

  // Actions discovery sensori (0xaa0e)
  addDiscoveredSensor:    (s: DiscoveredSensor) => void;
  clearDiscoveredSensors: () => void;

  // Actions coach
  setCoachStatus: (s: AeroDragStore['coachStatus'], err?: string) => void;

  // Actions calibrazione Crr
  startCrrCalib:    (protocol: 'indoor' | 'outdoor') => void;
  setCrrTargetSpeed: (kmh: number) => void;
  readyForSpinup:   () => void;
  startCrrRun:      () => void;
  finalizeCrrRun:   () => void;
  applyCrrResult:   () => void;
  resetCrrCalib:    () => void;
  loadCrrHistory:   () => Promise<void>;

  // Actions dati
  updateSensors:        (partial: Partial<SensorInput>) => void;
  setPhysicsFromDevice: (p: PhysicsOutput) => void;
  tick:                 () => void;

  // Actions sessione
  startSession: () => void;
  stopSession:  () => void;
  addLap:       () => void;

  // Calibrazione
  setCalib:     (c: Partial<CalibrationParams>) => void;
  loadCalib:    () => Promise<void>;

  // Profili atleti
  loadAthleteProfiles:  () => Promise<void>;
  saveAthleteProfile:   (p: AthleteProfile) => Promise<void>;
  deleteAthleteProfile: (id: string) => Promise<void>;
  setActiveAthlete:     (id: string | null) => void;

  // Sessioni precedenti
  loadPreviousSessions: () => Promise<void>;

  // Caricamento device accoppiato
  loadPairedDeviceId: () => Promise<void>;
}

export const useStore = create<AeroDragStore>((set, get) => ({
  // ── Stato iniziale ─────────────────────────────────────────────────────────
  bleStatus:       'idle',
  batteryPct:      0,
  isSimMode:       false,
  pairedDeviceId:  null,
  deviceIdentity:  null,
  wheelSensorStatus:   'idle',
  wheelSensorId:       null,
  wheelStream:         { speedMs: 0, accelMs2: 0, tempC: 20, vibRMS: 0 },
  cadenceSensorStatus: 'idle',
  cadenceSensorId:     null,
  discoveredSensors:   [],
  coachStatus:         'idle',
  coachErrorMsg:       '',
  crrCalib:          DEFAULT_CRR_CALIB,
  crrSource:         'default',
  crrActive:         DEFAULT_CALIB.crr,
  sensor:          EMPTY_SENSOR,
  physics:         EMPTY_PHYSICS,
  history:         [],
  lastDevicePhysicsAt: 0,
  isRecording:     false,
  elapsed:         0,
  sessionStart:    null,
  currentLap:      1,
  laps:            [],
  lapStartIdx:     0,
  previousSessions: [],
  calib:           DEFAULT_CALIB,
  athleteProfiles: [],
  activeAthleteId: null,

  // ── BLE device principale ──────────────────────────────────────────────────
  setBleStatus:    (s) => set({ bleStatus: s }),
  setBattery:      (pct) => set({ batteryPct: pct }),
  setSimMode:      (v) => set({ isSimMode: v }),
  setPairedDevice: (id) => set({ pairedDeviceId: id }),
  setDeviceIdentity: (mac) => set({ deviceIdentity: mac }),

  // ── BLE sensore ruota ──────────────────────────────────────────────────────
  setWheelSensorStatus: (s) => set({ wheelSensorStatus: s }),
  setWheelSensorId:     (id) => set({ wheelSensorId: id }),

  // ── BLE sensore cadenza ────────────────────────────────────────────────────
  setCadenceSensorStatus: (s) => set({ cadenceSensorStatus: s }),
  setCadenceSensorId:     (id) => set({ cadenceSensorId: id }),

  // ── Discovery sensori (0xaa0e) ───────────────────────────────────────────────
  addDiscoveredSensor: (s) => set((st) => (
    st.discoveredSensors.some((d) => d.mac === s.mac)
      ? {}
      : { discoveredSensors: [...st.discoveredSensors, s] }
  )),
  clearDiscoveredSensors: () => set({ discoveredSensors: [] }),

  // ── Coach ──────────────────────────────────────────────────────────────────
  setCoachStatus: (s, err) => set({ coachStatus: s, coachErrorMsg: err ?? '' }),
  updateWheelStream:    (s) => {
    set({ wheelStream: s });
    // Accumula campioni se è in corso un run di calibrazione
    const { crrCalib } = get();
    const recording = ['coast_indoor', 'coast_outdoor_a', 'coast_outdoor_b'].includes(crrCalib.mode);
    if (recording) {
      const sample: WheelSample = { t: Date.now(), ...s };
      set((st) => ({
        crrCalib: {
          ...st.crrCalib,
          activeSamples: [...st.crrCalib.activeSamples, sample],
        },
      }));
    }
  },

  // ── Calibrazione Crr ───────────────────────────────────────────────────────
  startCrrCalib: (protocol) => {
    set({
      crrCalib: {
        ...DEFAULT_CRR_CALIB,
        protocol,
        totalRuns:  protocol === 'indoor' ? 3 : 6,
        history:    get().crrCalib.history,
        mode:       'setup',
      },
    });
  },

  setCrrTargetSpeed: (kmh) => {
    set((st) => ({ crrCalib: { ...st.crrCalib, targetSpeedKmh: kmh } }));
  },

  readyForSpinup: () => {
    set((st) => ({ crrCalib: { ...st.crrCalib, mode: 'spinup' } }));
  },

  startCrrRun: () => {
    const { crrCalib } = get();
    const mode: CrrCalibMode = crrCalib.protocol === 'indoor'
      ? 'coast_indoor'
      : crrCalib.currentRun <= 3
        ? 'coast_outdoor_a'
        : 'coast_outdoor_b';
    set((st) => ({
      crrCalib: { ...st.crrCalib, mode, activeSamples: [] },
    }));
  },


  finalizeCrrRun: () => {
    const { crrCalib, calib, physics, athleteProfiles, activeAthleteId } = get();
    // Stessa massa inviata ai device: profilo atleta attivo se presente
    const activeProfile = athleteProfiles.find((p) => p.id === activeAthleteId);
    const massKg = (activeProfile?.massRiderKg ?? calib.massRiderKg)
                 + (activeProfile?.massBikeKg  ?? calib.massBikeKg);
    const params = {
      massKg,
      rhoKgM3:    physics.rhoKgM3 || 1.225,
      cdaM2:      physics.cda || 0,
      slopeDeg:   0,
      minSpeedMs: 2.0,
    };

    const runResult = fitCrrFromRun(crrCalib.activeSamples, params);
    let nextState: Partial<CrrCalibState>;

    if (crrCalib.protocol === 'indoor') {
      const newRuns = [...crrCalib.indoorRuns, runResult];
      const done = newRuns.length >= 3;
      nextState = {
        indoorRuns: newRuns,
        currentRun: crrCalib.currentRun + 1,
        activeSamples: [],
        mode: done ? 'computing' : 'spinup',
      };
      if (done) {
        const result = combineIndoorRuns(newRuns);
        result.surfaceLabel = surfaceLabelFromCrr(result.crr);
        nextState = { ...nextState, result, mode: 'done' };
      }
    } else {
      const isA = crrCalib.currentRun <= 3;
      const newA = isA ? [...crrCalib.outdoorRunsA, runResult] : crrCalib.outdoorRunsA;
      const newB = isA ? crrCalib.outdoorRunsB : [...crrCalib.outdoorRunsB, runResult];
      const done = newA.length >= 3 && newB.length >= 3;
      nextState = {
        outdoorRunsA: newA,
        outdoorRunsB: newB,
        currentRun: crrCalib.currentRun + 1,
        activeSamples: [],
        mode: done ? 'computing' : 'spinup',
      };
      if (done) {
        const result = combineOutdoorRuns(newA, newB);
        result.surfaceLabel = surfaceLabelFromCrr(result.crr);
        nextState = { ...nextState, result, mode: 'done' };
      }
    }

    set((st) => ({ crrCalib: { ...st.crrCalib, ...nextState } }));
  },

  applyCrrResult: () => {
    const { crrCalib } = get();
    if (!crrCalib.result) return;
    const newHistory = [crrCalib.result, ...crrCalib.history].slice(0, 20);
    get().setCalib({ crr: crrCalib.result.crr });
    set((st) => ({
      crrCalib: { ...st.crrCalib, history: newHistory },
    }));
    AsyncStorage.setItem('aerodrag:crr_history', JSON.stringify(newHistory)).catch(() => {});
  },

  resetCrrCalib: () => {
    set((st) => ({
      crrCalib: { ...DEFAULT_CRR_CALIB, history: st.crrCalib.history },
    }));
  },

  loadCrrHistory: async () => {
    try {
      const raw = await AsyncStorage.getItem('aerodrag:crr_history');
      if (raw) {
        const history = JSON.parse(raw) as CrrCalibResult[];
        set((st) => ({ crrCalib: { ...st.crrCalib, history } }));
      }
    } catch {}
  },

  // ── Dati ───────────────────────────────────────────────────────────────────
  updateSensors: (partial) => {
    const { sensor, calib } = get();
    const next: SensorInput = { ...sensor, ...partial };

    // Applica offset calibrazione Pitot
    next.pitotPa = Math.max(0, next.pitotPa - calib.pitotOffset);

    // Calcola fisica
    const activeProfile = get().athleteProfiles.find(
      (p) => p.id === get().activeAthleteId
    );
    const mass = (activeProfile?.massRiderKg ?? calib.massRiderKg)
               + (activeProfile?.massBikeKg  ?? calib.massBikeKg);

    // Determina il Crr attivo e la sua provenienza
    let crr: number;
    let crrSource: AeroDragStore['crrSource'];
    if (activeProfile?.crr !== undefined) {
      crr = activeProfile.crr;
      crrSource = 'profile';
    } else {
      crr = calib.crr;
      const history = get().crrCalib.history;
      const lastCalibCrr = history.length > 0 ? history[0].crr : null;
      const isDefault = Math.abs(crr - DEFAULT_CALIB.crr) < 0.00001;
      if (lastCalibCrr !== null && Math.abs(crr - lastCalibCrr) < 0.00001) {
        crrSource = 'calibrated';
      } else if (isDefault && history.length === 0) {
        crrSource = 'default';
      } else {
        crrSource = 'manual';
      }
    }

    // Fisica locale solo come fallback: se l'ESP32 sta notificando la sua
    // fisica su 0xaa09 (sorgente di verità), non sovrascriverla col ricalcolo
    // locale — altrimenti il CdA visualizzato flippa tra i due valori.
    // Finestra stretta (500 ms): la PHYSICS è a 10 Hz, quindi se il device tace
    // per >500 ms la consideriamo stantia e ricalcoliamo localmente (evita di
    // inviare al coach un CdA vecchio a 2 Hz quando arriva solo ENV a 1 Hz).
    const deviceFresh = Date.now() - get().lastDevicePhysicsAt < 500;
    if (deviceFresh) {
      set({ sensor: next, crrSource, crrActive: crr });
    } else {
      const physics = computePhysics(next, mass, crr);
      set({ sensor: next, physics, crrSource, crrActive: crr });
    }
  },

  // Sovrascrive la fisica con il valore calcolato direttamente dall'ESP32.
  // Chiamato ogni volta che arriva una notifica su CHR_PHYSICS (0xaa09).
  setPhysicsFromDevice: (p) => set({ physics: p, lastDevicePhysicsAt: Date.now() }),

  tick: () => {
    const { isRecording, sessionStart, sensor, physics, history } = get();
    if (!isRecording || !sessionStart) return;

    const now     = Date.now();
    const elapsed = Math.floor((now - sessionStart) / 1000);
    const point: DataPoint = { t: now, physics, sensor };

    set({
      elapsed,
      history: [...history, point],
    });
  },

  // ── Sessione ───────────────────────────────────────────────────────────────
  startSession: () =>
    set({
      isRecording:  true,
      sessionStart: Date.now(),
      elapsed:      0,
      history:      [],
      currentLap:   1,
      laps:         [],
      lapStartIdx:  0,
    }),

  stopSession: () => {
    const { history, previousSessions } = get();
    const nextSessions = history.length > 0
      ? [history, ...previousSessions].slice(0, 10)
      : previousSessions;
    set({
      isRecording:  false,
      sessionStart: null,
      previousSessions: nextSessions,
    });
    if (history.length > 0) {
      AsyncStorage.setItem('aerodrag:sessions', JSON.stringify(nextSessions))
        .catch(() => {});
    }
  },

  addLap: () => {
    const { history, currentLap, laps, lapStartIdx } = get();
    const lapPoints = history.slice(lapStartIdx);
    if (lapPoints.length === 0) return;

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const lap: LapStats = {
      index:      currentLap,
      startT:     lapPoints[0].t,
      endT:       lapPoints[lapPoints.length - 1].t,
      avgCda:     avg(lapPoints.map((p) => p.physics.cda)),
      avgPowerW:  avg(lapPoints.map((p) => p.sensor.powerW)),
      avgSpeedMs: avg(lapPoints.map((p) => p.sensor.speedMs)),
      avgHrBpm:   avg(lapPoints.map((p) => p.sensor.hrBpm)),
      points:     lapPoints.length,
    };

    set({
      laps:        [...laps, lap],
      currentLap:  currentLap + 1,
      lapStartIdx: history.length,
    });
  },

  // ── Calibrazione ───────────────────────────────────────────────────────────
  setCalib: (c) => {
    const next = { ...get().calib, ...c };
    set({ calib: next });
    AsyncStorage.setItem('aerodrag:calib', JSON.stringify(next))
      .catch((e) => console.warn('[store] persistenza calib fallita:', e));
  },

  loadCalib: async () => {
    try {
      const raw = await AsyncStorage.getItem('aerodrag:calib');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Migrazione da massKg unico a massRiderKg + massBikeKg
        if (parsed.massKg !== undefined && parsed.massRiderKg === undefined) {
          // massa rider = totale − bici(8); floor 30 kg (min UI), non 40:
          // con floor 40 una massa totale < 48 kg dava un rider sovrastimato.
          parsed.massRiderKg = Math.max(parsed.massKg - 8, 30);
          parsed.massBikeKg  = 8;
          delete parsed.massKg;
        }
        set({ calib: { ...DEFAULT_CALIB, ...parsed } });
      }
    } catch {}
  },

  // ── Profili atleti ─────────────────────────────────────────────────────────
  loadAthleteProfiles: async () => {
    try {
      const raw = await AsyncStorage.getItem('aerodrag:athletes');
      if (raw) {
        const profiles = (JSON.parse(raw) as any[]).map((p) => {
          // Migrazione da massKg unico a massRiderKg + massBikeKg
          if (p.massKg !== undefined && p.massRiderKg === undefined) {
            return { ...p, massRiderKg: Math.max(p.massKg - 8, 30), massBikeKg: 8 };
          }
          return p;
        });
        set({ athleteProfiles: profiles });
      }
    } catch {}
  },

  saveAthleteProfile: async (p) => {
    const profiles = get().athleteProfiles;
    const idx      = profiles.findIndex((x) => x.id === p.id);
    const next     = idx >= 0
      ? profiles.map((x) => (x.id === p.id ? p : x))
      : [...profiles, p];
    set({ athleteProfiles: next });
    await AsyncStorage.setItem('aerodrag:athletes', JSON.stringify(next));
  },

  deleteAthleteProfile: async (id) => {
    const next = get().athleteProfiles.filter((p) => p.id !== id);
    set({ athleteProfiles: next });
    await AsyncStorage.setItem('aerodrag:athletes', JSON.stringify(next));
  },

  setActiveAthlete: (id) => set({ activeAthleteId: id }),

  // ── Sessioni precedenti ────────────────────────────────────────────────────
  loadPreviousSessions: async () => {
    try {
      const raw = await AsyncStorage.getItem('aerodrag:sessions');
      if (raw) set({ previousSessions: JSON.parse(raw) });
    } catch {}
  },

  loadPairedDeviceId: async () => {
    const d = await loadPairedDevice();
    if (d) set({ pairedDeviceId: d.id });
  },
}));

// Re-export Crr types for convenience (CrrCalibMode è già esportato sopra)
export type { WheelSample, CrrRunResult, CrrCalibResult };