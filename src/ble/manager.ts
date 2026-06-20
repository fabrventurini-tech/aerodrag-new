/**
 * manager.ts
 * Singleton BleManager condiviso a livello modulo.
 *
 * react-native-ble-plx richiede UN SOLO BleManager per processo: istanziarne
 * più di uno (come facevano in precedenza useBLE, useWheelSensor e
 * useCadenceSensor, tutti montati in App.tsx) provoca crash su Android.
 *
 * Tutti gli hook condividono questa istanza e NON devono chiamare
 * `.destroy()` per-hook: distruggerebbe il manager usato dagli altri.
 * Il manager vive per l'intera durata del processo app.
 */

import { BleManager } from 'react-native-ble-plx';

export const bleManager = new BleManager();
