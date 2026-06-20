/**
 * link.ts — connessione WebSocket persistente verso la dashboard coach (Pi).
 *
 * La connessione vive a livello modulo, NON dentro CoachScreen: il socket
 * sopravvive al cambio di tab (App.tsx monta le schermate condizionalmente,
 * quindi qualsiasi risorsa creata dentro CoachScreen morirebbe appena
 * l'atleta torna alla schermata Live). CoachScreen è solo UI: mostra lo
 * stato dal global store e chiama coachConnect / coachDisconnect.
 *
 * Protocollo (vedi review dashboard):
 *   App → Pi  hello:  { type:'hello', device, athlete }
 *   App → Pi  data:   { t, device, athlete, lap, CdA, pwr, spd, hr, cad,
 *                       wind, battery, pctAero, pitch, rho, lapEvent }
 *                     @ 2 Hz, solo se physics.valid  (contract v0.1.0)
 *   Pi → App  cmd:    { type:'cmd', action:'start'|'stop'|'lap' }
 *
 * Identità (contract v0.1.2 §3): il campo `device` è OBBLIGATORIO e DEVE essere
 * un MAC valido. Il Pi rifiuta all'ingestione i frame senza `device` valido
 * (nessuna sessione anonima), quindi l'app NON invia né `hello` né frame finché
 * non è accoppiata a un device con MAC valido (il pairing QR fornisce il MAC).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../store';
import { isValidMAC } from '../security/pairing';

const KEY_COACH_URL = 'aerodrag:coach_url';
const SEND_INTERVAL_MS = 500;   // 2 Hz
const RECONNECT_DELAY_MS = 5000;

let ws: WebSocket | null = null;
let sendTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let storeUnsub: (() => void) | null = null;
let manualDisconnect = false;
let prevLapSent = 0;   // per emettere lapEvent una sola volta al cambio giro

export async function loadCoachUrl(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_COACH_URL);
  } catch {
    return null;
  }
}

export async function saveCoachUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(KEY_COACH_URL, url);
}

/** Riconnette all'avvio dell'app se un URL era stato salvato. */
export function coachAutoConnect(): void {
  loadCoachUrl().then((u) => {
    if (u) coachConnect(u);
  });
}

function sendHello(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const state = useStore.getState();
  // contract v0.1.4/v0.2.0 §2: l'identità canonica è quella letta da IDENTITY
  // 0xaa05 (deviceIdentity). Il MAC del QR è solo fallback whitelist.
  // §3: senza un `device` MAC valido il Pi rifiuta i frame → non annunciamo
  // l'identità finché non è disponibile.
  const device = state.deviceIdentity ?? state.pairedDeviceId;
  if (!device || !isValidMAC(device)) return;
  const profile = state.athleteProfiles.find((p) => p.id === state.activeAthleteId);
  ws.send(JSON.stringify({
    type:    'hello',
    device,
    athlete: profile?.name ?? 'Atleta',
  }));
}

function startDataLoop(): void {
  if (sendTimer) clearInterval(sendTimer);
  // Allinea il marker al giro corrente: nessun lapEvent spurio al (ri)connect
  prevLapSent = useStore.getState().currentLap;
  sendTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const {
      physics: p, sensor: s, batteryPct: bat,
      currentLap: lap, deviceIdentity, pairedDeviceId,
      activeAthleteId: aid, athleteProfiles: profiles,
    } = useStore.getState();

    if (!p.valid) return;
    // contract v0.2.0 §2/§3: `device` = identità canonica da 0xaa05
    // (fallback al MAC del QR). Deve essere un MAC valido, altrimenti il Pi
    // scarta il frame all'ingestione (nessuna sessione anonima). In sim mode /
    // app non accoppiata non c'è identità → non si invia.
    const devId = deviceIdentity ?? pairedDeviceId;
    if (!devId || !isValidMAC(devId)) return;

    const athleteName = profiles.find((x) => x.id === aid)?.name ?? 'Atleta';
    // vento = velocità aria relativa − velocità a terra (componente frontale)
    const wind = Math.max(0, +(p.vAirMs - s.speedMs).toFixed(2));
    // lapEvent: true solo sul primo frame dopo un INCREMENTO di giro (il Pi lo
    // usa come marker). Usiamo `>` e non `!==`: a un restart sessione currentLap
    // torna a 1 (< prevLapSent) → niente lapEvent spurio (§3: "una sola volta
    // al cambio giro"). prevLapSent traccia comunque l'ultimo giro inviato.
    const lapEvent = lap > prevLapSent;
    prevLapSent = lap;

    ws.send(JSON.stringify({
      t:        Date.now(),
      device:   devId,
      athlete:  athleteName,
      lap,
      CdA:      +p.cda.toFixed(4),
      pwr:      Math.round(s.powerW),
      spd:      +(s.speedMs * 3.6).toFixed(1),   // m/s → km/h
      hr:       s.hrBpm,
      cad:      s.cadenceRpm,
      wind,
      battery:  bat,
      pctAero:  +p.pctAero.toFixed(1),
      pitch:    +s.pitchDeg.toFixed(1),          // contract v0.1.0
      rho:      +p.rhoKgM3.toFixed(4),           // contract v0.1.0
      lapEvent,                                  // contract v0.1.0
    }));
  }, SEND_INTERVAL_MS);
}

// Re-invia hello quando cambia atleta attivo o i profili finiscono di caricare
// (risolve il race condition: onopen può scattare prima di loadAthleteProfiles)
function watchProfileChanges(): void {
  if (storeUnsub) return;
  let prevAthleteId = useStore.getState().activeAthleteId;
  let prevProfiles  = useStore.getState().athleteProfiles;
  storeUnsub = useStore.subscribe((state) => {
    if (state.activeAthleteId !== prevAthleteId || state.athleteProfiles !== prevProfiles) {
      prevAthleteId = state.activeAthleteId;
      prevProfiles  = state.athleteProfiles;
      sendHello();
    }
  });
}

function clearTimers(): void {
  if (sendTimer)      { clearInterval(sendTimer);    sendTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

export function coachConnect(targetUrl: string): void {
  coachDisconnect();
  manualDisconnect = false;

  const { setCoachStatus } = useStore.getState();

  if (!targetUrl.startsWith('ws://') && !targetUrl.startsWith('wss://')) {
    setCoachStatus('error', 'URL deve iniziare con ws:// o wss://');
    return;
  }

  setCoachStatus('connecting');
  try {
    ws = new WebSocket(targetUrl);

    ws.onopen = () => {
      useStore.getState().setCoachStatus('connected');
      sendHello();
      watchProfileChanges();
      startDataLoop();
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'cmd') {
          if      (msg.action === 'start') useStore.getState().startSession();
          else if (msg.action === 'stop')  useStore.getState().stopSession();
          else if (msg.action === 'lap')   useStore.getState().addLap();
        }
      } catch {}
    };

    ws.onerror = () => {
      useStore.getState().setCoachStatus('error', 'Errore di connessione');
    };

    ws.onclose = () => {
      if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
      if (manualDisconnect) return;
      useStore.getState().setCoachStatus('error');
      reconnectTimer = setTimeout(() => coachConnect(targetUrl), RECONNECT_DELAY_MS);
    };
  } catch (e: any) {
    setCoachStatus('error', String(e?.message ?? e));
  }
}

export function coachDisconnect(): void {
  manualDisconnect = true;
  clearTimers();
  if (storeUnsub) { storeUnsub(); storeUnsub = null; }   // evita leak della subscription
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    try { ws.close(); } catch {}
    ws = null;
  }
  useStore.getState().setCoachStatus('idle');
}
