/**
 * ble_wheel.h
 * Definizione servizi e caratteristiche BLE per AeroDrag Wheel Sensor.
 *
 * Design pairing NON esclusivo:
 *   - Nessun bonding richiesto (open BLE)
 *   - Il sensore accetta connessioni da qualsiasi centrale
 *   - Il profilo CSC standard (0x1816) è sempre accessibile a tutti
 *   - Il servizio AeroDrag (0xBB00) è accessibile senza autenticazione
 *   - Il dispositivo non filtra il MAC del master → compatibile con
 *     Wahoo, Garmin, Strava, AeroDrag app, più device simultanei
 *
 * Framework: Adafruit Bluefruit nRF52 Arduino BSP
 * (BLEService / BLECharacteristic API)
 */

#pragma once
#include <bluefruit.h>

// ── UUID servizi ─────────────────────────────────────────────────────────────

// CSC standard: UUID 16-bit
#define UUID_SVC_CSC         0x1816
#define UUID_CHR_CSC_MEAS    0x2A5B
#define UUID_CHR_CSC_FEATURE 0x2A5C
#define UUID_CHR_CSC_LOC     0x2A5D

// AeroDrag Wheel: UUID 128-bit (base UUID Bluetooth + 0xBB00)
// Nota: UUID a 128 bit perché 0xBBxx non è nel registro Bluetooth SIG
static const uint8_t UUID_SVC_WHEEL[] = {
  0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00, 0x00, 0x80,
  0x00, 0x10, 0x00, 0x00, 0x00, 0xBB, 0x00, 0x00
};
static const uint8_t UUID_CHR_STREAM[] = {
  0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00, 0x00, 0x80,
  0x00, 0x10, 0x00, 0x00, 0x01, 0xBB, 0x00, 0x00
};
static const uint8_t UUID_CHR_CRR_RES[] = {
  0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00, 0x00, 0x80,
  0x00, 0x10, 0x00, 0x00, 0x02, 0xBB, 0x00, 0x00
};
static const uint8_t UUID_CHR_CMD[] = {
  0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00, 0x00, 0x80,
  0x00, 0x10, 0x00, 0x00, 0x03, 0xBB, 0x00, 0x00
};
static const uint8_t UUID_CHR_CONFIG[] = {
  0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00, 0x00, 0x80,
  0x00, 0x10, 0x00, 0x00, 0x04, 0xBB, 0x00, 0x00
};
static const uint8_t UUID_CHR_INFO[] = {
  0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00, 0x00, 0x80,
  0x00, 0x10, 0x00, 0x00, 0x05, 0xBB, 0x00, 0x00
};

// ── Costanti protocollo ───────────────────────────────────────────────────────

#define WHEEL_CMD_START_INDOOR    0x01
#define WHEEL_CMD_START_OUTDOOR_A 0x02
#define WHEEL_CMD_START_OUTDOOR_B 0x03
#define WHEEL_CMD_CANCEL          0xFF

#define CSC_LOC_FRONT_WHEEL       5   // Bluetooth SIG: Sensor Location = Front Wheel

// ── Servizi e caratteristiche ─────────────────────────────────────────────────

BLEService    svcCSC(UUID_SVC_CSC);
BLECharacteristic chrCSCMeas(UUID_CHR_CSC_MEAS);
BLECharacteristic chrCSCFeat(UUID_CHR_CSC_FEATURE);
BLECharacteristic chrCSCLoc(UUID_CHR_CSC_LOC);

BLEService    svcWheel(UUID_SVC_WHEEL);
BLECharacteristic chrStream(UUID_CHR_STREAM);
BLECharacteristic chrCrrRes(UUID_CHR_CRR_RES);
BLECharacteristic chrCmd(UUID_CHR_CMD);
BLECharacteristic chrConfig(UUID_CHR_CONFIG);
BLECharacteristic chrInfo(UUID_CHR_INFO);

// ── Config sensore (condivisa con loop) ───────────────────────────────────────

struct WheelConfig {
  float tireCircM = 2.105f;  // 700c×25mm default
  float massKg    = 78.0f;   // massa atleta + bici default
};

volatile WheelConfig wheelConfig;
volatile uint8_t     pendingCmd = 0x00;

// ── Callback scrittura ────────────────────────────────────────────────────────

void cmdWriteCallback(uint16_t connHdl, BLECharacteristic* chr,
                      uint8_t* data, uint16_t len) {
  if (len > 0) pendingCmd = data[0];
}

void configWriteCallback(uint16_t connHdl, BLECharacteristic* chr,
                         uint8_t* data, uint16_t len) {
  if (len >= 8) {
    float circ, mass;
    memcpy(&circ, data,     4);
    memcpy(&mass, data + 4, 4);
    if (circ > 1.0f && circ < 3.0f) wheelConfig.tireCircM = circ;
    if (mass > 30.0f && mass < 250.0f) wheelConfig.massKg = mass;
  }
}

// ── Inizializzazione BLE ──────────────────────────────────────────────────────

void bleSetup(const char* deviceName) {
  Bluefruit.begin();
  Bluefruit.setTxPower(4);               // +4 dBm (~50 m range)
  Bluefruit.setName(deviceName);

  // Nessun bonding — pairing NON esclusivo
  // Il sensore accetta qualsiasi centrale senza autenticazione
  Bluefruit.Security.setEncryption(false);
  Bluefruit.Security.setBondable(false);

  // ── Servizio CSC (0x1816) ─────────────────────────────────────────────────
  svcCSC.begin();

  // CSC Measurement: NOTIFY, 7 byte (flags + cumRev + lastTime)
  chrCSCMeas.setProperties(CHR_PROPS_NOTIFY);
  chrCSCMeas.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  chrCSCMeas.setFixedLen(7);
  chrCSCMeas.begin();

  // CSC Feature: READ — bit0=wheel rev supported
  chrCSCFeat.setProperties(CHR_PROPS_READ);
  chrCSCFeat.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  chrCSCFeat.setFixedLen(2);
  chrCSCFeat.begin();
  uint16_t feat = 0x0001;  // wheel revolution supported
  chrCSCFeat.write16(feat);

  // Sensor Location: READ — front wheel (5)
  chrCSCLoc.setProperties(CHR_PROPS_READ);
  chrCSCLoc.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  chrCSCLoc.setFixedLen(1);
  chrCSCLoc.begin();
  chrCSCLoc.write8(CSC_LOC_FRONT_WHEEL);

  // ── Servizio AeroDrag Wheel (0xBB00) ─────────────────────────────────────
  svcWheel.begin();

  // BB01 Stream: NOTIFY 16 byte → speedMs, accelMs2, tempC, vibRMS
  chrStream.setProperties(CHR_PROPS_NOTIFY);
  chrStream.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  chrStream.setFixedLen(16);
  chrStream.begin();

  // BB02 Crr Result: NOTIFY 6 byte → crr(float32) + quality(uint8) + runIdx(uint8)
  chrCrrRes.setProperties(CHR_PROPS_NOTIFY);
  chrCrrRes.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  chrCrrRes.setFixedLen(6);
  chrCrrRes.begin();

  // BB03 Command: WRITE — uint8 command byte
  chrCmd.setProperties(CHR_PROPS_WRITE | CHR_PROPS_WRITE_WO_RESP);
  chrCmd.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  chrCmd.setFixedLen(1);
  chrCmd.setWriteCallback(cmdWriteCallback);
  chrCmd.begin();

  // BB04 Config: R/W — tireCircM(float32) + massKg(float32)
  chrConfig.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE);
  chrConfig.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  chrConfig.setFixedLen(8);
  chrConfig.setWriteCallback(configWriteCallback);
  chrConfig.begin();
  {
    uint8_t defCfg[8];
    float c = wheelConfig.tireCircM, m = wheelConfig.massKg;
    memcpy(defCfg,     &c, 4);
    memcpy(defCfg + 4, &m, 4);
    chrConfig.write(defCfg, 8);
  }

  // BB05 Device Info: READ — stringa ASCII
  chrInfo.setProperties(CHR_PROPS_READ);
  chrInfo.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  chrInfo.begin();
  chrInfo.write("AeroDragWheel/1.0");

  // ── Advertising ────────────────────────────────────────────────────────────
  // Annuncia sia CSC che il servizio proprietario nel pacchetto advertising.
  // Wahoo / Garmin trovano 0x1816 e si connettono → leggono velocità.
  // App AeroDrag trova 0xBB00 → accede alle funzionalità avanzate.
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(svcCSC);       // CSC nel pacchetto primario
  Bluefruit.Advertising.addName();
  Bluefruit.ScanResponse.addService(svcWheel);    // BB00 nel scan response
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(160, 400);    // 100–250 ms
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);                 // advertise per sempre
}

// ── Helper invio notifiche ────────────────────────────────────────────────────

void sendCSCMeasurement(uint32_t cumRevs, uint16_t lastEvtTime) {
  if (!chrCSCMeas.notifyEnabled(Bluefruit.connHandle())) return;
  uint8_t buf[7];
  buf[0] = 0x01;                    // flags: wheel rev present
  buf[1] = cumRevs & 0xFF;
  buf[2] = (cumRevs >> 8)  & 0xFF;
  buf[3] = (cumRevs >> 16) & 0xFF;
  buf[4] = (cumRevs >> 24) & 0xFF;
  buf[5] = lastEvtTime & 0xFF;
  buf[6] = (lastEvtTime >> 8) & 0xFF;
  chrCSCMeas.notify(buf, 7);
}

void sendStream(float speedMs, float accelMs2, float tempC, float vibRMS) {
  if (!chrStream.notifyEnabled(Bluefruit.connHandle())) return;
  uint8_t buf[16];
  memcpy(buf,      &speedMs,  4);
  memcpy(buf + 4,  &accelMs2, 4);
  memcpy(buf + 8,  &tempC,    4);
  memcpy(buf + 12, &vibRMS,   4);
  chrStream.notify(buf, 16);
}

void sendCrrResult(float crr, uint8_t quality, uint8_t runIdx) {
  uint8_t buf[6];
  memcpy(buf, &crr, 4);
  buf[4] = quality;
  buf[5] = runIdx;
  chrCrrRes.notify(buf, 6);
}
