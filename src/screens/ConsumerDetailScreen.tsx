import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, Btn, Card, Chip, Field, H, Input, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { NTG_GWP_STAGES, NTG_GWP_STAGE_LABEL } from '../config';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { Consumer, NtgGwpStage } from '../types';
import { uid } from '../utils/uuid';
import { fmtDateTime } from '../utils/format';

export default function ConsumerDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const consumerId: string | undefined = route.params?.consumerId;
  const visitId: string | undefined = route.params?.visitId;
  const storeId: string | undefined = route.params?.storeId;

  const consumers = useStore((s) => s.consumers);
  const ntgGwps = useStore((s) => s.ntgGwps);
  const offtakeRows = useStore((s) => s.offtakeRows);
  const upsertConsumer = useStore((s) => s.upsertConsumer);
  const addNtgGwp = useStore((s) => s.addNtgGwp);

  const existing = consumerId ? consumers.find((c) => c.id === consumerId) : undefined;
  const history = useMemo(
    // Newest first — explicit sort, since hydrated/realtime rows arrive in no particular order.
    () =>
      consumerId ? ntgGwps.filter((g) => g.consumerId === consumerId).sort((a, b) => b.createdAt - a.createdAt) : [],
    [ntgGwps, consumerId],
  );
  const currentStage: NtgGwpStage = history[0]?.stage ?? 'approached';
  const currentStageIdx = NTG_GWP_STAGES.indexOf(currentStage);

  const [name, setName] = useState(existing?.name ?? '');
  const [waContact, setWaContact] = useState(existing?.waContact ?? '');
  const [consent, setConsent] = useState(existing?.consent ?? false);
  const [childAgeBracket, setChildAgeBracket] = useState(existing?.childAgeBracket ?? '');
  const [currentBrand, setCurrentBrand] = useState(existing?.currentBrand ?? '');
  const [stage, setStage] = useState<NtgGwpStage>(currentStage);
  const [gwpItem, setGwpItem] = useState('');
  const [gwpQty, setGwpQty] = useState('');
  const [offtakeId, setOfftakeId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const isCreate = !consumerId;
  const ownedByMe = isCreate || existing?.createdByNcId === me.id;
  const readOnly = me.role !== 'nc' || !ownedByMe;
  const canAdvanceStage = !!visitId && !!storeId && !readOnly;

  const todaysStoreOfftake = useMemo(() => {
    if (!storeId) return [];
    const today = new Date().toDateString();
    return offtakeRows.filter((o) => o.storeId === storeId && new Date(o.createdAt).toDateString() === today);
  }, [offtakeRows, storeId]);

  const submit = async () => {
    if (readOnly) return;
    if (!name.trim()) return showDialog('Belum lengkap', 'Nama konsumen wajib diisi.');
    if (!waContact.trim()) return showDialog('Belum lengkap', 'Kontak WhatsApp wajib diisi.');
    if (!consent) return showDialog('Consent diperlukan', 'Konsumen harus menyetujui consent sebelum data disimpan (UU PDP).');

    setBusy(true);
    try {
      const now = Date.now();
      const consumer: Consumer = {
        id: existing?.id ?? uid('cons_'),
        name: name.trim(),
        waContact: waContact.trim(),
        consent,
        childAgeBracket: childAgeBracket.trim(),
        currentBrand: currentBrand.trim() || undefined,
        quizResult: existing?.quizResult,
        createdByNcId: existing?.createdByNcId ?? me.id,
        createdAt: existing?.createdAt ?? now,
      };
      const cErr = await upsertConsumer(consumer);
      if (cErr) return; // upsertConsumer already showed a dialog

      // Only record a funnel row when the stage actually moves (or on create) —
      // saving a contact-detail edit must not append a duplicate stage entry.
      if (canAdvanceStage && visitId && (isCreate || stage !== currentStage)) {
        const ntg = {
          id: uid('ntg_'),
          consumerId: consumer.id,
          visitId,
          stage,
          gwpItem: stage === 'gwp_given' ? gwpItem.trim() || undefined : undefined,
          gwpQty: stage === 'gwp_given' && gwpQty.trim() ? Number(gwpQty) : undefined,
          offtakeId: stage === 'gwp_given' ? offtakeId : undefined,
          createdAt: now,
        };
        const gErr = await addNtgGwp(ntg);
        if (gErr) return;
      }

      showDialog(isCreate ? 'Konsumen Tersimpan' : 'Perubahan Tersimpan', undefined, [
        { label: 'OK', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!isCreate && !existing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>Data konsumen tidak ditemukan.</Muted>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: !readOnly ? 110 : 24, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      >
        <SectionHeader
          title={isCreate ? 'Konsumen Baru' : name || 'Detail Konsumen'}
          subtitle="NTG & GWP (PRD §5.4) — consent sebelum pertanyaan apa pun, per UU PDP"
        />

        <Card>
          <TouchableOpacity
            onPress={() => !readOnly && setConsent((v) => !v)}
            disabled={readOnly}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
          >
            <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={24} color={consent ? C.primaryDark : C.faint} />
            <Text style={{ flex: 1, fontFamily: F.semi, fontSize: 13, color: C.text }}>
              Konsumen menyetujui data pribadinya (nama, kontak WA, hasil konsultasi) digunakan untuk program
              konsultasi nutrisi ini, sesuai UU PDP.
            </Text>
          </TouchableOpacity>
        </Card>

        {consent && (
          <>
            <Card>
              <Field label="Nama">
                <Input value={name} onChangeText={setName} editable={!readOnly} placeholder="Nama konsumen" />
              </Field>
              <View style={{ height: 10 }} />
              <Field label="Kontak WhatsApp">
                <Input value={waContact} onChangeText={setWaContact} editable={!readOnly} placeholder="08xxxxxxxxxx" keyboardType="phone-pad" />
              </Field>
              <View style={{ height: 10 }} />
              <Field label="Usia Anak (bracket)">
                <Input
                  value={childAgeBracket}
                  onChangeText={setChildAgeBracket}
                  editable={!readOnly}
                  placeholder="mis. 1-2 tahun (bukan tanggal lahir — PRD §6)"
                />
              </Field>
              <View style={{ height: 10 }} />
              <Field label="Brand Kompetitor Saat Ini (opsional)">
                <Input value={currentBrand} onChangeText={setCurrentBrand} editable={!readOnly} placeholder="mis. Brand X" />
              </Field>
            </Card>

            <Card>
              <H>Tahap Funnel</H>
              {!canAdvanceStage && (
                <Muted style={{ marginTop: 4 }}>
                  {readOnly
                    ? `Tahap saat ini: ${NTG_GWP_STAGE_LABEL[currentStage]}.`
                    : 'Buka dari kunjungan toko yang aktif untuk mengubah tahap funnel.'}
                </Muted>
              )}
              {canAdvanceStage && currentStage === 'approached' && !isCreate && (
                <View style={{ marginTop: 10 }}>
                  <Btn
                    small
                    variant="outline"
                    title="Mulai Nutrition Quiz"
                    onPress={() => navigation.navigate('NutritionQuiz', { consumerId: existing!.id, visitId })}
                  />
                </View>
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {NTG_GWP_STAGES.map((s, i) => (
                  <Chip
                    key={s}
                    label={NTG_GWP_STAGE_LABEL[s]}
                    active={stage === s}
                    onPress={canAdvanceStage && i >= currentStageIdx ? () => setStage(s) : undefined}
                    color={i < currentStageIdx ? C.ok : C.primary}
                  />
                ))}
              </View>

              {canAdvanceStage && stage === 'gwp_given' && (
                <View style={{ marginTop: 12, gap: 10 }}>
                  <Field label="Item GWP">
                    <Input value={gwpItem} onChangeText={setGwpItem} placeholder="mis. Sample Enfagrow A+ 400g" />
                  </Field>
                  <Field label="Jumlah GWP">
                    <Input value={gwpQty} onChangeText={(v) => setGwpQty(v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="1" />
                  </Field>
                  {todaysStoreOfftake.length > 0 && (
                    <Field label="Kaitkan ke Offtake Hari Ini (opsional)">
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {todaysStoreOfftake.map((o) => (
                          <Chip
                            key={o.id}
                            label={`${o.sku} · ${o.unitsSold} unit`}
                            active={offtakeId === o.id}
                            onPress={() => setOfftakeId(offtakeId === o.id ? undefined : o.id)}
                            color={C.teal}
                          />
                        ))}
                      </View>
                    </Field>
                  )}
                </View>
              )}
            </Card>

            {history.length > 0 && (
              <Card>
                <H>Riwayat Tahap</H>
                <View style={{ gap: 8, marginTop: 8 }}>
                  {history.map((h) => (
                    <View key={h.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Badge label={NTG_GWP_STAGE_LABEL[h.stage]} color={C.info} />
                      <Muted>{fmtDateTime(h.createdAt)}</Muted>
                    </View>
                  ))}
                </View>
              </Card>
            )}
          </>
        )}
      </ScrollView>

      {!readOnly && consent && (
        <StickyFooter>
          <Btn title={isCreate ? 'Simpan Konsumen Baru' : 'Simpan Perubahan'} onPress={submit} disabled={busy} loading={busy} />
        </StickyFooter>
      )}
    </View>
  );
}
