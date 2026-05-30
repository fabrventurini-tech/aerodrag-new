import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SensorInput, PhysicsOutput, computePhysics } from '../physics/engine';
import { CrrSample, CrrRunResult, CrrResult, aggregateCrr, computeCrrFromRun } from '../physics/crr';
import { computeRMSSD } from '../ble/protocols';
import {
  loadPairedDevice, loadPairedWheel, loadPairedHR,
  HRDeviceType,
} from '../security/pairing';

// ── Tipi ──────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';
export type DeviceRole       = 'main' | 'wheel' | 'hr';

export interface DataPoint {
  t:       number;
  physics: PhysicsOutput;
  sensor:  SensorInput;
}

export interface LapStats {
  index:             number;
  startT:            number;
  endT:              number;
  avgCda:            number;
  avgPowerW:         number;
  avgSpeedMs:        number;
  avgHrBpm:          number;
  avgTrunkPitchDeg:  number;
  avgLateralOscMm:   number;
  avgVibIdx:         number;
  points:            number;
}

export interface AthleteProfile {
  id:          string;
  name:        string;
  massRiderKg: number;
  massBikeKg:  number;
  crr:         number;
}

export interface CalibrationParams {
  massRiderKg: number;
  massBikeKg:  number;
  crr:         number;
  pitotOffset: number;
}

export interface WheelData {
  ax: number; ay: number; az: number;
  gx: number; gy: number; gz: number;
  speedMs:        number;
  decelMs2:       number;
  wheelTempC:     number;
  vibrationIndex: number;
}

/** Device scoperto durante la discovery scan, prima del pairing */
export interface DiscoveredDevice {
  id:     string;
  name:   string | null;
  rssi:   number;
  hrType?: 'aerodrag' | 'standard';
}

// ── Default ───────────────────────────────────────────────────────────────────

const DEFAULT_CALIB: CalibrationParams = {
  massRiderKg: 70,
  massBikeKg:  8,
  crr:         0.004,
  pitotOffset: 0,
};

const EMPTY_SENSOR: SensorInput = {
  pitotPa: 0, staticPa: 101325, tempC: 20, humidity: 0.5,
  altM: 0, pitchDeg: 0, rollDeg: 0, powerW: 0,
  speedMs: 0, cadenceRpm: 0, hrBpm: 0,
  trunkPitchDeg: 0, trunkRollDeg: 0, lateralOscMm: 0,
  respBreathMin: 0, skinTempC: 0,
};

const EMPTY_PHYSICS: PhysicsOutput = {
  cda: 0, pAeroW: 0, pRollingW: 0, pGravityW: 0,
  vAirMs: 0, rhoKgM3: 1.225, pctAero: 0, valid: false,
};

const EMPTY_WHEEL: WheelData = {
  ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0,
  speedMs: 0, decelMs2: 0, wheelTempC: 0, vibrationIndex: 0,
};

// ── Store ─────────────────────────────────────────────────────────────────────

interface AeroDragStore {
  // ── BLE multi-device ──────────────────────────────────────────────────────

  /** Alias per bleStatus del device principale (compatibilità TopBar) */
  bleStatus:    ConnectionStatus;
  wheelStatus:  ConnectionStatus;
  hrStatus:     ConnectionStatus;

  batteryPct:   number;   // device principale
  wheelBattery: number;
  hrBattery:    number;

  isSimMode: boolean;

  // ID device accoppiati
  pairedDeviceId: string | null;   // device principale
  pairedWheelId:  string | null;
  pairedHRId:     string | null;
  pairedHRType:   HRDeviceType;

  // ── Discovery ─────────────────────────────────────────────────────────────
  isDiscovering:     boolean;
  discoveryTarget:   'wheel' | 'hr' | null;
  discoveredDevices: DiscoveredDevice[];

  // ── Dati live ─────────────────────────────────────────────────────────────
  sensor:  SensorInput;
  physics: PhysicsOutput;
  history: DataPoint[];

  wheelData: WheelData;

  /** Ultimi RR intervals accumulati (max 32) per calcolo RMSSD */
  rrBuffer: number[];
  hrRMSSD:  number;

  // ── Sessione ──────────────────────────────────────────────────────────────
  isRecording:  boolean;
  elapsed:      number;
  sessionStart: number | null;
  currentLap:   number;
  laps:         LapStats[];
  lapStartIdx:  number;
  previousSessions: DataPoint[][];

  // ── Crr coast-down ────────────────────────────────────────────────────────
  crrMode:       'idle' | 'coasting' | 'done';
  crrSamples:    CrrSample[];    // campioni del run corrente
  crrRunCrrs:    number[];       // Crr di ogni run completato
  crrResult:     CrrResult | null;
  crrRunResult:  CrrRunResult | null;

  // ── Calibrazione e profili ────────────────────────────────────────────────
  calib:           CalibrationParams;
  athleteProfiles: AthleteProfile[];
  activeAthleteId: string | null;

  // ── Actions BLE ───────────────────────────────────────────────────────────
  setDeviceStatus:  (role: DeviceRole, s: ConnectionStatus) => void;
  setBattery:       (pct: number) => void;
  setWheelBattery:  (pct: number) => void;
  setHRBattery:     (pct: number) => void;
  setSimMode:       (v: boolean) => void;
  setPairedDevice:  (id: string | null) => void;
  setPairedWheel:   (id: string | null) => void;
  setPairedHR:      (id: string | null, hrType?: HRDeviceType) => void;

  // ── Actions discovery ─────────────────────────────────────────────────────
  startDiscovery:      (target: 'wheel' | 'hr') => void;
  stopDiscovery:       () => void;
  addDiscoveredDevice: (d: DiscoveredDevice) => void;

  // ── Actions dati ──────────────────────────────────────────────────────────
  updateSensors:  (partial: Partial<SensorInput>) => void;
  updateWheel:    (partial: Partial<WheelData>) => void;
  appendRR:       (rrMs: number[]) => void;
  tick:           () => void;

  // ── Actions sessione ──────────────────────────────────────────────────────
  startSession: () => void;
  stopSession:  () => void;
  addLap:       () => void;

  // ── Actions Crr ───────────────────────────────────────────────────────────
  startCrrCoast:  () => void;
  addCrrSample:   (s: CrrSample) => void;
  finalizeCrrRun: () => void;
  resetCrr:       () => void;

  // ── Calibrazione ──────────────────────────────────────────────────────────
  setCalib:  (c: Partial<CalibrationParams>) => void;
  loadCalib: () => Promise<void>;

  // ── Profili atleti ────────────────────────────────────────────────────────
  loadAthleteProfiles:  () => Promise<void>;
  saveAthleteProfile:   (p: AthleteProfile) => Promise<void>;
  deleteAthleteProfile: (id: string) => Promise<void>;
  setActiveAthlete:     (id: string | null) => void;

  // ── Sessioni precedenti ───────────────────────────────────────────────────
  loadPreviousSessions: () => Promise<void>;

  // ── Caricamento pairing da storage ───────────────────────────────────────
  loadPairedDeviceId:   () => Promise<void>;
  loadPairedPeripherals: () => Promise<void>;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ── Store Zustand ─────────────────────────────────────────────────────────────

export const useStore = create<AeroDragStore>((set, get) => ({
  // ── Stato iniziale ────────────────────────────────────────────────────────
  bleStatus:    'idle',
  wheelStatus:  'idle',
  hrStatus:     'idle',
  batteryPct:   0,
  wheelBattery: 0,
  hrBattery:    0,
  isSimMode:    false,

  pairedDeviceId: null,
  pairedWheelId:  null,
  pairedHRId:     null,
  pairedHRType:   'standard',

  isDiscovering:     false,
  discoveryTarget:   null,
  discoveredDevices: [],

  sensor:    EMPTY_SENSOR,
  physics:   EMPTY_PHYSICS,
  history:   [],
  wheelData: EMPTY_WHEEL,
  rrBuffer:  [],
  hrRMSSD:   0,

  isRecording:      false,
  elapsed:          0,
  sessionStart:     null,
  currentLap:       1,
  laps:             [],
  lapStartIdx:      0,
  previousSessions: [],

  crrMode:      'idle',
  crrSamples:   [],
  crrRunCrrs:   [],
  crrResult:    null,
  crrRunResult: null,

  calib:           DEFAULT_CALIB,
  athleteProfiles: [],
  activeAthleteId: null,

  // ── BLE status ────────────────────────────────────────────────────────────

  setDeviceStatus: (role, s) => {
    if (role === 'main')  set({ bleStatus:   s });
    if (role === 'wheel') set({ wheelStatus: s });
    if (role === 'hr')    set({ hrStatus:    s });
  },

  setBattery:      (pct) => set({ batteryPct: pct }),
  setWheelBattery: (pct) => set({ wheelBattery: pct }),
  setHRBattery:    (pct) => set({ hrBattery: pct }),
  setSimMode:      (v)   => set({ isSimMode: v }),

  setPairedDevice: (id) => set({ pairedDeviceId: id }),
  setPairedWheel:  (id) => set({ pairedWheelId: id }),
  setPairedHR:     (id, hrType = 'standard') => set({ pairedHRId: id, pairedHRType: hrType }),

  // ── Discovery ─────────────────────────────────────────────────────────────

  startDiscovery: (target) => set({
    isDiscovering:     true,
    discoveryTarget:   target,
    discoveredDevices: [],
  }),

  stopDiscovery: () => set({
    isDiscovering:   false,
    discoveryTarget: null,
  }),

  addDiscoveredDevice: (d) => set(state => ({
    discoveredDevices: state.discoveredDevices.some(x => x.id === d.id)
      ? state.discoveredDevices
      : [...state.discoveredDevices, d],
  })),

  // ── Dati sensori ──────────────────────────────────────────────────────────

  updateSensors: (partial) => {
    const { sensor, calib } = get();
    const next: SensorInput = { ...sensor, ...partial };
    next.pitotPa = Math.max(0, next.pitotPa - calib.pitotOffset);

    const activeProfile = get().athleteProfiles.find(p => p.id === get().activeAthleteId);
    const mass   = (activeProfile?.massRiderKg ?? calib.massRiderKg)
                 + (activeProfile?.massBikeKg  ?? calib.massBikeKg);
    const crr    = activeProfile?.crr ?? calib.crr;
    const physics = computePhysics(next, mass, crr);

    set({ sensor: next, physics });
  },

  updateWheel: (partial) => {
    set(state => ({ wheelData: { ...state.wheelData, ...partial } }));

    // Durante coast-down attivo, aggiunge campione Crr
    const { crrMode, crrSamples } = get();
    const wheel = { ...get().wheelData, ...partial };
    if (crrMode === 'coasting' && wheel.decelMs2 > 0) {
      const sample: CrrSample = {
        timestamp: Date.now(),
        speedMs:   wheel.speedMs,
        decelMs2:  wheel.decelMs2,
        gradient:  0, // TODO: ricavare da barometro fascia HR se disponibile
      };
      set({ crrSamples: [...crrSamples, sample] });
    }

    // Sincronizza speedMs nel sensor principale se il sensore ruota è la fonte più recente
    if (partial.speedMs !== undefined) {
      get().updateSensors({ speedMs: partial.speedMs });
    }
  },

  appendRR: (rrMs) => {
    if (rrMs.length === 0) return;
    set(state => {
      const combined = [...state.rrBuffer, ...rrMs].slice(-32); // mantieni max 32 campioni
      const hrRMSSD  = computeRMSSD(combined);
      return { rrBuffer: combined, hrRMSSD };
    });
  },

  // ── Tick sessione (1 Hz) ──────────────────────────────────────────────────

  tick: () => {
    const { isRecording, sessionStart, sensor, physics, history } = get();
    if (!isRecording || !sessionStart) return;

    const now     = Date.now();
    const elapsed = Math.floor((now - sessionStart) / 1000);
    const point: DataPoint = { t: now, physics, sensor };

    set({ elapsed, history: [...history, point] });
  },

  // ── Sessione ──────────────────────────────────────────────────────────────

  startSession: () => set({
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
    set({ isRecording: false, sessionStart: null, previousSessions: nextSessions });
    if (history.length > 0) {
      AsyncStorage.setItem('aerodrag:sessions', JSON.stringify(nextSessions)).catch(() => {});
    }
  },

  addLap: () => {
    const { history, currentLap, laps, lapStartIdx } = get();
    const pts = history.slice(lapStartIdx);
    if (pts.length === 0) return;

    const lap: LapStats = {
      index:            currentLap,
      startT:           pts[0].t,
      endT:             pts[pts.length - 1].t,
      avgCda:           avg(pts.map(p => p.physics.cda)),
      avgPowerW:        avg(pts.map(p => p.sensor.powerW)),
      avgSpeedMs:       avg(pts.map(p => p.sensor.speedMs)),
      avgHrBpm:         avg(pts.map(p => p.sensor.hrBpm)),
      avgTrunkPitchDeg: avg(pts.map(p => p.sensor.trunkPitchDeg)),
      avgLateralOscMm:  avg(pts.map(p => p.sensor.lateralOscMm)),
      avgVibIdx:        avg(pts.map(p => (p.sensor as any).vibrationIndex ?? 0)),
      points:           pts.length,
    };
    set({ laps: [...laps, lap], currentLap: currentLap + 1, lapStartIdx: history.length });
  },

  // ── Crr coast-down ────────────────────────────────────────────────────────

  startCrrCoast: () => set({ crrMode: 'coasting', crrSamples: [], crrRunResult: null }),

  addCrrSample: (s) => set(state => ({ crrSamples: [...state.crrSamples, s] })),

  finalizeCrrRun: () => {
    const { crrSamples, crrRunCrrs } = get();
    const result = computeCrrFromRun(crrSamples);
    const nextRuns = result.valid ? [...crrRunCrrs, result.crr] : crrRunCrrs;
    const aggregated = aggregateCrr(nextRuns);
    set({
      crrMode:      'done',
      crrRunResult: result,
      crrRunCrrs:   nextRuns,
      crrResult:    aggregated,
    });
  },

  resetCrr: () => set({
    crrMode:      'idle',
    crrSamples:   [],
    crrRunCrrs:   [],
    crrResult:    null,
    crrRunResult: null,
  }),

  // ── Calibrazione ──────────────────────────────────────────────────────────

  setCalib: (c) => {
    const next = { ...get().calib, ...c };
    set({ calib: next });
    AsyncStorage.setItem('aerodrag:calib', JSON.stringify(next)).catch(() => {});
  },

  loadCalib: async () => {
    try {
      const raw = await AsyncStorage.getItem('aerodrag:calib');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Migrazione da massKg unico
      if (parsed.massKg !== undefined && parsed.massRiderKg === undefined) {
        parsed.massRiderKg = Math.max(parsed.massKg - 8, 40);
        parsed.massBikeKg  = 8;
        delete parsed.massKg;
      }
      set({ calib: { ...DEFAULT_CALIB, ...parsed } });
    } catch {}
  },

  // ── Profili atleti ────────────────────────────────────────────────────────

  loadAthleteProfiles: async () => {
    try {
      const raw = await AsyncStorage.getItem('aerodrag:athletes');
      if (!raw) return;
      const profiles = (JSON.parse(raw) as any[]).map(p => {
        if (p.massKg !== undefined && p.massRiderKg === undefined) {
          return { ...p, massRiderKg: Math.max(p.massKg - 8, 40), massBikeKg: 8 };
        }
        return p;
      });
      set({ athleteProfiles: profiles });
    } catch {}
  },

  saveAthleteProfile: async (p) => {
    const profiles = get().athleteProfiles;
    const idx      = profiles.findIndex(x => x.id === p.id);
    const next     = idx >= 0 ? profiles.map(x => x.id === p.id ? p : x) : [...profiles, p];
    set({ athleteProfiles: next });
    await AsyncStorage.setItem('aerodrag:athletes', JSON.stringify(next));
  },

  deleteAthleteProfile: async (id) => {
    const next = get().athleteProfiles.filter(p => p.id !== id);
    set({ athleteProfiles: next });
    await AsyncStorage.setItem('aerodrag:athletes', JSON.stringify(next));
  },

  setActiveAthlete: (id) => set({ activeAthleteId: id }),

  // ── Sessioni precedenti ───────────────────────────────────────────────────

  loadPreviousSessions: async () => {
    try {
      const raw = await AsyncStorage.getItem('aerodrag:sessions');
      if (raw) set({ previousSessions: JSON.parse(raw) });
    } catch {}
  },

  // ── Caricamento pairing ───────────────────────────────────────────────────

  loadPairedDeviceId: async () => {
    const d = await loadPairedDevice();
    if (d) set({ pairedDeviceId: d.id });
  },

  loadPairedPeripherals: async () => {
    const [wheel, hr] = await Promise.all([loadPairedWheel(), loadPairedHR()]);
    if (wheel) set({ pairedWheelId: wheel.id });
    if (hr)    set({ pairedHRId: hr.device.id, pairedHRType: hr.hrType });
  },
}));
