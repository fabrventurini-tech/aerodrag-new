import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SensorInput, PhysicsOutput, computePhysics } from '../physics/engine';
import { loadPairedDevice } from '../security/pairing';

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
  id:     string;
  name:   string;
  massKg: number;
  crr:    number;
}

export interface CalibrationParams {
  massKg: number;
  crr:    number;
  pitotOffset: number;
}

// ── Stato default ─────────────────────────────────────────────────────────────

const DEFAULT_CALIB: CalibrationParams = {
  massKg:      75,
  crr:         0.004,
  pitotOffset: 0,
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
  // Stato BLE
  bleStatus:  'idle' | 'scanning' | 'connecting' | 'connected' | 'error';
  batteryPct: number;
  isSimMode:  boolean;
  pairedDeviceId: string | null;

  // Dati live
  sensor:  SensorInput;
  physics: PhysicsOutput;
  history: DataPoint[];

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

  // Actions BLE
  setBleStatus:     (s: AeroDragStore['bleStatus']) => void;
  setBattery:       (pct: number) => void;
  setSimMode:       (v: boolean) => void;
  setPairedDevice:  (id: string | null) => void;

  // Actions dati
  updateSensors: (partial: Partial<SensorInput>) => void;
  tick:          () => void;

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
  sensor:          EMPTY_SENSOR,
  physics:         EMPTY_PHYSICS,
  history:         [],
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

  // ── BLE ────────────────────────────────────────────────────────────────────
  setBleStatus:    (s) => set({ bleStatus: s }),
  setBattery:      (pct) => set({ batteryPct: pct }),
  setSimMode:      (v) => set({ isSimMode: v }),
  setPairedDevice: (id) => set({ pairedDeviceId: id }),

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
    const mass = activeProfile?.massKg ?? calib.massKg;
    const crr  = activeProfile?.crr    ?? calib.crr;
    const physics = computePhysics(next, mass, crr);

    set({ sensor: next, physics });
  },

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
      if (raw) set({ calib: { ...DEFAULT_CALIB, ...JSON.parse(raw) } });
    } catch {}
  },

  // ── Profili atleti ─────────────────────────────────────────────────────────
  loadAthleteProfiles: async () => {
    try {
      const raw = await AsyncStorage.getItem('aerodrag:athletes');
      if (raw) set({ athleteProfiles: JSON.parse(raw) });
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