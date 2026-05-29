/**
 * AeroDrag Wheel Sensor — Firmware v1.0
 *
 * Hardware supportato:
 *   - Seeed XIAO nRF52840 Sense  (IMU integrata LSM6DS3TR-C, V1)
 *   - Seeed XIAO nRF52840        (IMU esterna ICM-42688-P via SPI, V2)
 *
 * Abilitare la build V1 (IMU integrata):
 *   #define USE_BUILTIN_IMU  1
 *
 * Abilitare la build V2 (ICM-42688-P esterno):
 *   #define USE_BUILTIN_IMU  0
 *
 * Dipendenze Arduino (Library Manager):
 *   - Adafruit nRF52 BSP (scheda: "Seeed nRF52 Boards")
 *   - Seeed_Arduino_LSM6DS3 (solo se USE_BUILTIN_IMU = 1)
 *
 * Pin mapping XIAO nRF52840:
 *   D7  → CS IMU esterno
 *   D6  → INT1 IMU esterno (data ready a 200 Hz)
 *   D8  → SCK
 *   D9  → MISO
 *   D10 → MOSI
 *   D2  → LED stato BLE (verde)
 *   D3  → LED carica (rosso, segnale da MX1C506A CHG pin)
 *   USB-C → ricarica + DFU bootloader (doppio click reset)
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Configurazione build
// ─────────────────────────────────────────────────────────────────────────────

#define USE_BUILTIN_IMU   1   // 1 = LSM6DS3 integrato, 0 = ICM-42688-P esterno
#define DEBUG_SERIAL      0   // 1 = abilita output USB CDC (debug)
#define SAMPLE_RATE_HZ    200
#define STREAM_RATE_HZ    10  // rate notifica BLE BB01
#define CSC_NOTIFY_EVERY  5   // invia CSC ogni N campioni (= 25 Hz @ 200 Hz)

// ─────────────────────────────────────────────────────────────────────────────
//  Include
// ─────────────────────────────────────────────────────────────────────────────

#include <bluefruit.h>
#include "signal_proc.h"
#include "ble_wheel.h"

#if USE_BUILTIN_IMU
  #include "LSM6DS3.h"          // Seeed_Arduino_LSM6DS3 library
  #include <Wire.h>
  LSM6DS3 builtinIMU(I2C_MODE, 0x6A);
#else
  #include "icm42688.h"
  ICM42688 extIMU(D7);          // CS sul pin D7
#endif

// ─────────────────────────────────────────────────────────────────────────────
//  Pin
// ─────────────────────────────────────────────────────────────────────────────

#define PIN_LED_BLE    D2
#define PIN_LED_CHG    D3
#define PIN_IMU_INT    D6   // solo per ICM-42688-P esterno

// ─────────────────────────────────────────────────────────────────────────────
//  Stato globale
// ─────────────────────────────────────────────────────────────────────────────

SignalState sig;

// Coast-down state machine
enum class RunState : uint8_t {
  IDLE,
  ACTIVE,     // run in corso — l'app accumula i dati via BB01
};

volatile RunState runState  = RunState::IDLE;
volatile uint8_t  runIndex  = 0;  // 0-5 (3 indoor o 3A+3B outdoor)

// Timer campionamento
uint32_t lastSampleUs = 0;
uint32_t lastStreamMs = 0;
uint16_t cscNotifyCnt = 0;

// Tire radius (aggiornata da wheelConfig)
float rTire = 2.105f / (2.0f * PI);  // 700c×25 default = ~0.335 m

// ─────────────────────────────────────────────────────────────────────────────
//  IMU helpers (unifica interfaccia LSM6DS3 e ICM-42688-P)
// ─────────────────────────────────────────────────────────────────────────────

bool imuInit() {
#if USE_BUILTIN_IMU
  if (builtinIMU.begin() != 0) return false;
  builtinIMU.settings.gyroRange       = 2000;
  builtinIMU.settings.accelRange      = 16;
  builtinIMU.settings.gyroSampleRate  = 208;  // Hz (LSM6DS3: 208 o 416)
  builtinIMU.settings.accelSampleRate = 208;
  return (builtinIMU.begin() == 0);
#else
  return extIMU.begin();
#endif
}

bool imuRead(ImuRaw& raw) {
#if USE_BUILTIN_IMU
  // LSM6DS3 → converti in stessa struttura ImuRaw
  raw.ax    = builtinIMU.readFloatAccelX() * 9.81f;
  raw.ay    = builtinIMU.readFloatAccelY() * 9.81f;
  raw.az    = builtinIMU.readFloatAccelZ() * 9.81f;
  raw.gx    = builtinIMU.readFloatGyroX()  * (PI / 180.0f);
  raw.gy    = builtinIMU.readFloatGyroY()  * (PI / 180.0f);
  raw.gz    = builtinIMU.readFloatGyroZ()  * (PI / 180.0f);
  raw.tempC = builtinIMU.readTempC();
  return true;
#else
  return extIMU.read(raw);
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
//  Setup
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
#if DEBUG_SERIAL
  Serial.begin(115200);
  // Aspetta connessione USB CDC per max 3s (non blocca se non c'è PC)
  for (int i = 0; i < 30 && !Serial; i++) delay(100);
  Serial.println("AeroDrag Wheel Sensor v1.0");
#endif

  // LED
  pinMode(PIN_LED_BLE, OUTPUT);
  pinMode(PIN_LED_CHG, INPUT);   // segnale aperto/collettore da MX1C506A
  digitalWrite(PIN_LED_BLE, LOW);

  // IMU
  if (!imuInit()) {
    // Lampeggia rapidamente → errore IMU
    while (true) {
      digitalWrite(PIN_LED_BLE, HIGH); delay(100);
      digitalWrite(PIN_LED_BLE, LOW);  delay(100);
    }
  }

  // BLE
  bleSetup("AeroDrag Wheel");

#if DEBUG_SERIAL
  Serial.println("BLE advertising avviato");
#endif

  lastSampleUs = micros();
  lastStreamMs = millis();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Loop
// ─────────────────────────────────────────────────────────────────────────────

void loop() {
  const uint32_t nowUs = micros();
  const float    dtS   = (nowUs - lastSampleUs) / 1e6f;

  // ── Campionamento IMU a SAMPLE_RATE_HZ ──────────────────────────────────
  if (dtS < (1.0f / SAMPLE_RATE_HZ)) return;
  lastSampleUs = nowUs;

  ImuRaw raw;
  if (!imuRead(raw)) return;

  // Aggiorna rTire da config BLE (può cambiare via BB04)
  rTire = wheelConfig.tireCircM / (2.0f * PI);

  // Elaborazione segnale
  signalUpdate(sig, raw, rTire, dtS);

  // ── Gestione comandi BLE (BB03) ─────────────────────────────────────────
  if (pendingCmd != 0x00) {
    uint8_t cmd = pendingCmd;
    pendingCmd  = 0x00;
    handleCommand(cmd);
  }

  // ── Notifica CSC (ogni CSC_NOTIFY_EVERY campioni) ───────────────────────
  // Inviata a tutti i centrali connessi che hanno abilitato le notifiche CSC
  if (anyConnected() && ++cscNotifyCnt >= CSC_NOTIFY_EVERY) {
    cscNotifyCnt = 0;
    if (sig.speedMs > MIN_SPEED_MS) {
      sendCSCMeasurement(sig.cumulRevs, sig.lastEvtTime);
    }
  }

  // ── Notifica AeroDrag stream BB01 (a STREAM_RATE_HZ) ────────────────────
  const uint32_t nowMs = millis();
  if (anyConnected() && (nowMs - lastStreamMs) >= (1000 / STREAM_RATE_HZ)) {
    lastStreamMs = nowMs;
    sendStream(sig.speedMs, sig.accelMs2, sig.tempC, sig.vibRMS);

#if DEBUG_SERIAL
    Serial.print("v="); Serial.print(sig.speedMs * 3.6f, 1);
    Serial.print(" km/h  a="); Serial.print(sig.accelMs2, 4);
    Serial.print(" m/s²  T="); Serial.print(sig.tempC, 1);
    Serial.print("°C  vib="); Serial.println(sig.vibRMS, 3);
#endif
  }

  // ── LED stato BLE ────────────────────────────────────────────────────────
  updateLed();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Gestione comandi coast-down
// ─────────────────────────────────────────────────────────────────────────────

void handleCommand(uint8_t cmd) {
  switch (cmd) {
    case WHEEL_CMD_START_INDOOR:
    case WHEEL_CMD_START_OUTDOOR_A:
    case WHEEL_CMD_START_OUTDOOR_B:
      if (runState == RunState::IDLE) {
        runState = RunState::ACTIVE;
        // L'app accumula i campioni BB01 a partire da questo momento.
        // Il firmware non calcola il Crr — lo fa l'app (ha CdA, densità aria, ecc.)
        // Il firmware invia un "inizio run" tramite un Crr result speciale
        // con crr=0, quality=0, runIdx = indice del run
        sendCrrResult(0.0f, 0, runIndex);
#if DEBUG_SERIAL
        Serial.print("Run "); Serial.print(runIndex); Serial.println(" avviato");
#endif
      }
      break;

    case WHEEL_CMD_CANCEL:
      runState = RunState::IDLE;
#if DEBUG_SERIAL
      Serial.println("Run annullato");
#endif
      break;

    default:
      break;
  }
}

// Auto-stop run: quando la velocità scende sotto 1 m/s per più di 2 secondi
// il firmware notifica il completamento e torna idle.
// L'app riceve l'ultima notifica BB01 con speed→0 e sa che il run è finito.
static uint32_t lowSpeedMs = 0;

void checkAutoStop() {
  if (runState != RunState::ACTIVE) return;

  if (sig.speedMs < 1.0f) {
    if (lowSpeedMs == 0) lowSpeedMs = millis();
    if (millis() - lowSpeedMs > 2000) {
      runState    = RunState::IDLE;
      lowSpeedMs  = 0;
      // Notifica fine run: crr=0, quality=255 = "run completato"
      sendCrrResult(0.0f, 255, runIndex);
      runIndex++;
#if DEBUG_SERIAL
      Serial.print("Run "); Serial.print(runIndex - 1); Serial.println(" completato (auto-stop)");
#endif
    }
  } else {
    lowSpeedMs = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LED status
// ─────────────────────────────────────────────────────────────────────────────

void updateLed() {
  static uint32_t lastLedMs  = 0;
  static bool     ledState   = false;
  const  uint32_t nowMs      = millis();

  uint16_t blinkMs;
  const uint8_t nConn = connectedCount();
  if (nConn == 0) {
    blinkMs = 1000;  // lento = advertising, nessun centrale
  } else if (runState == RunState::ACTIVE) {
    blinkMs = 150;   // veloce = run coast-down in corso
  } else if (nConn >= 2) {
    // Due lampeggi brevi ravvicinati = multi-connessione attiva
    static uint8_t phase = 0;
    static uint32_t t0 = 0;
    if (nowMs - t0 > (phase % 2 == 0 ? 150 : (phase == 1 ? 150 : 600))) {
      t0 = nowMs; phase = (phase + 1) % 4;
      digitalWrite(PIN_LED_BLE, (phase < 2) ? HIGH : LOW);
    }
    return;
  } else {
    // Acceso fisso = 1 centrale connesso, idle
    digitalWrite(PIN_LED_BLE, HIGH);
    return;
  }

  if (nowMs - lastLedMs >= blinkMs) {
    lastLedMs = nowMs;
    ledState  = !ledState;
    digitalWrite(PIN_LED_BLE, ledState ? HIGH : LOW);
  }
}
