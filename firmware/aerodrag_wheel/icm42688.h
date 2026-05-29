/**
 * icm42688.h
 * Driver minimale per ICM-42688-P via SPI.
 * Alternativa: usa LSM6DS3TR-C integrato nel XIAO Sense con la libreria
 * "Seeed_Arduino_LSM6DS3" — stessa interfaccia pubblica.
 *
 * Datasheet ref: DS-000347-ICM-42688-P-v1.7
 */

#pragma once
#include <Arduino.h>
#include <SPI.h>

// ── Registri principali ───────────────────────────────────────────────────────

#define ICM_WHO_AM_I       0x75   // Expected: 0x47
#define ICM_PWR_MGMT0      0x4E
#define ICM_GYRO_CONFIG0   0x4F
#define ICM_ACCEL_CONFIG0  0x50
#define ICM_GYRO_CONFIG1   0x51
#define ICM_ACCEL_CONFIG1  0x53
#define ICM_INT_CONFIG     0x14
#define ICM_INT_CONFIG0    0x63
#define ICM_INT_SOURCE0    0x65
#define ICM_TEMP_DATA1     0x1D
#define ICM_ACCEL_DATA_X1  0x1F
#define ICM_GYRO_DATA_X1   0x25
#define ICM_INTF_CONFIG1   0x4D

// ── ODR (Output Data Rate) ────────────────────────────────────────────────────

#define ICM_ODR_8000HZ     0x03
#define ICM_ODR_4000HZ     0x04
#define ICM_ODR_2000HZ     0x05
#define ICM_ODR_1000HZ     0x06
#define ICM_ODR_200HZ      0x07
#define ICM_ODR_100HZ      0x08
#define ICM_ODR_50HZ       0x09

// ── Ranges ────────────────────────────────────────────────────────────────────

// Gyro full-scale: 0=2000dps, 1=1000dps, 2=500dps, 3=250dps, 4=125dps
#define ICM_GYRO_FS_2000   (0x00 << 5)
#define ICM_GYRO_FS_500    (0x02 << 5)

// Accel full-scale: 0=16g, 1=8g, 2=4g, 3=2g
#define ICM_ACCEL_FS_16G   (0x00 << 5)
#define ICM_ACCEL_FS_4G    (0x02 << 5)

// ── Sensibilità ───────────────────────────────────────────────────────────────

#define ICM_GYRO_SENS_2000  16.4f    // LSB/(°/s)
#define ICM_GYRO_SENS_500   65.5f
#define ICM_ACCEL_SENS_16G  2048.0f  // LSB/g
#define ICM_ACCEL_SENS_4G   8192.0f

// ── Dati grezzi ───────────────────────────────────────────────────────────────

struct ImuRaw {
  float ax, ay, az;  // accelerazione [m/s²]
  float gx, gy, gz;  // velocità angolare [rad/s]
  float tempC;        // temperatura [°C]
};

// ── Classe driver ─────────────────────────────────────────────────────────────

class ICM42688 {
public:
  ICM42688(uint8_t csPin, SPIClass& spi = SPI)
    : _cs(csPin), _spi(spi) {}

  bool begin(uint32_t spiFreq = 4000000) {
    _spiFreq = spiFreq;
    pinMode(_cs, OUTPUT);
    digitalWrite(_cs, HIGH);
    _spi.begin();
    delay(10);

    if (readReg(ICM_WHO_AM_I) != 0x47) return false;

    // Reset completo
    writeReg(ICM_PWR_MGMT0, 0x00);
    delay(5);

    // Abilita accel + gyro in modalità low-noise
    writeReg(ICM_PWR_MGMT0, 0x0F);
    delay(1);

    // Gyro: 2000 dps, 200 Hz
    writeReg(ICM_GYRO_CONFIG0, ICM_GYRO_FS_2000 | ICM_ODR_200HZ);
    // Accel: 16g, 200 Hz
    writeReg(ICM_ACCEL_CONFIG0, ICM_ACCEL_FS_16G | ICM_ODR_200HZ);
    delay(1);

    // INT1: data ready, active high, push-pull
    writeReg(ICM_INT_CONFIG,  0x18);
    writeReg(ICM_INT_SOURCE0, 0x08);  // data ready → INT1

    delay(50);  // attende primo sample valido
    return true;
  }

  // Legge tutti e 7 i sensori in un burst SPI (14 byte + 2 byte temp = 16 B)
  bool read(ImuRaw& out) {
    uint8_t buf[14];
    readBurst(ICM_TEMP_DATA1, buf, 14);

    int16_t rawTemp = (int16_t)((buf[0] << 8) | buf[1]);
    int16_t rawAx   = (int16_t)((buf[2] << 8) | buf[3]);
    int16_t rawAy   = (int16_t)((buf[4] << 8) | buf[5]);
    int16_t rawAz   = (int16_t)((buf[6] << 8) | buf[7]);
    int16_t rawGx   = (int16_t)((buf[8] << 8) | buf[9]);
    int16_t rawGy   = (int16_t)((buf[10] << 8) | buf[11]);
    int16_t rawGz   = (int16_t)((buf[12] << 8) | buf[13]);

    // Temperatura: Temp_degC = (rawTemp / 132.48) + 25.0
    out.tempC = (rawTemp / 132.48f) + 25.0f;

    // Accelerazione → m/s²  (1g = 9.81 m/s²)
    out.ax = (rawAx / ICM_ACCEL_SENS_16G) * 9.81f;
    out.ay = (rawAy / ICM_ACCEL_SENS_16G) * 9.81f;
    out.az = (rawAz / ICM_ACCEL_SENS_16G) * 9.81f;

    // Velocità angolare → rad/s
    out.gx = (rawGx / ICM_GYRO_SENS_2000) * (PI / 180.0f);
    out.gy = (rawGy / ICM_GYRO_SENS_2000) * (PI / 180.0f);
    out.gz = (rawGz / ICM_GYRO_SENS_2000) * (PI / 180.0f);

    return true;
  }

private:
  uint8_t   _cs;
  SPIClass& _spi;
  uint32_t  _spiFreq;

  uint8_t readReg(uint8_t reg) {
    uint8_t val;
    _spi.beginTransaction(SPISettings(_spiFreq, MSBFIRST, SPI_MODE0));
    digitalWrite(_cs, LOW);
    _spi.transfer(reg | 0x80);  // bit 7 = 1 → read
    val = _spi.transfer(0x00);
    digitalWrite(_cs, HIGH);
    _spi.endTransaction();
    return val;
  }

  void writeReg(uint8_t reg, uint8_t val) {
    _spi.beginTransaction(SPISettings(_spiFreq, MSBFIRST, SPI_MODE0));
    digitalWrite(_cs, LOW);
    _spi.transfer(reg & 0x7F);  // bit 7 = 0 → write
    _spi.transfer(val);
    digitalWrite(_cs, HIGH);
    _spi.endTransaction();
  }

  void readBurst(uint8_t startReg, uint8_t* buf, uint8_t len) {
    _spi.beginTransaction(SPISettings(_spiFreq, MSBFIRST, SPI_MODE0));
    digitalWrite(_cs, LOW);
    _spi.transfer(startReg | 0x80);
    for (uint8_t i = 0; i < len; i++) buf[i] = _spi.transfer(0x00);
    digitalWrite(_cs, HIGH);
    _spi.endTransaction();
  }
};
