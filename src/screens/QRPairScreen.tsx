import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal, Animated,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { parseDeviceQR, savePairedDevice, PairedDevice } from '../security/pairing';
import { useStore } from '../store';
import { Colors, Sp, Radius } from '../theme';
import { Icon } from '../components/Icon';

interface Props {
  visible:    boolean;
  onClose:    () => void;
  onPaired:   (device: PairedDevice) => void;
}

export function QRPairScreen({ visible, onClose, onPaired }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const setPairedDevice = useStore((s) => s.setPairedDevice);
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) setScanned(false);
  }, [visible]);

  // Dot "in attesa" lampeggiante finché non rileva un codice.
  useEffect(() => {
    if (!visible || scanned) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1,   duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, scanned]);

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission]);

  function handleScan({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);

    const device = parseDeviceQR(data);
    if (!device) {
      Alert.alert(
        'QR non valido',
        'Il codice scansionato non è un QR di pairing AeroDrag valido.',
        [{ text: 'Riprova', onPress: () => setScanned(false) }]
      );
      return;
    }

    savePairedDevice(device)
      .then(() => {
        setPairedDevice(device.id);
        onPaired(device);
        onClose();
      })
      .catch((e) => {
        Alert.alert('Errore', `Impossibile salvare il pairing: ${e?.message ?? e}`, [
          { text: 'OK', onPress: () => setScanned(false) },
        ]);
      });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {!permission ? (
          <View style={styles.center}>
            <Text style={styles.text}>Verifica permessi fotocamera…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.text}>
              Permesso fotocamera non concesso.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={requestPermission}>
              <Text style={styles.btnText}>Concedi permesso</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={onClose}>
              <Text style={[styles.btnText, { color: Colors.muted }]}>Annulla</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : handleScan}
            />
            <View style={styles.overlay}>
              <View style={styles.wordmark}>
                <Icon name="target" size={18} color={Colors.teal} />
                <Text style={styles.wordmarkText}>AeroDrag</Text>
              </View>

              <View style={styles.frame}>
                {/* reticolo di mira agli angoli */}
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>

              <View style={styles.waitRow}>
                <Animated.View style={[styles.waitDot, { opacity: blink }]} />
                <Text style={styles.hint}>In attesa del QR del device…</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeText}>Chiudi</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    padding:        Sp.lg,
    gap:            Sp.md,
    backgroundColor: Colors.bg,
  },
  text:    { fontSize: 14, color: Colors.text, textAlign: 'center' },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            Sp.lg,
  },
  frame: {
    width:        240,
    height:       240,
  },
  corner: {
    position:    'absolute',
    width:       34,
    height:      34,
    borderColor: Colors.teal,
  },
  cornerTL: { top: 0,    left: 0,    borderTopWidth: 3, borderLeftWidth: 3,  borderTopLeftRadius: Radius.md },
  cornerTR: { top: 0,    right: 0,   borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: Radius.md },
  cornerBL: { bottom: 0, left: 0,    borderBottomWidth: 3, borderLeftWidth: 3,  borderBottomLeftRadius: Radius.md },
  cornerBR: { bottom: 0, right: 0,   borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: Radius.md },

  wordmark:     { flexDirection: 'row', alignItems: 'center', gap: Sp.xs },
  wordmarkText: { fontSize: 16, fontWeight: '700', color: Colors.textBright, letterSpacing: 0.5 },

  waitRow: { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  waitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.red },
  hint: {
    fontSize:        13,
    color:           '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: Sp.md,
    paddingVertical:   Sp.xs,
    borderRadius:    Radius.sm,
  },
  closeBtn: {
    position:        'absolute',
    bottom:          Sp.xl,
    alignSelf:       'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius:    Radius.md,
    paddingHorizontal: Sp.lg,
    paddingVertical:   Sp.sm,
    borderWidth:     0.5,
    borderColor:     Colors.border,
  },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btn: {
    backgroundColor: Colors.tealBg,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.teal,
    paddingHorizontal: Sp.lg,
    paddingVertical:   Sp.sm,
    minWidth:        200,
    alignItems:      'center',
  },
  btnSecondary: {
    backgroundColor: Colors.s2,
    borderColor:     Colors.border,
  },
  btnText: { color: Colors.teal, fontWeight: '600', fontSize: 14 },
});
