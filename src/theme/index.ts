import type { TextStyle } from 'react-native';

// ── Palette unificata (fonte di verità unica) ──────────────────────────────────
// Risolve i quattro teal storici divergenti in un solo accent (#00d9a3).
// Rosso (`alert`) SOLO per FC/peak/allarmi.
const accent   = '#00d9a3'; // CdA, brand, OK/attivo
const power    = '#f5a623'; // potenza, quota aero, warning
const speed    = '#4d9fff'; // velocità, rolling, info
const alert    = '#ff4d6a'; // SOLO FC, peak, allarmi
const positive = '#22c55e'; // delta migliore, new best

// Token semantici "puliti" (per i nuovi componenti).
export const Color = {
  accent,
  power,
  speed,
  alert,
  positive,
  text:    '#dbe6f6', // valori, titoli
  textDim: '#8398bd', // testo secondario
  muted:   '#46587c', // label, assi, unità
  surface: '#0f1420', // card, pannelli
  track:   '#1e2840', // sfondo barre/anelli
  bg:      '#07090f',  // sfondo schermo
  border:  'rgba(120,160,220,0.12)',
};

// Alias retro-compatibili: tutte le schermate importano `Colors.*` — qui i nomi
// storici puntano alla nuova palette, così la ritintura è centralizzata.
export const Colors = {
  bg:         Color.bg,
  s1:         Color.surface,
  s2:         Color.track,
  border:     Color.border,
  muted:      Color.textDim, // usato per testo secondario nelle schermate → leggibile
  text:       Color.text,
  textBright: '#eaf2ff',

  teal:    accent,
  tealBg:  accent + '15',
  amber:   power,
  amberBg: power + '15',
  red:     alert,
  redBg:   alert + '15',
  blue:    speed,
  blueBg:  speed + '15',

  positive,
};

export const Sp = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const Radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
};

// Famiglie caricate in App.tsx via expo-font (@expo-google-fonts).
// I nomi coincidono con le costanti esportate dai pacchetti.
export const Font = {
  mono:     'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
  sans:     'Inter_400Regular',
  sansBold: 'Inter_600SemiBold',
};

// Helper per i numeri: mono tabellare (niente jitter di larghezza).
export const monoNum: TextStyle = {
  fontFamily:  Font.mono,
  fontVariant: ['tabular-nums'],
};

export const monoNumBold: TextStyle = {
  fontFamily:  Font.monoBold,
  fontVariant: ['tabular-nums'],
};
