import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, Alert,
} from 'react-native';
import { useStore, AthleteProfile } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { Colors, Sp, Radius } from '../theme';

function generateId(): string {
  // timestamp (monotono) + random → evita collisioni del solo Math.random
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// La tastiera decimal-pad italiana inserisce la virgola: parseFloat("72,5")
// darebbe 72 troncando i decimali in silenzio. Normalizza prima del parse.
function parseDecimal(s: string): number {
  return parseFloat(s.replace(',', '.'));
}

export function AthletesScreen() {
  const {
    athleteProfiles, activeAthleteId,
    saveAthleteProfile, deleteAthleteProfile, setActiveAthlete,
  } = useStore(useShallow((s) => ({
    athleteProfiles: s.athleteProfiles, activeAthleteId: s.activeAthleteId,
    saveAthleteProfile: s.saveAthleteProfile, deleteAthleteProfile: s.deleteAthleteProfile,
    setActiveAthlete: s.setActiveAthlete,
  })));

  const [editing, setEditing]       = useState<AthleteProfile | null>(null);
  const [name, setName]             = useState('');
  const [massRider, setMassRider]   = useState('70');
  const [massBike, setMassBike]     = useState('8');
  const [crr, setCrr]               = useState('0.004');

  function openNew() {
    setEditing({ id: generateId(), name: '', massRiderKg: 70, massBikeKg: 8, crr: 0.004 });
    setName('');
    setMassRider('70');
    setMassBike('8');
    setCrr('0.004');
  }

  function openEdit(p: AthleteProfile) {
    setEditing(p);
    setName(p.name);
    setMassRider(String(p.massRiderKg));
    setMassBike(String(p.massBikeKg));
    setCrr(String(p.crr));
  }

  async function handleSave() {
    if (!editing || !name.trim()) return;
    const riderKg = parseDecimal(massRider) || 70;
    const bikeKg  = parseDecimal(massBike)  || 8;
    const profile: AthleteProfile = {
      id:          editing.id,
      name:        name.trim(),
      massRiderKg: riderKg,
      massBikeKg:  bikeKg,
      crr:         parseDecimal(crr) || 0.004,
    };
    await saveAthleteProfile(profile);
    setEditing(null);
  }

  function handleDelete(p: AthleteProfile) {
    Alert.alert(
      'Elimina profilo',
      `Eliminare il profilo di ${p.name}?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: () => {
            deleteAthleteProfile(p.id);
            if (activeAthleteId === p.id) setActiveAthlete(null);
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.sectionTitle}>Profili atleti</Text>

      {/* ── Lista profili ── */}
      {athleteProfiles.length === 0 && !editing && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            Nessun profilo.{'\n'}Aggiungi un atleta per personalizzare il calcolo CdA.
          </Text>
        </View>
      )}

      {athleteProfiles.map((p) => {
        const isActive = p.id === activeAthleteId;
        return (
          <View
            key={p.id}
            style={[styles.profileCard, isActive && styles.profileCardActive]}
          >
            <View style={styles.profileHeader}>
              <Text style={styles.profileName}>{p.name}</Text>
              {isActive && (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>Attivo</Text>
                </View>
              )}
            </View>
            <Text style={styles.profileDetail}>
              Ciclista {p.massRiderKg} kg  •  Bici {p.massBikeKg} kg  •  Totale {p.massRiderKg + p.massBikeKg} kg  •  CRR {p.crr}
            </Text>
            <View style={styles.profileActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => setActiveAthlete(isActive ? null : p.id)}
              >
                <Text style={[styles.actionText, { color: Colors.teal }]}>
                  {isActive ? 'Disattiva' : 'Seleziona'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => openEdit(p)}
              >
                <Text style={[styles.actionText, { color: Colors.amber }]}>Modifica</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleDelete(p)}
              >
                <Text style={[styles.actionText, { color: Colors.red }]}>Elimina</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* ── Form nuovo/modifica ── */}
      {editing ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>
            {athleteProfiles.find((p) => p.id === editing.id) ? 'Modifica atleta' : 'Nuovo atleta'}
          </Text>

          <Text style={styles.fieldLabel}>Nome</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Nome atleta"
            placeholderTextColor={Colors.muted}
          />

          <Text style={styles.fieldLabel}>Massa ciclista [kg]</Text>
          <TextInput
            style={styles.input}
            value={massRider}
            onChangeText={setMassRider}
            keyboardType="decimal-pad"
            placeholderTextColor={Colors.muted}
          />

          <Text style={styles.fieldLabel}>Massa bici [kg]</Text>
          <TextInput
            style={styles.input}
            value={massBike}
            onChangeText={setMassBike}
            keyboardType="decimal-pad"
            placeholderTextColor={Colors.muted}
          />

          <Text style={styles.fieldLabel}>CRR (coefficiente resistenza rotolamento)</Text>
          <TextInput
            style={styles.input}
            value={crr}
            onChangeText={setCrr}
            keyboardType="decimal-pad"
            placeholderTextColor={Colors.muted}
          />

          <View style={styles.formActions}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: Colors.tealBg, borderColor: Colors.teal }]}
              onPress={handleSave}
            >
              <Text style={[styles.btnText, { color: Colors.teal }]}>Salva</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: Colors.s2, borderColor: Colors.border }]}
              onPress={() => setEditing(null)}
            >
              <Text style={[styles.btnText, { color: Colors.muted }]}>Annulla</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={openNew}>
          <Text style={styles.addBtnText}>+ Nuovo atleta</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Sp.md, gap: Sp.sm, paddingBottom: Sp.xl },

  sectionTitle: {
    fontSize:      12,
    color:         Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  emptyBox: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.xl,
    alignItems:      'center',
  },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 22 },

  profileCard: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.xs,
  },
  profileCardActive: { borderColor: Colors.teal + '80' },
  profileHeader:     { flexDirection: 'row', alignItems: 'center', gap: Sp.sm },
  profileName:       { fontSize: 16, fontWeight: '600', color: Colors.textBright, flex: 1 },
  profileDetail:     { fontSize: 12, color: Colors.muted },
  profileActions:    { flexDirection: 'row', gap: Sp.sm, marginTop: Sp.xs },
  actionBtn:         { paddingVertical: 4, paddingHorizontal: 8 },
  actionText:        { fontSize: 13, fontWeight: '600' },

  activeBadge: {
    backgroundColor: Colors.tealBg,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.teal,
    paddingHorizontal: 8,
    paddingVertical:   2,
  },
  activeBadgeText: { fontSize: 10, color: Colors.teal, fontWeight: '600' },

  form: {
    backgroundColor: Colors.s1,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    padding:         Sp.md,
    gap:             Sp.sm,
  },
  formTitle:  { fontSize: 14, fontWeight: '600', color: Colors.textBright },
  fieldLabel: { fontSize: 12, color: Colors.muted },
  input: {
    backgroundColor: Colors.s2,
    borderRadius:    Radius.sm,
    borderWidth:     0.5,
    borderColor:     Colors.border,
    color:           Colors.text,
    fontSize:        14,
    padding:         Sp.sm,
  },
  formActions: { flexDirection: 'row', gap: Sp.sm, marginTop: Sp.xs },
  btn: {
    flex:          1,
    borderRadius:  Radius.sm,
    borderWidth:   0.5,
    padding:       Sp.sm,
    alignItems:    'center',
  },
  btnText: { fontWeight: '600' },

  addBtn: {
    backgroundColor: Colors.tealBg,
    borderRadius:    Radius.md,
    borderWidth:     0.5,
    borderColor:     Colors.teal,
    padding:         Sp.md,
    alignItems:      'center',
  },
  addBtnText: { color: Colors.teal, fontWeight: '600', fontSize: 15 },
});