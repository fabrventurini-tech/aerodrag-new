import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Modal, Alert, Animated,
} from 'react-native';
import { useStore, CrrCalibResult, CrrRunResult } from '../store';
import { surfaceLabelFromCrr } from '../physics/crr';
import { Colors, Sp, Radius } from '../theme';
import { WHEEL_CMD } from '../hooks/useWheelSensor';

interface Props {
  visible:       boolean;
  onClose:       () => void;
  sendCommand:   (cmd: number) => Promise<boolean>;
}

// ── Costanti UI ───────────────────────────────────────────────────────────────

const COAST_DOWN_S_MAX = 90;

export const QUALITY_OPTIONS = [
  { label: 'Ottima',   kmh: 30, desc: 'Massima precisione · ~160 s per run'  },
  { label: 'Buona',    kmh: 25, desc: 'Equilibrio sforzo/precisione · ~120 s' },
  { label: 'Moderata', kmh: 20, desc: 'Sforzo ridotto · ~90 s per run'        },
] as const;

// ── Screen principale ─────────────────────────────────────────────────────────

export function CrrCalibrationScreen({ visible, onClose, sendCommand }: Props) {
  const {
    crrCalib, wheelStream, wheelSensorStatus,
    startCrrCalib, setCrrTargetSpeed, readyForSpinup, startCrrRun, finalizeCrrRun,
    applyCrrResult, resetCrrCalib, loadCrrHistory,
  } = useStore();

  const [coastTimer, setCoastTimer] = useState(0);
  const coastIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) loadCrrHistory();
  }, [visible]);

  // Animazione pulsante durante il coast-down
  useEffect(() => {
    const isCoasting = ['coast_indoor', 'coast_outdoor_a', 'coast_outdoor_b'].includes(crrCalib.mode);
    if (isCoasting) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
        ])
      ).start();
      const interval = setInterval(() => setCoastTimer((t: number) => t + 1), 1000);
      coastIntervalRef.current = interval;
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      if (coastIntervalRef.current) {
        clearInterval(coastIntervalRef.current);
        coastIntervalRef.current = null;
      }
      setCoastTimer(0);
    }
    return () => {
      if (coastIntervalRef.current) clearInterval(coastIntervalRef.current);
    };
  }, [crrCalib.mode]);

  // Auto-finalizza il run quando la velocità scende sotto 2 m/s
  useEffect(() => {
    const isCoasting = ['coast_indoor', 'coast_outdoor_a', 'coast_outdoor_b'].includes(crrCalib.mode);
    if (isCoasting && wheelStream.speedMs < 2.0 && crrCalib.activeSamples.length > 30) {
      handleStopRun();
    }
  }, [wheelStream.speedMs, crrCalib.mode]);

  function handleClose() {
    if (['coast_indoor', 'coast_outdoor_a', 'coast_outdoor_b', 'spinup'].includes(crrCalib.mode)) {
      Alert.alert('Calibrazione in corso', 'Interrompere la calibrazione?', [
        { text: 'Continua', style: 'cancel' },
        {
          text: 'Interrompi',
          style: 'destructive',
          onPress: () => {
            sendCommand(WHEEL_CMD.CANCEL);
            resetCrrCalib();
            onClose();
          },
        },
      ]);
    } else {
      resetCrrCalib();
      onClose();
    }
  }

  async function handleStartRun() {
    const cmd = crrCalib.mode === 'coast_outdoor_b' || crrCalib.currentRun > 3
      ? WHEEL_CMD.START_OUTDOOR_B
      : crrCalib.protocol === 'outdoor'
        ? WHEEL_CMD.START_OUTDOOR_A
        : WHEEL_CMD.START_INDOOR;
    await sendCommand(cmd);
    startCrrRun();
  }

  function handleStopRun() {
    sendCommand(WHEEL_CMD.CANCEL);
    finalizeCrrRun();
  }

  function handleApply() {
    applyCrrResult();
    Alert.alert(
      'Crr aggiornato',
      `Il nuovo Crr ${crrCalib.result?.crr.toFixed(4)} è stato applicato al profilo.`,
      [{ text: 'OK', onPress: onClose }]
    );
  }

  const wheelConnected = wheelSensorStatus === 'connected';
  const speedKmh = wheelStream.speedMs * 3.6;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose}>
            <Text style={styles.closeBtn}>Chiudi</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Calibrazione Crr</Text>
          <View style={{ width: 52 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Sensore ruota status */}
          <View style={styles.sensorBar}>
            <View style={[styles.dot, { backgroundColor: wheelConnected ? Colors.teal : Colors.muted }]} />
            <Text style={styles.sensorLabel}>
              {wheelConnected ? 'Sensore ruota connesso' : 'Sensore ruota non trovato'}
            </Text>
            {wheelConnected && (
              <Text style={styles.sensorSub}>
                {speedKmh.toFixed(1)} km/h  |  {wheelStream.tempC.toFixed(1)}°C
              </Text>
            )}
          </View>

          {/* Fase: scelta protocollo */}
          {crrCalib.mode === 'idle' && (
            <ProtocolSelection onSelect={(p) => startCrrCalib(p)} disabled={!wheelConnected} />
          )}

            {/* Fase: setup / istruzioni */}
          {crrCalib.mode === 'setup' && (
            <SetupPhase
              protocol={crrCalib.protocol}
              targetKmh={crrCalib.targetSpeedKmh}
              onSelectQuality={setCrrTargetSpeed}
              onReady={readyForSpinup}
            />
          )}

          {/* Fase: spin-up — atleta pedala fino alla velocità target */}
          {crrCalib.mode === 'spinup' && (
            <SpinupPhase
              speedKmh={speedKmh}
              targetKmh={crrCalib.targetSpeedKmh}
              runIndex={crrCalib.currentRun}
              totalRuns={crrCalib.totalRuns}
              protocol={crrCalib.protocol}
              isOutdoorB={crrCalib.currentRun > 3}
              onStartCoast={handleStartRun}
            />
          )}

          {/* Fase: coast-down */}
          {['coast_indoor', 'coast_outdoor_a', 'coast_outdoor_b'].includes(crrCalib.mode) && (
            <CoastPhase
              speedKmh={speedKmh}
              accelMs2={wheelStream.accelMs2}
              vibRMS={wheelStream.vibRMS}
              elapsed={coastTimer}
              maxS={COAST_DOWN_S_MAX}
              samples={crrCalib.activeSamples.length}
              pulseAnim={pulseAnim}
              onStop={handleStopRun}
            />
          )}

          {/* Fase: risultato */}
          {crrCalib.mode === 'done' && crrCalib.result && (
            <ResultPhase
              result={crrCalib.result}
              runs={crrCalib.protocol === 'indoor' ? crrCalib.indoorRuns : [...crrCalib.outdoorRunsA, ...crrCalib.outdoorRunsB]}
              onApply={handleApply}
              onRetry={() => resetCrrCalib()}
            />
          )}

          {/* Storico sessioni Crr */}
          {crrCalib.mode === 'idle' && crrCalib.history.length > 0 && (
            <CrrHistory history={crrCalib.history} />
          )}

        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Sottocomponenti ───────────────────────────────────────────────────────────

function ProtocolSelection({ onSelect, disabled }: {
  onSelect: (p: 'indoor' | 'outdoor') => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Scegli il protocollo</Text>

      <TouchableOpacity
        style={[styles.protocolCard, disabled && styles.cardDisabled]}
        onPress={() => !disabled && onSelect('indoor')}
        activeOpacity={0.8}
      >
        <Text style={styles.protocolIcon}>🏠</Text>
        <View style={styles.protocolText}>
          <Text style={styles.protocolName}>Indoor — Rullo</Text>
          <Text style={styles.protocolDesc}>
            3 run coast-down su rullo.{'\n'}
            Fan spento, 30→0 km/h, ~2 minuti totali.{'\n'}
            Crr specifico per il tuo rullo.
          </Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.protocolCard, disabled && styles.cardDisabled]}
        onPress={() => !disabled && onSelect('outdoor')}
        activeOpacity={0.8}
      >
        <Text style={styles.protocolIcon}>🛣</Text>
        <View style={styles.protocolText}>
          <Text style={styles.protocolName}>Outdoor — Strada / Velodromo</Text>
          <Text style={styles.protocolDesc}>
            6 run bidirezionali (3+3).{'\n'}
            Cancella la componente vento algebricamente.{'\n'}
            Crr sulla superficie reale di gara.
          </Text>
        </View>
      </TouchableOpacity>

      {disabled && (
        <Text style={styles.disabledHint}>
          Collega il sensore ruota per iniziare
        </Text>
      )}
    </View>
  );
}

function SetupPhase({ protocol, targetKmh, onSelectQuality, onReady }: {
  protocol:        'indoor' | 'outdoor';
  targetKmh:       number;
  onSelectQuality: (kmh: number) => void;
  onReady:         () => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Preparazione</Text>
      <View style={styles.card}>
        {protocol === 'indoor' ? (
          <>
            <CheckItem text="Posiziona la bici sul rullo" />
            <CheckItem text="Spegni il fan (vento < 0.2 m/s)" />
            <CheckItem text="Verifica che il peso sia corretto in Impostazioni" />
            <CheckItem text="Gonfia i pneumatici alla pressione di gara" />
          </>
        ) : (
          <>
            <CheckItem text="Trova un rettilineo ≥ 300 m in entrambe le direzioni" />
            <CheckItem text="Pendenza < 0.5% (il sistema valida automaticamente)" />
            <CheckItem text="Vento < 3 m/s ideale (compensato dal protocollo bidirezionale)" />
            <CheckItem text="Assenza di traffico" />
          </>
        )}

        <Text style={styles.qualityTitle}>Precisione calibrazione</Text>
        <View style={styles.qualityRow}>
          {QUALITY_OPTIONS.map((opt) => {
            const active = targetKmh === opt.kmh;
            return (
              <TouchableOpacity
                key={opt.kmh}
                style={[styles.qualityCard, active && styles.qualityCardActive]}
                onPress={() => onSelectQuality(opt.kmh)}
                activeOpacity={0.8}
              >
                <Text style={[styles.qualityLabel, active && styles.qualityLabelActive]}>
                  {opt.label}
                </Text>
                <Text style={[styles.qualityKmh, active && styles.qualityKmhActive]}>
                  {opt.kmh} km/h
                </Text>
                <Text style={styles.qualityDesc}>{opt.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={onReady}>
          <Text style={styles.primaryBtnText}>Tutto pronto — Inizia</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SpinupPhase({ speedKmh, targetKmh, runIndex, totalRuns, protocol, isOutdoorB, onStartCoast }: {
  speedKmh:     number;
  targetKmh:    number;
  runIndex:     number;
  totalRuns:    number;
  protocol:     'indoor' | 'outdoor';
  isOutdoorB:   boolean;
  onStartCoast: () => void;
}) {
  const pct     = Math.min(1, speedKmh / targetKmh);
  const ready   = speedKmh >= targetKmh - 1;
  const dirLabel = protocol === 'outdoor'
    ? isOutdoorB ? '  Direzione B (inversa)' : '  Direzione A'
    : '';

  return (
    <View style={styles.section}>
      <View style={styles.runHeader}>
        <Text style={styles.runLabel}>Run {runIndex} / {totalRuns}</Text>
        {dirLabel ? <Text style={styles.dirLabel}>{dirLabel}</Text> : null}
      </View>
      <Text style={styles.sectionTitle}>Spin-up — Accelera a {targetKmh} km/h</Text>

      <View style={styles.card}>
        <Text style={styles.bigSpeed}>{speedKmh.toFixed(1)}</Text>
        <Text style={styles.bigSpeedUnit}>km/h</Text>

        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` as any }]} />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, !ready && styles.btnDisabled]}
          onPress={onStartCoast}
          disabled={!ready}
        >
          <Text style={styles.primaryBtnText}>
            {ready ? 'Smetti di pedalare — Coast-down!' : `Pedala fino a ${targetKmh} km/h…`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CoastPhase({ speedKmh, accelMs2, vibRMS, elapsed, maxS, samples, pulseAnim, onStop }: {
  speedKmh:  number;
  accelMs2:  number;
  vibRMS:    number;
  elapsed:   number;
  maxS:      number;
  samples:   number;
  pulseAnim: Animated.Value;
  onStop:    () => void;
}) {
  const pct = Math.min(1, elapsed / maxS);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Coast-down in corso</Text>
      <Animated.View style={[styles.card, { transform: [{ scale: pulseAnim }] }]}>
        <Text style={styles.bigSpeed}>{speedKmh.toFixed(1)}</Text>
        <Text style={styles.bigSpeedUnit}>km/h</Text>

        <View style={styles.coastMetrics}>
          <MetricPair label="Decelerazione" value={`${accelMs2.toFixed(3)} m/s²`} />
          <MetricPair label="Vibrazione" value={`${vibRMS.toFixed(3)} m/s²`} />
          <MetricPair label="Campioni" value={`${samples}`} />
          <MetricPair label="Tempo" value={`${elapsed}s`} />
        </View>

        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` as any, backgroundColor: Colors.amber }]} />
        </View>

        <Text style={styles.coastHint}>Il run si ferma automaticamente a 2 km/h</Text>

        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: Colors.redBg, borderColor: Colors.red }]} onPress={onStop}>
          <Text style={[styles.primaryBtnText, { color: Colors.red }]}>Ferma manualmente</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function ResultPhase({ result, runs, onApply, onRetry }: {
  result:  CrrCalibResult;
  runs:    CrrRunResult[];
  onApply: () => void;
  onRetry: () => void;
}) {
  const confidenceColor =
    result.confidence >= 80 ? Colors.teal :
    result.confidence >= 50 ? Colors.amber :
    Colors.red;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Risultato</Text>
      <View style={styles.card}>

        <View style={styles.resultRow}>
          <Text style={styles.crrBig}>{result.crr.toFixed(4)}</Text>
          <View style={[styles.confidencePill, { borderColor: confidenceColor }]}>
            <Text style={[styles.confidenceText, { color: confidenceColor }]}>
              {result.confidence}% confidenza
            </Text>
          </View>
        </View>

        <Text style={styles.surfaceLabel}>{result.surfaceLabel}</Text>

        <View style={styles.resultDetails}>
          <DetailRow label="Range" value={`${result.crrMin.toFixed(4)} – ${result.crrMax.toFixed(4)}`} />
          <DetailRow label="Temperatura" value={`${result.tempC.toFixed(1)}°C`} />
          <DetailRow label="Vibrazione media" value={`${result.vibRMS.toFixed(3)} m/s²`} />
          <DetailRow label="Run validi" value={`${result.runsUsed}`} />
        </View>

        <View style={styles.runsList}>
          {runs.map((r, i) => (
            <View key={i} style={styles.runItem}>
              <Text style={styles.runNum}>#{i + 1}</Text>
              <Text style={[styles.runValid, { color: r.valid ? Colors.teal : Colors.red }]}>
                {r.valid ? 'OK' : 'Non valido'}
              </Text>
              <Text style={styles.runCrr}>{r.crr.toFixed(4)}</Text>
              <Text style={styles.runRsq}>R²={r.rSquared.toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={onApply}>
          <Text style={styles.primaryBtnText}>Applica al profilo attivo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onRetry}>
          <Text style={styles.secondaryBtnText}>Ripeti calibrazione</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CrrHistory({ history }: {
  history: CrrCalibResult[];
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Storico superfici</Text>
      <View style={styles.card}>
        {history.map((h, i) => (
          <View key={i} style={styles.historyRow}>
            <View style={styles.historyLeft}>
              <Text style={styles.historyCrr}>{h.crr.toFixed(4)}</Text>
              <Text style={styles.historyLabel}>{h.surfaceLabel ?? surfaceLabelFromCrr(h.crr)}</Text>
            </View>
            <View style={styles.historyRight}>
              <Text style={styles.historyConf}>{h.confidence}%</Text>
              <Text style={styles.historyDate}>
                {new Date(h.timestamp).toLocaleDateString('it-IT')}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function CheckItem({ text }: { text: string }) {
  return (
    <View style={styles.checkRow}>
      <Text style={styles.checkIcon}>✓</Text>
      <Text style={styles.checkText}>{text}</Text>
    </View>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricPair}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

// ── Stili ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    paddingHorizontal: Sp.md,
    paddingVertical:   Sp.sm,
    backgroundColor:  Colors.s1,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  closeBtn: { fontSize: 14, color: Colors.teal, width: 52 },
  title:    { fontSize: 16, fontWeight: '700', color: Colors.textBright },

  content: { padding: Sp.md, gap: Sp.md, paddingBottom: Sp.xl },

  sensorBar: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             Sp.sm,
    paddingVertical: Sp.sm,
  },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  sensorLabel: { fontSize: 13, color: Colors.text, flex: 1 },
  sensorSub:   { fontSize: 11, color: Colors.muted },

  section:      { gap: Sp.sm },
  sectionTitle: {
    fontSize:      11,
    color:         Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  card: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },
  cardDisabled: { opacity: 0.4 },

  protocolCard: {
    flexDirection:   'row',
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.md,
    alignItems:      'flex-start',
  },
  protocolIcon: { fontSize: 28 },
  protocolText: { flex: 1, gap: Sp.xs },
  protocolName: { fontSize: 15, fontWeight: '700', color: Colors.textBright },
  protocolDesc: { fontSize: 12, color: Colors.muted, lineHeight: 18 },

  disabledHint: { fontSize: 12, color: Colors.amber, textAlign: 'center', marginTop: Sp.xs },

  runHeader: { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  runLabel:  { fontSize: 13, color: Colors.teal, fontWeight: '700' },
  dirLabel:  { fontSize: 12, color: Colors.muted },

  bigSpeed:     { fontSize: 56, fontWeight: '800', color: Colors.textBright, textAlign: 'center', fontVariant: ['tabular-nums'] },
  bigSpeedUnit: { fontSize: 14, color: Colors.muted, textAlign: 'center', marginTop: -Sp.md },

  progressBg: {
    height:          6,
    backgroundColor: Colors.s2,
    borderRadius:    3,
    overflow:        'hidden',
    marginVertical:  Sp.xs,
  },
  progressFill: {
    height:          6,
    backgroundColor: Colors.teal,
    borderRadius:    3,
  },

  primaryBtn: {
    backgroundColor: Colors.tealBg,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.teal,
    padding:         Sp.sm,
    alignItems:      'center',
    marginTop:       Sp.xs,
  },
  primaryBtnText: { color: Colors.teal, fontWeight: '700', fontSize: 14 },
  secondaryBtn: {
    backgroundColor: Colors.s2,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.sm,
    alignItems:      'center',
  },
  secondaryBtnText: { color: Colors.muted, fontWeight: '600', fontSize: 13 },
  btnDisabled: { opacity: 0.4 },

  coastMetrics: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            Sp.sm,
    justifyContent: 'space-between',
    marginVertical: Sp.xs,
  },
  metricPair:  { alignItems: 'center', minWidth: '40%' },
  metricLabel: { fontSize: 10, color: Colors.muted },
  metricValue: { fontSize: 14, color: Colors.textBright, fontVariant: ['tabular-nums'] },
  coastHint:   { fontSize: 11, color: Colors.muted, textAlign: 'center' },

  resultRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  crrBig: { fontSize: 44, fontWeight: '800', color: Colors.teal, fontVariant: ['tabular-nums'] },
  confidencePill: {
    borderWidth:     0.5,
    borderRadius:    Radius.sm,
    paddingHorizontal: Sp.sm,
    paddingVertical:   Sp.xs,
  },
  confidenceText: { fontSize: 12, fontWeight: '700' },
  surfaceLabel:   { fontSize: 14, color: Colors.text, fontWeight: '600', marginTop: -Sp.xs },

  resultDetails: { gap: Sp.xs, marginTop: Sp.xs },
  detailRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel:   { fontSize: 12, color: Colors.muted },
  detailValue:   { fontSize: 12, color: Colors.text, fontVariant: ['tabular-nums'] },

  runsList: { gap: Sp.xs, borderTopWidth: 0.5, borderTopColor: Colors.border, paddingTop: Sp.sm },
  runItem:  { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  runNum:   { fontSize: 11, color: Colors.muted, width: 24 },
  runValid: { fontSize: 11, fontWeight: '700', width: 64 },
  runCrr:   { fontSize: 13, color: Colors.textBright, fontVariant: ['tabular-nums'], flex: 1 },
  runRsq:   { fontSize: 11, color: Colors.muted },

  historyRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Sp.xs, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  historyLeft: { gap: 2 },
  historyCrr:  { fontSize: 18, fontWeight: '700', color: Colors.teal, fontVariant: ['tabular-nums'] },
  historyLabel: { fontSize: 11, color: Colors.muted },
  historyRight: { alignItems: 'flex-end', gap: 2 },
  historyConf:  { fontSize: 12, color: Colors.amber },
  historyDate:  { fontSize: 10, color: Colors.muted },

  checkRow:  { flexDirection: 'row', gap: Sp.sm, alignItems: 'flex-start' },
  checkIcon: { fontSize: 14, color: Colors.teal, marginTop: 1 },
  checkText: { fontSize: 13, color: Colors.text, flex: 1, lineHeight: 20 },

  qualityTitle: {
    fontSize:      11,
    color:         Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop:     Sp.xs,
  },
  qualityRow: {
    flexDirection: 'row',
    gap:           Sp.sm,
  },
  qualityCard: {
    flex:            1,
    backgroundColor: Colors.s2,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.sm,
    gap:             2,
    alignItems:      'center',
  },
  qualityCardActive: {
    backgroundColor: Colors.tealBg,
    borderColor:     Colors.teal,
  },
  qualityLabel: {
    fontSize:   12,
    fontWeight: '700',
    color:      Colors.muted,
  },
  qualityLabelActive: { color: Colors.teal },
  qualityKmh: {
    fontSize:        16,
    fontWeight:      '800',
    color:           Colors.muted,
    fontVariant:     ['tabular-nums'],
  },
  qualityKmhActive:  { color: Colors.textBright },
  qualityDesc: {
    fontSize:   9,
    color:      Colors.muted,
    textAlign:  'center',
    lineHeight: 13,
    marginTop:  2,
  },
});
