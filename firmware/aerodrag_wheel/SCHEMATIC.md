# AeroDrag Wheel Sensor — Schema di Assemblaggio v1.0

## Scelta del modulo nRF52840

**Seeed XIAO nRF52840 Sense** — modulo raccomandato perché:
- nRF52840 con USB-C nativo (USB 2.0 full-speed)
- Carica LiPo integrata (MX1C506A, max 50 mA)
- IMU LSM6DS3TR-C integrata (6-DoF, 416 Hz max) — usabile per V1
- Antenna BLE stampata su PCB
- Dimensioni: 21 × 17.5 mm — entra nel mozzo
- Programmazione via USB-C (UF2 bootloader, DFU over BLE)

Per V1 si usa l'IMU integrata. La slot SPI esterna è predisposta per l'ICM-42688-P
quando servirà maggiore accuratezza.

---

## Bill of Materials (BOM)

| # | Componente | Package | Nota |
|---|-----------|---------|------|
| U1 | Seeed XIAO nRF52840 Sense | SMD 21×17.5 mm | MCU + IMU + BLE + USB |
| U2 | ICM-42688-P (opzionale V2) | LGA-14 3×3 mm | IMU esterno SPI, 200 Hz |
| U3 | LIS3MDL (opzionale V1+) | LGA-12 2×2 mm | Magnetometro I2C (9-DoF) |
| BAT1 | LiPo 100 mAh 3.7V | 20×12×4 mm | JST-PH 2.0 mm (connettore Seeed) |
| LED1 | LED verde 0402 | SMD | Stato BLE |
| LED2 | LED rosso 0402 | SMD | Stato carica |
| R1 | 100 Ω 0402 | SMD | Limita LED1 |
| R2 | 100 Ω 0402 | SMD | Limita LED2 |
| R3, R4 | 4.7 kΩ 0402 | SMD | Pull-up I2C (SDA, SCL) |
| C1, C2 | 100 nF 0402 | SMD | Decoupling VCC U2 |
| C3, C4 | 100 nF 0402 | SMD | Decoupling VCC U3 |
| J1 | USB-C female | 16-pin SMD | Passthrough verso XIAO |
| SW1 | Pulsante SMD 3×4 mm | SMD | Reset / DFU (doppio click) |
| PCB | FR4 18 × 22 mm | 2 strati | Cilindrico, mozzo anteriore |

---

## Schema connessioni

```
                    ┌─────────────────────────────────────────┐
                    │         SEEED XIAO nRF52840 Sense        │
                    │                                          │
     USB-C ◄────────┤ USB-C (D+/D−)     BLE ───────────── ANT │
     LiPo  ◄────────┤ BAT+/BAT−                               │
                    │                                          │
      ┌─────────────┤ D8  (SCK  P1.13)                        │
      │  ┌──────────┤ D9  (MISO P1.14)                        │
      │  │  ┌───────┤ D10 (MOSI P1.15)                        │
      │  │  │  ┌────┤ D7  (CS   P1.12)   [IMU SPI CS]        │
      │  │  │  │ ┌──┤ D6  (INT1 P1.11)   [IMU dready 200Hz]  │
      │  │  │  │ │  │                                          │
      │  │  │  │ │  ├─ D4  (SDA P0.26) ──┬── R3 4.7k ── 3V3  │
      │  │  │  │ │  ├─ D5  (SCL P0.27) ──┼── R4 4.7k ── 3V3  │
      │  │  │  │ │  │                    │                     │
      │  │  │  │ │  ├─ D2  (LED P0.28) ──R1── LED1 ── GND     │
      │  │  │  │ │  ├─ D3  (CHG P0.29) ──R2── LED2 ── GND     │
      │  │  │  │ │  │                    │                     │
      │  │  │  │ │  │                  U3 LIS3MDL (opz.)       │
      │  │  │  │ │  │                  ├── SDA                 │
      │  │  │  │ │  │                  └── SCL                 │
      │  │  │  │ │  └──────────────────────────────────────────┘
      │  │  │  │ │
      │  │  │  │ │    ┌──────────────────────────────┐
      │  │  │  │ └───►│ INT1                ICM-42688-P │ (opz. V2)
      │  │  │  └─────►│ CS (active low)               │
      └──┤  │        │ SCK                            │
         └──┤        │ MISO                           │
            └───────►│ MOSI                           │
                     │ VDD ──── 3V3                   │
                     │ GND ──── GND                   │
                     │ C1/C2 100nF su VDD             │
                     └──────────────────────────────────┘

NOTA: per V1 usare l'IMU LSM6DS3TR-C integrata nel XIAO Sense
      (già connessa internamente, nessun cablaggio esterno necessario)
      L'ICM-42688-P esterno viene aggiunto in V2 per migliore accuratezza.
```

---

## USB-C — Funzionalità

Il nRF52840 espone USB 2.0 full-speed (12 Mbit/s) nativo:

| Modalità | Come | Quando |
|----------|------|--------|
| **Ricarica LiPo** | VBUS → MX1C506A (integrato) | Sempre quando cavo collegato |
| **DFU Bootloader** | Doppio click SW1 → appare come drive USB | Per caricare firmware .UF2 |
| **DFU Over-The-Air** | BLE DFU service (Bluefruit) | Senza cavo |
| **Debug serial** | USB CDC virtual COM port | Solo in debug build |
| **Dati raw** | USB CDC: stream CSV campioni IMU | Per diagnostica/calibrazione PC |

---

## Montaggio sul mozzo anteriore

```
            Vista laterale ruota

        ┌─────────────────────┐
        │     Forcella        │
        │   └──────────┘      │
        │        │            │
        │    [  ASSALE  ]     │
        │        │            │
        │   ┌────┴────┐       │
        │   │  MOZZO  │       │
        │   └─────────┘       │
        │        │            │
        │   ╔════╧════╗       │  ← Capsula sensore (Ø 28mm × 20mm)
        │   ║ SENSORE ║       │     fissata all'assale con fascetta
        │   ╚═════════╝       │     o staffa in alluminio stampata
        │        │            │
        └────────┘────────────┘

    La capsula è in nylon PA12 (SLS 3D print), IP67:
    - Ø esterno: 28 mm
    - Altezza:   20 mm
    - O-ring BS-009 sulla chiusura
    - Porta USB-C waterproof (IP67) sulla flangia
    - Antiscorrimento: 2 × M2 grani sull'assale
```

---

## Consumo energetico

| Stato | Corrente | Autonomia (100 mAh) |
|-------|----------|---------------------|
| BLE connected + IMU 200Hz + stream | ~9 mA | ~11 ore |
| BLE connected + IMU 50Hz (idle) | ~5 mA | ~20 ore |
| BLE advertising (scan interval) | ~1.5 mA | ~66 ore |
| Deep sleep (solo RTC) | ~12 µA | mesi |
| Ricarica USB-C (50 mA) | — | ~2 ore (full) |

Il firmware entra in idle automaticamente dopo 30 minuti senza connessione BLE.

---

## Confronto con CR2032

| | CR2032 | LiPo 100 mAh |
|---|--------|-------------|
| Capacità utile a 9 mA | ~25 mAh (cade tensione) | 95 mAh |
| Autonomia @ 9 mA | **~2–3 ore** | **~11 ore** |
| Temperatura freddo (0°C) | −40% capacità | −10% |
| Ricarica | No (usa e getta) | USB-C, 2 ore |
| Tensione stabile | No (cala da 3V a 2V) | Sì (3.7V costante) |
| Vibrazioni | Cella piatta, può allentarsi | Fissata con schiuma |
| **Verdetto** | ❌ Non adatta | ✅ Scelta corretta |

La CR2032 potrebbe funzionare **solo** riducendo il campionamento a 5 Hz e
disabilitando il modulo USB durante il funzionamento normale (autonomia ~8 ore).
Ma si perdono vibrazione ad alta frequenza e precisione del coast-down.
