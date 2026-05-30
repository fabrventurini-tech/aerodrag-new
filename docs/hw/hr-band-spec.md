# AeroDrag-HR — Fascia Cardiaca Smart HR+IMU Tronco
## Specifiche Hardware e Firmware v1.0

---

## 1. Funzione e Posizionamento

Fascia toracica elastica posizionata a livello T4 (sterno medio). Fonde due funzioni in un singolo device:

| Funzione | Standard | Compatibilità |
|---|---|---|
| HR + HRV | ECG single-lead | ANT+ HR profile + BLE Heart Rate Service standard |
| IMU tronco | 9 DoF | BLE AeroDrag proprietario |
| Temperatura cutanea | NTC | Compensazione termica Crr |
| Barometro | — | Quota e pendenza per coast-down outdoor |

**Tre livelli di utilizzo (dalla roadmap):**

| Livello | Utente | Feature attive |
|---|---|---|
| Consumer | Qualsiasi ciclista | HR + HRV su Garmin/Wahoo/Polar/Bryton via ANT+ — identico a HRM-Pro |
| Prosumer | App AeroDrag attiva | + angolo tronco, oscillazione laterale, correlazione HR→postura→fatica |
| Pro | Sessione con operatore | + IMU sincronizzato con gli altri 13 IMU del set Bio — CdA contributo tronco |

**Prezzo target: 150–200 EUR**

---

## 2. Bill of Materials

| Componente | Part Number | Specifica |
|---|---|---|
| MCU | Nordic nRF52840 | BLE 5.0 + ANT+ dual-protocol, 64 MHz Cortex-M4F |
| Frontend ECG | ADS1292R (TI) | 24 bit, 2 canali, SPI, SNR > 107 dB, CMRR > 100 dB |
| Elettrodi | Ag/AgCl snap-in | Rimovibili, sostituibili, gel conduttivo rimovibile |
| IMU | ICM-42688-P (TDK) | 6 DoF, ±8g / ±1000°/s, SPI |
| Magnetometro | MMC5983MA (MEMSIC) | 3D 18 bit, I²C (9 DoF completo) |
| Barometro | LPS22HH (ST) | ±0.1 hPa, I²C |
| Temperatura cutanea | NTC 10k (Murata) | ADC 12 bit su nRF, β = 3950 K |
| PMIC | nPM1100 (Nordic) | Integrato con charger LiPo |
| Batteria | LiPo 180 mAh | Flat 40×25×4 mm |
| Ricarica | WPC Qi + MagSafe-like pogo | Magnetica, nessun contatto fisico esposto |

**Autonomia target:** ≥ 20 ore (HR @ 500 Hz ECG, IMU @ 100 Hz, BLE + ANT+ attivi)

---

## 3. Meccanica e IPX7

### Form factor

```
Modulo elettronico: 58 × 38 × 9 mm
Fascia elastica:    S (60-90 cm), M (75-105 cm), L (90-120 cm)
Attacco:            Snap-in magnetico sul modulo (rilascio rapido)
Peso modulo:        ≤ 35 g
```

### Impermeabilità IPX7

Scelta strategica documentata in roadmap §7.3. Copre tutti gli scenari ciclismo:
- Sudore intenso (attività di 6+ ore)
- Pioggia battente
- Caduta in pozzanghera
- Lavaggio a mano con acqua corrente

**Punti critici di tenuta:**
1. **Connettore ricarica**: pogo-pin magnetico — nessun connettore USB esposto
2. **Elettrodi ECG**: snap-in con guarnizione O-ring in silicone medical-grade
3. **Guscio**: ABS + TPU over-mold, ultrasonico saldato
4. **Fascia**: poliuretano 85% + elastan 15%, impermeabile integrata

---

## 4. Schema Elettrico — Blocchi Funzionali

```
Elettrodi ECG (snap Ag/AgCl)
    └── ADS1292R (ECG frontend, 24 bit) ←── SPI → nRF52840
         └── R-wave detection → HR + RR intervals

NTC cutanea ───────────────────────────────→ ADC nRF52840

Batteria LiPo 180 mAh
    └── nPM1100 (PMIC + charger)
    └── Pogo pin magnetico (Qi) ← ricarica wireless
         └── LDO 3.3V
              └── nRF52840 (MCU)
                   ├── SPI  → ICM-42688-P (IMU 6 DoF)
                   ├── I²C  → MMC5983MA (Mag 3D)
                   ├── I²C  → LPS22HH (Barometro)
                   ├── BLE 5.0 ←→ antenna integrata
                   └── ANT+ ←→ antenna integrata (dual RF simultaneous)
```

---

## 5. Firmware — Pipeline ECG → HR/HRV

```
ECG raw @ 500 Hz (ADS1292R)
    │
    ▼
Band-pass filter: 5–40 Hz (rimuove DC, rumore muscolare, artefatti movimento)
    │
    ▼
Pan-Tompkins QRS detector → R-peak timestamp
    │
    ▼
RR interval = t_n - t_(n-1) [ms]
    │
    ├──▶ HR [bpm] = 60000 / RR_mean (media mobile 4 beat)
    └──▶ HRV RMSSD [ms] = sqrt(mean(ΔRR²))   → BLE ogni 1 s
```

**Nota:** L'algoritmo Pan-Tompkins implementato su nRF52840 con DSP Cortex-M4F FPU.
Consumo CPU: < 8% @ 64 MHz. Permette di mantenere IMU @ 100 Hz in parallelo.

---

## 6. Firmware — IMU Tronco

| Segnale | Frequenza | Algoritmo |
|---|---|---|
| Pitch tronco | 100 Hz | Madgwick AHRS (acc + gyro + mag) |
| Roll tronco | 100 Hz | Madgwick AHRS |
| Oscillazione laterale | 50 Hz | Bandpass 0.5–2 Hz su acc Y → RMS su finestra 2 s |
| Frequenza respiratoria | 1 Hz | Bandpass 0.15–0.5 Hz su acc Z → FFT peak → [breath/min] |
| Temperatura cutanea | 1 Hz | NTC Steinhart-Hart equation |
| Altitudine/pendenza | 1 Hz | Barometro + complementary filter con IMU |

**Calibrazione zero IMU:** il device applica la calibrazione della postura di guida base
impostata dall'operatore nella sessione pro. In standalone, pitch = 0° = orizzontale.

---

## 7. BLE GATT — Tabella Completa

### Service AeroDrag-HR (proprietario): `0000cc00-0000-1000-8000-00805f9b34fb`

| Caratteristica | UUID | Proprietà | Payload | Descrizione |
|---|---|---|---|---|
| CHR_HR_HR | `0000cc01-...` | NOTIFY | 17 B | bpm [uint8] + rrMs[8] [uint16 LE ×8] @ 1 Hz |
| CHR_HR_IMU | `0000cc02-...` | NOTIFY | 16 B | pitchDeg, rollDeg, lateralOscMm, respBreathMin [float32 ×4] @ 10 Hz |
| CHR_HR_ENV | `0000cc03-...` | NOTIFY | 12 B | skinTempC, pressurePa, altM [float32 ×3] @ 1 Hz |
| CHR_HR_BATT | `0000cc04-...` | READ | 1 B | batteria % [uint8] |
| CHR_HR_CFG | `0000cc05-...` | READ+WRITE | 50 B | name[32 B UTF-8] + deviceId[18 B ASCII] |

### Service Heart Rate standard: `0x180D` (GATT org.bluetooth.service.heart_rate)

| Caratteristica | UUID | Proprietà | Payload |
|---|---|---|---|
| HR Measurement | `0x2A37` | NOTIFY | flags[1] + bpm[1] + rrIntervals[n×2] |
| Body Sensor Location | `0x2A38` | READ | `0x01` (Chest) |

**Formato HR Measurement (0x2A37):**
```
Byte 0: flags = 0x10 (bit4=RR present, bit0=0 → 8-bit HR, bits2-3=01 → contact detected)
Byte 1: HR [bpm, uint8]
Bytes 2..n: RR intervals in 1/1024 s units [uint16 LE each]
  RR [1/1024 s] = RR_ms × 1.024
  Esempio: 800 ms → 819 (0x0333)
```

### Service Battery standard: `0x180F`

| Caratteristica | UUID | Valore |
|---|---|---|
| Battery Level | `0x2A19` | batteria % [uint8] |

### Service Device Information: `0x180A`

| Caratteristica | UUID | Valore |
|---|---|---|
| Manufacturer | `0x2A29` | `AeroDrag Srl` |
| Model Number | `0x2A24` | `AeroDrag-HR-v1` |
| Firmware Rev | `0x2A26` | es. `1.0.2` |

---

## 8. ANT+ — Tabella Canali

| Profilo | Device Type | Period | Dati | Note |
|---|---|---|---|---|
| HR (Heart Rate) | 0x78 | 4 Hz | HR [bpm] + RR intervals | Compatibile con qualsiasi testa GPS |

**Trasmissione simultanea BLE + ANT+:** nRF52840 supporta RF dual concurrent. Il device
può essere connesso all'app AeroDrag via BLE e contemporaneamente al ciclocomputer via ANT+.

---

## 9. Formato Payload Dettagliato

### CHR_HR_HR (17 byte, little-endian)

```
Offset  Tipo    Campo   Unità   Note
0       uint8   hrBpm   bpm     frequenza cardiaca
1       uint16  rr0     ms      intervallo RR #0 (0 = non valido)
3       uint16  rr1     ms      intervallo RR #1
...
15      uint16  rr7     ms      intervallo RR #7
```

### CHR_HR_IMU (16 byte, little-endian)

```
Offset  Tipo     Campo          Unità   Note
0       float32  pitchDeg       °       pitch tronco (positivo = avanti)
4       float32  rollDeg        °       roll tronco (positivo = destra)
8       float32  lateralOscMm   mm      oscillazione laterale RMS su 2 s
12      float32  respBreathMin  b/min   frequenza respiratoria
```

### CHR_HR_ENV (12 byte, little-endian)

```
Offset  Tipo     Campo       Unità
0       float32  skinTempC   °C     temperatura cutanea
4       float32  pressurePa  Pa     pressione barometrica
8       float32  altM        m      altitudine
```

---

## 10. Interoperabilità con Device di Terze Parti

L'app AeroDrag accetta **qualsiasi monitor cardiaco BLE** che implementi il Heart Rate Service
standard (0x180D). Dispositivi testati e compatibili:

| Device | Tipo | HR | HRV (RR) | IMU tronco |
|---|---|---|---|---|
| Garmin HRM-Pro | Standard BLE + ANT+ | ✓ | ✓ | ✗ |
| Garmin HRM-Dual | Standard BLE + ANT+ | ✓ | ✓ | ✗ |
| Wahoo TICKR X | Standard BLE + ANT+ | ✓ | ✓ | ✗ |
| Polar H10 | Standard BLE + ANT+ | ✓ | ✓ | ✗ |
| Polar H9 | Standard BLE + ANT+ | ✓ | ✗ | ✗ |
| Bryton Smart HRM | Standard BLE + ANT+ | ✓ | ✓ | ✗ |
| **AeroDrag-HR** | BLE proprietario + ANT+ | ✓ | ✓ | **✓** |

I device di terze parti utilizzano il CHR standard 0x2A37 con parsing automatico
del flag field per gestire HR a 8 o 16 bit e presenza/assenza degli RR intervals.

---

## 11. Procedura di Pairing

### Pairing con app AeroDrag:
1. Attivare la fascia (LED lampeggia rosso)
2. Aprire Settings → "Cerca fascia HR"
3. Selezionare il device dall'elenco
   - Device AeroDrag-HR: badge "AeroDrag" (data IMU tronco disponibile)
   - Device terze parti: badge "Standard BLE" (solo HR + HRV)
4. App salva MAC e tipo → connessione automatica a ogni avvio

### Pairing con ciclocomputer (ANT+):
- Procedura standard ANT+ (device type 0x78)
- Nessuna configurazione in-app necessaria
- Funziona in parallelo alla connessione BLE

---

## 12. Calibrazione Fabbrica

| Parametro | Procedura | Tolleranza |
|---|---|---|
| Gain ECG | Segnale sintetico calibrato | ±0.1% |
| Offset DC ECG | Auto-calibrazione all'accensione | < 1 mV |
| Offset IMU (acc) | 6-position test | ±2 mg |
| Offset IMU (gyro) | Statico 30 s @ 25°C | ±0.5 °/s |
| Curva NTC | Steinhart-Hart su 3 punti (0°C, 25°C, 60°C) | ±0.3°C |
| Barometro offset | Confronto con riferimento certificato | ±0.5 hPa |

---

## 13. Certificazioni Target

- **CE/RED** (Radio Equipment Directive) — obbligatoria per BLE
- **FCC Part 15** (USA)
- **ANT+ Certified** (Device type 0x78 — HR)
- **RoHS 3** (SVHC compliance)
- **IPX7** (IEC 60529) — immersione 1 m / 30 min
- **Biocompatibilità** (ISO 10993) — materiali a contatto con cute
- **EMC** (IEC 61000 per prodotti wearable)
