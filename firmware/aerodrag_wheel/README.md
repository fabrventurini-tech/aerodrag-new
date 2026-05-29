# AeroDrag Wheel Sensor — Guida Firmware

## Prerequisiti IDE Arduino

1. Apri **Arduino IDE ≥ 2.3** (o VS Code + Arduino extension)
2. In _Preferenze → URL aggiuntivi_:
   ```
   https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
   ```
3. _Board Manager_ → installa **Seeed nRF52 Boards** ≥ 2.9.2
4. _Library Manager_ → installa **Seeed_Arduino_LSM6DS3** (per V1 con IMU integrata)
5. Seleziona scheda: **Seeed XIAO nRF52840 Sense**

## Prima programmazione (via USB-C)

1. Collega XIAO al PC con USB-C
2. **Doppio click** sul tasto RESET → il LED diventa verde fisso (modalità UF2)
3. Appare un drive USB chiamato `XIAO-SENSE`
4. Arduino IDE → _Sketch → Carica_ oppure trascina il file `.uf2` generato
5. Il dispositivo si riavvia automaticamente

## DFU Over-The-Air (aggiornamento senza cavo)

Il BSP Adafruit/Seeed include un servizio DFU BLE (Nordic DFU).  
Usa l'app **nRF Connect** (iOS/Android):
1. Connettiti a "AeroDrag Wheel"
2. Tab _DFU_ → seleziona il file `.zip` (generato da Arduino IDE)
3. Il firmware si aggiorna e il dispositivo si riavvia

## Configurazione build

Nel file `aerodrag_wheel.ino`:

```cpp
#define USE_BUILTIN_IMU   1   // 1 = LSM6DS3 integrato (V1)
                              // 0 = ICM-42688-P esterno (V2)
#define DEBUG_SERIAL      0   // 1 = output CSV su USB CDC
```

## Calibrazione asse di rotazione

Il firmware rileva automaticamente quale asse del giroscopio corrisponde
all'asse di rotazione della ruota durante il primo spin-up (≥ 1 m/s).

Se il sensore viene rimontato in orientamento diverso, l'auto-rilevamento
si riesegue al prossimo avvio. Non è necessaria calibrazione manuale.

## Protocollo BLE

### Compatibilità universale — CSC 0x1816

Qualsiasi app (Wahoo, Garmin Connect, Strava) trova il sensore come
un normale sensore velocità. Legge:
- `0x2A5B` CSC Measurement: rivoluzioni cumulative + timestamp

### Funzionalità AeroDrag — servizio 0xBB00

| Chr | UUID (ultimi 2 byte) | R/W/N | Formato | Descrizione |
|-----|---------------------|-------|---------|-------------|
| BB01 | `...BB01` | NOTIFY 10 Hz | `float32×4` | speedMs, accelMs2, tempC, vibRMS |
| BB02 | `...BB02` | NOTIFY on event | `float32 + uint8×2` | crr, quality, runIdx |
| BB03 | `...BB03` | WRITE | `uint8` | comando (01=indoor, 02=outA, 03=outB, FF=cancel) |
| BB04 | `...BB04` | R/W | `float32×2` | tireCircM, massKg |
| BB05 | `...BB05` | READ | ASCII | "AeroDragWheel/1.0" |

### Semantica BB02 (run lifecycle)

| crr | quality | runIdx | Significato |
|-----|---------|--------|-------------|
| 0.0 | 0 | N | Run N avviato (resposta al comando START) |
| 0.0 | 255 | N | Run N completato (auto-stop, speed < 1 m/s × 2s) |

Il calcolo del Crr viene fatto dall'app (ha CdA, densità aria, pendenza).
Il firmware è un trasduttore puro: campiona, filtra, trasmette.

## Consumo e autonomia

| Scenario | Corrente | Autonomia LiPo 100 mAh |
|----------|----------|------------------------|
| BLE connected + stream 10 Hz | ~7 mA | ~14 ore |
| BLE advertising (no connessione) | ~1.5 mA | ~66 ore |
| Auto-sleep (no attività 30 min) | ~15 µA | mesi |
