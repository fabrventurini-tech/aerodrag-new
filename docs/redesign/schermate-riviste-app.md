# Schermate riviste — APP MOBILE

**Repo di destinazione:** `aerodrag-new` (React Native / Expo)
**Obiettivo:** allineare le **7 schermate** al linguaggio visivo unificato AeroDrag, identico su iOS e Android.

> Tutte le modifiche sono **solo** nel repo `aerodrag-new`. Nessuna toccata al repo Pi o firmware.
> ⚠️ **Contratto dati INVARIATO (v0.2.3)** — nessun nuovo campo sul wire. `crrSource` vive nello **store locale** dell'app.

---

## 1. Design tokens — palette unificata (fonte di verità unica)

`src/theme/index.ts`. **Risolve i 4 teal divergenti** (`#00c896`, `#00c8a0`, `#00d9a3`, `#00d4aa`) → **un solo `#00d9a3`**.

```ts
export const Color = {
  accent:   '#00d9a3', // CdA, brand, OK/attivo
  power:    '#f5a623', // potenza, quota aero, warning
  speed:    '#4d9fff', // velocità, rolling, info
  alert:    '#ff4d6a', // SOLO FC, peak, allarmi
  positive: '#22c55e', // delta migliore, new best
  text:     '#dbe6f6', // valori, titoli
  textDim:  '#8398bd', // testo secondario
  muted:    '#46587c', // label, assi, unità
  surface:  '#0f1420', // card, pannelli
  track:    '#1e2840', // sfondo barre/anelli
  bg:       '#07090f', // sfondo schermo
  border:   'rgba(120,160,220,0.12)',
};
export const Font = { mono: 'JetBrainsMono', sans: 'Inter' };
export const Radius = { card: 14, chip: 10, pill: 999 };
```

Rosso (`alert`) **solo** per FC/peak/allarmi. Numeri sempre in `Font.mono` tabellare; label/testo in `Font.sans`.

---

## 2. Font — expo-font (obbligatorio per iOS+Android)

`Font.mono = 'Menlo'` oggi è definito ma **non usato** ed è solo iOS/Mac → su Android darebbe fallback diverso o **testo invisibile** se applicato prima del load.

1. `npx expo install expo-font expo-splash-screen`
2. Bundlare `JetBrainsMono-{Regular,Medium,Bold}.ttf` (e opzionalmente `Inter-*`) in `assets/fonts/`.
3. In `App.tsx`: `useFonts({...})` + **guardia SplashScreen** (`SplashScreen.preventAutoHideAsync()` → `hideAsync()` a font caricati).
4. Applicare `fontFamily` **solo dopo** che i font sono caricati.
5. Se `Inter` non viene bundlato → usare il **sans di sistema** come fallback per il solo testo UI (i numeri devono comunque essere mono).

---

## 3. Regole di colore (cosa cambia)

| Elemento | Dopo |
|---|---|
| CdA | `accent` |
| Potenza / quota aero | `power` |
| Velocità / rolling | `speed` |
| FC / peak / allarmi | `alert` (unico uso del rosso) |
| Delta "best" | `positive` |
| Rosso altrove | **rimosso** |

---

## 4. Componenti condivisi
- **MetricCard**: `surface` bg, bordo `border`, radius `card`. Label sans 10px muted uppercase; valore mono ~26px colore semantico; unità muted.
- **RingGauge (NUOVO)**: anello 12px `track` → progress gradiente `accent→speed`; centro CdA mono 34px + delta (`positive` se migliore); a fianco **pctAero** (numero `power` + barra 6px).
- **NavBar**: icone **vettoriali** stroke (no emoji `⬤📊📡👤⚙️`); tab attiva `accent` + barretta 2px; inattiva `muted`.
- **MiniChart**: polyline 2px `accent` (CdA) / `power` (potenza); riferimento "best" tratteggiato `muted`.

---

## 5. Le 7 schermate

### 1) LiveScreen
Hero **RingGauge CdA + pctAero**; griglia 2×3 MetricCard color-coded; **breakdown potenza** (Aero `power` / Rolling `speed` / Gravità `muted`) con **badge provenienza Crr**; sparkline 60s; **LAP target primario grande** in REC, STOP secondario; header con pill BLE/ANT+/Pi e REC lampeggiante `alert`.
- Il **toggle Simulazione NON sta qui** → spostato in SettingsScreen (vedi §7).

### 2) SessionScreen
Riepilogo 6 valori; grafico CdA per lap (best `accent`); tabella lap (Lap/CdA/Pot/Vel/FC, best evidenziata); azioni Esporta .FIT / Confronta.

### 3) CoachScreen
Verdetto posizione migliore (Δ CdA, W@45, s su 40 km); raccomandazioni con icona semantica; card "prossimo test".

### 4) AthletesScreen
Ricerca + lista atleti (avatar, best CdA, peso, n. test, chevron); atleta odierno evidenziato; footer statistiche gruppo.

### 5) CrrCalibrationScreen (modal a fasi)
Protocollo → Setup → Spin-up → Coast → **Risultato**. Logica fisica **invariata**, solo ritintura token.
- Stepper di fase; sensor-bar ruota (dot accent/muted + km/h, °C mono).
- Risultato: `crr` mono grande (`accent`) + **pill confidenza** per soglia (≥80 `accent`, ≥50 `power`, else `alert`); etichetta superficie.
- **Badge `CRR SOURCE`** (MISURATO/STIMA/PROFILO) — **da store locale**, è la fonte del campo mostrato in Live.
- Dettagli (range/temp/vibrazione/run validi) mono; lista run (#/Stato/Crr/R²; OK `accent`, Non valido `alert`).
- Spin-up/Coast: velocità mono grande, barra progresso (`accent`; coast `power`), stop in `alert`.
- **Emoji da rimuovere**: protocollo `🏠`/`🛣` e check `✓` testuale → icone vettoriali (casa/strada/check).

### 6) QRPairScreen — **AGGIUNTA (mancava)**
Scanner QR per il pairing.
- Riquadro camera con **reticolo di mira** vettoriale `accent`.
- Wordmark `◉ AeroDrag` + istruzione (muted).
- Stato **"in attesa"** con dot `alert` lampeggiante finché non rileva il codice.
- Codice/short-id mono (textDim). Nessuna emoji; icone stroke.

### 7) SettingsScreen (voce "Setup" della NavBar) — **AGGIUNTA (mancava)**
- Ritintura token; sezioni con MetricCard/righe.
- **SPOSTA qui il toggle "Simulazione"** (era nel flusso live).
  - ⚠️ Il toggle **DEVE restare collegato alla logica sim esistente** (`startSimulation` in `useBLE`): è solo **riposizionamento UI**, **non** rimuovere/duplicare la funzione.
- Altre voci esistenti (profilo, peso, sensori, unità) ritintate, struttura invariata.

---

## 6. NOTE ANTI-REGRESSIONE
- **Contratto v0.2.3 invariato**: `crrSource` da **store locale** (calcolato in CrrCalibration), mai dal wire.
- Toggle Simulazione: **solo** spostamento UI in Settings; resta agganciato a `startSimulation`/`useBLE`.
- Non rimuovere logica fisica della calibrazione (solo restyle).
- Non applicare `fontFamily` prima del load font (rischio testo invisibile su Android).

## 7. CHECKLIST DI ACCETTAZIONE
- [ ] Gira su **iOS e Android** con font **mono visibile** (no fallback di sistema sui numeri).
- [ ] Tutte e **7** le schermate presenti e ritinte.
- [ ] Toggle **Simulazione in Settings** e **funzionante** (avvia/ferma la sim come prima).
- [ ] Nessun `#00c8a0`/`#00d4aa`/`#00c896` residuo (grep).
- [ ] Nessuna emoji nei componenti UI.
- [ ] Rosso **solo** su FC/peak/alert.
- [ ] Numeri in mono tabellare → niente jitter.
- [ ] LAP hit target ≥44px (idealmente ≥56px).
- [ ] Badge CRR SOURCE visibile in CrrCalibration e Live (da stato locale).
