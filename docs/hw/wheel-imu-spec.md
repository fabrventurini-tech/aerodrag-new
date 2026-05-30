# AeroDrag-Wheel — Sensore IMU Mozzo Anteriore
## Specifiche Hardware e Firmware v1.0

---

## 1. Funzione e Posizionamento

Sensore montato sul mozzo anteriore della bici. Misura la decelerazione lineare durante il freewheeling (coast-down) per calcolare il coefficiente di resistenza al rotolamento (Crr) della combinazione copertone+pressione+superficie. Funziona sia indoor (rullo) sia outdoor (strada/velodromo).

**Valore aggiunto rispetto al drum roller:**
- Misura il Crr sulla superficie **reale di gara**
- Nessun hardware aggiuntivo in studio (funziona su qualsiasi rullo ANT+ FE-C)
- Dual use: Crr + velocità ruota + rilevazione qualità superficie

---

## 2. Bill of Materials

| Componente | Part Number | Specifica |
|---|---|---|
| MCU | Nordic nRF52840 | BLE 5.0 + ANT+ dual-protocol, 64 MHz, 1 MB Flash |
| IMU | ICM-42688-P (TDK) | 6 DoF, ±16g / ±2000°/s, 32 kHz ODR, SPI |
| Magnetometro | MMC5983MA (MEMSIC) | 3D, 18 bit, I²C (per IMU 9 DoF completo) |
| Temperatura | STTS22H (ST) | ±0.5°C, I²C — compensazione termica Crr |
| PMIC | nPM1100 (Nordic) | Boost+LDO, solar-ready |
| Batteria | LiPo 150 mAh | CR2032 form factor, oppure flat pack |
| Ricarica | BQ25120 | Wireless Qi o USB-C pogo pin |
| Regolatore | LDO 3.3V 200 mA | per IMU e sensori |

**Autonomia target:** ≥ 200 ore (IMU @ 200 Hz, BLE notify @ 50 Hz, standby < 5 µA)

---

## 3. Mounting

- Forma: cilindro Ø 30 mm × 12 mm con flangia di montaggio
- Attacco: prolunga valvola con fascette in PA66-GF30 oppure adesivo 3M VHB
- Bilanciamento: massa ≤ 18 g — sotto soglia rilevazione ruota (< 20 g @ 60 km/h)
- IP: **IPX7** (stesse condizioni della fascia HR)
- Connettore ricarica: magnetico pogo-pin 4 contatti (non esposto all'acqua)

---

## 4. Schema Elettrico — Blocchi Funzionali

```
Batteria LiPo 150 mAh
    └── BQ25120 (ricarica) ←── Pogo pin magnetico (4 contatti)
    └── nPM1100 (PMIC)
         └── LDO 3.3V
              ├── nRF52840 (MCU)
              │    ├── SPI  → ICM-42688-P (IMU 6 DoF)
              │    ├── I²C  → MMC5983MA (Mag)
              │    ├── I²C  → STTS22H (Temp)
              │    └── ANT+ RF ←→ 2.4 GHz antenna integrata
              └── RF ←→ BLE antenna integrata
```

---

## 5. Firmware — Specifiche di Campionamento

| Segnale | Frequenza acquisizione | Frequenza notifica BLE |
|---|---|---|
| Accelerometro (3 assi) | 200 Hz | 50 Hz (media su 4 campioni) |
| Giroscopio (3 assi) | 200 Hz | 50 Hz |
| Magnetometro (3 assi) | 50 Hz | 50 Hz (aggregato) |
| Temperatura | 1 Hz | 1 Hz (in CHR_WHEEL_STATE) |
| Velocità (da gyro Z) | 200 Hz | 10 Hz (media su 20 campioni) |
| Vibration index | 200 Hz (RMS acc) | 10 Hz |
| Batteria % | 1/min | 1/10 min (READ only) |

**Algoritmo velocità:**
```
v [m/s] = ω_z [rad/s] × r_ruota [m]
ω_z = gyro_z [°/s] × π/180
r_ruota = circumferenza [mm] / (2π × 1000)   ← configurato via CHR_WHEEL_CFG
```

**Algoritmo vibration index:**
```
acc_magnitude = sqrt(ax² + ay² + az²) − 1g  (rimuove gravità)
vibration_rms = sqrt(mean(acc_magnitude²))   su finestra 20 ms
vibIdx = clamp(vibration_rms × 500, 0, 65535) → uint16
```

---

## 6. BLE GATT — Tabella Completa

### Service principale: `0000bb00-0000-1000-8000-00805f9b34fb`

| Caratteristica | UUID | Proprietà | Payload | Descrizione |
|---|---|---|---|---|
| CHR_WHEEL_IMU | `0000bb01-...` | NOTIFY | 24 B | ax, ay, az [g float32], gx, gy, gz [°/s float32] @ 50 Hz |
| CHR_WHEEL_STATE | `0000bb02-...` | NOTIFY | 14 B | speedMs [float32], decelMs2 [float32], tempC [float32], vibIdx [uint16] @ 10 Hz |
| CHR_WHEEL_BATT | `0000bb03-...` | READ | 1 B | batteria % [uint8] |
| CHR_WHEEL_CFG | `0000bb04-...` | READ+WRITE | 20 B | circumMm [uint16 LE] + deviceId [18 B ASCII] |

### Service Device Information: `0x180A` (standard)

| Caratteristica | UUID | Valore |
|---|---|---|
| Manufacturer | `0x2A29` | `AeroDrag Srl` |
| Model Number | `0x2A24` | `AeroDrag-Wheel-v1` |
| Firmware Rev | `0x2A26` | es. `1.0.3` |

### ANT+ (dual-protocol)

| Profilo | Device Type | Channel | Dati |
|---|---|---|---|
| CSC (Cycling Speed and Cadence) | 0x79 | 4 Hz | Wheel revolution count + event time |

Il profilo ANT+ CSC consente a qualsiasi testa GPS (Garmin, Wahoo, Bryton) di ricevere la velocità ruota senza app AeroDrag.

---

## 7. Formato Payload Dettagliato

### CHR_WHEEL_IMU (24 byte, little-endian)

```
Offset  Tipo      Campo    Unità
0       float32   ax       g  (1g = 9.81 m/s²)
4       float32   ay       g
8       float32   az       g
12      float32   gx       °/s
16      float32   gy       °/s
20      float32   gz       °/s   ← usato per velocità ruota
```

### CHR_WHEEL_STATE (14 byte, little-endian)

```
Offset  Tipo      Campo           Unità
0       float32   speedMs         m/s
4       float32   decelMs2        m/s²  (positivo = decelera)
8       float32   tempC           °C
12      uint16    vibrationIndex  0–65535 (0=fermo, >200=dissestato)
```

### CHR_WHEEL_CFG (20 byte)

```
Offset  Tipo    Campo         Note
0       uint16  circumMm      circonferenza ruota in mm (default 2100)
2       char×18 deviceId      ID univoco ASCII (es. "ADWHL-001")
```

---

## 8. Protocollo Crr — Procedura

### Indoor (rullo)

1. App invia START → atleta pedala fino a 30 km/h (≥ 8 m/s)
2. App segnala SPIN-UP OK → atleta smette di pedalare
3. `decelMs2 > 0` e `powerW == 0` → app avvia raccolta campioni
4. Raccolta per ≥ 30 s o fino a velocità < 2 m/s
5. App calcola Crr run → 3 run → media finale
6. Crr aggiornato automaticamente nel calcolo CdA

### Outdoor (bidirezionale)

1. Tratto ≥ 300 m, pendenza < 0.5% (validata da barometro fascia HR)
2. Run A: direzione N, 3 volte → Crr_A
3. Run B: direzione S, 3 volte → Crr_B
4. Crr_finale = (Crr_A + Crr_B) / 2 (cancella componente vento)

---

## 9. Calibrazione Fabrica

| Parametro | Procedura | Tolleranza |
|---|---|---|
| Offset accelerometro | 6-position test su fixture | ±2 mg |
| Offset giroscopio | Statico 30 s a 25°C | ±0.5 °/s |
| Compensazione termica | Ciclo −10°C → 60°C | ±1% full scale |
| circonferenza default | 2100 mm (700×25C) | Configurabile via app |

---

## 10. Certificazioni Target

- **CE/RED** (Radio Equipment Directive)
- **FCC Part 15** (USA)
- **RoHS 3** (SVHC compliance)
- **IPX7** (IEC 60529)
- **ANT+ Certified** (Device type 0x79 — CSC)
