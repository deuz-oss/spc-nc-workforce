import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, Btn, Card, Chip, Field, H, Input, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import {
  CHILD_AGE_BRACKETS,
  CONSENT_TEXT,
  isUnder1Bracket,
  NTG_GWP_STAGES,
  NTG_GWP_STAGE_LABEL,
  UNDER1_MESSAGE,
} from '../config';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { Consumer, NtgGwp, NtgGwpStage } from '../types';
import { uid } from '../utils/uuid';
import { funnelStepError } from '../utils/funnel';
import { isValidWa } from '../utils/wa';
import { programDayKey } from '../utils/period';
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
  const saveConsumerWithStep = useStore((s) => s.saveConsumerWithStep);

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
  // Funnel steps belong to an open visit (the server refuses them after check-out, 0014).
  const visit = useStore((s) => s.visits.find((v) => v.id === visitId));
  const canAdvanceStage = !!visit && !visit.checkOutAt && !!storeId && !readOnly;
  // PRD §6 / PP 33/2012: an under-1 consumer stays at "approached" (also enforced server-side, 0014).
  const under1 = isUnder1Bracket(childAgeBracket);
  const legacyBracket = !!childAgeBracket && !CHILD_AGE_BRACKETS.some((b) => b.key === childAgeBracket);
  const historyStages = history.map((h) => h.stage);
  /** Forward-only funnel (0015): the current stage (no change) or a step the server would accept. */
  const stageSelectable = (s: NtgGwpStage) =>
    canAdvanceStage &&
    !(under1 && s !== 'approached') &&
    ((!isCreate && s === currentStage) || funnelStepError(historyStages, s) == null);
  const eraseConsumer = useStore((s) => s.eraseConsumer);
  const canErase = !!existing && !existing.erasedAt && (existing.createdByNcId === me.id || me.role === 'super_admin' || me.role === 'pm');

  const confirmErase = () =>
    showDialog(
      'Hapus Data Konsumen?',
      'Atas permintaan konsumen (UU PDP): nama, kontak WA, usia anak, brand dan jawaban quiz dihapus permanen. Riwayat tahap funnel tetap tersimpan tanpa data pribadi. Tindakan ini tidak bisa dibatalkan.',
      [
        { label: 'Batal' },
        {
          label: 'Hapus Data',
          destructive: true,
          onPress: async () => {
            if (!(await eraseConsumer(existing!.id))) {
              showDialog('Data Konsumen Dihapus', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
            }
          },
        },
      ],
    );

  const todaysStoreOfftake = useMemo(() => {
    if (!storeId) return [];
    const today = programDayKey(Date.now());
    return offtakeRows.filter((o) => o.storeId === storeId && programDayKey(o.createdAt) === today);
  }, [offtakeRows, storeId]);

  const submit = async () => {
    if (readOnly) return;
    if (!name.trim()) return showDialog('Belum lengkap', 'Nama konsumen wajib diisi.');
    if (!waContact.trim()) return showDialog('Belum lengkap', 'Kontak WhatsApp wajib diisi.');
    if (!consent) return showDialog('Consent diperlukan', 'Konsumen harus menyetujui consent sebelum data disimpan (UU PDP).');
    // The stage may have been picked before the age was set to under 1.
    if (under1 && stage !== 'approached' && stage !== currentStage) {
      setStage(currentStage);
      return showDialog('Anak di Bawah 1 Tahun', UNDER1_MESSAGE);
    }

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
      // Only record a funnel row when the stage actually moves (or on create) —
      // saving a contact-detail edit must not append a duplicate stage entry.
      const step: NtgGwp | null =
        canAdvanceStage && visitId && (isCreate || stage !== currentStage)
          ? {
              id: uid('ntg_'),
              consumerId: consumer.id,
              visitId,
              stage,
              gwpItem: stage === 'gwp_given' ? gwpItem.trim() || undefined : undefined,
              gwpQty: stage === 'gwp_given' && gwpQty.trim() ? Number(gwpQty) : undefined,
              offtakeId: stage === 'gwp_given' ? offtakeId : undefined,
              createdAt: now,
            }
          : null;
      // One transaction: the consumer never ends up saved without its step.
      if (await saveConsumerWithStep(consumer, step)) return; // dialog already shown

      showDialog(isCreate ? 'Konsumen Tersimpan' : 'Perubahan Tersimpan', undefined, [
        { label: 'OK', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (existing?.erasedAt) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Muted style={{ textAlign: 'center' }}>
          Data pribadi konsumen ini sudah dihapus atas permintaan ({fmtDateTime(existing.erasedAt)}).
        </Muted>
      </View>
    );
  }

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
              {CONSENT_TEXT}
            </Text>
          </TouchableOpacity>
          {existing?.consentAt && (
            <Muted style={{ marginTop: 8 }}>
              Consent tercatat {fmtDateTime(existing.consentAt)}
              {existing.consentVersion ? ` · teks versi ${existing.consentVersion}` : ''}
            </Muted>
          )}
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
                {!readOnly && waContact.trim() !== '' && !isValidWa(waContact) && (
                  <Muted style={{ marginTop: 4, color: C.accent }}>Nomor HP Indonesia, mis. 0812xxxxxxxx.</Muted>
                )}
              </Field>
              <View style={{ height: 10 }} />
              <Field label="Usia Anak (bracket — bukan tanggal lahir, PRD §6)">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {CHILD_AGE_BRACKETS.map((b) => (
                    <Chip
                      key={b.key}
                      label={b.label}
                      active={childAgeBracket === b.key}
                      onPress={readOnly ? undefined : () => setChildAgeBracket(b.key)}
                    />
                  ))}
                </View>
                {legacyBracket && (
                  <Muted style={{ marginTop: 6 }}>Tercatat sebelumnya: "{childAgeBracket}" — pilih salah satu bracket di atas.</Muted>
                )}
              </Field>
              <View style={{ height: 10 }} />
              <Field label="Brand Kompetitor Saat Ini (opsional)">
                <Input value={currentBrand} onChangeText={setCurrentBrand} editable={!readOnly} placeholder="mis. Brand X" />
              </Field>
            </Card>

            <Card>
              <H>Tahap Funnel</H>
              {under1 && (
                <View style={{ marginTop: 6 }}>
                  <Badge label="Anak < 1 tahun" color={C.warn} />
                  <Muted style={{ marginTop: 4 }}>{UNDER1_MESSAGE}</Muted>
                </View>
              )}
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
                    onPress={stageSelectable(s) ? () => setStage(s) : undefined}
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

            {canErase && (
              <Card>
                <H>Hapus Data Konsumen</H>
                <Muted style={{ marginTop: 2 }}>Untuk permintaan penghapusan data dari konsumen (UU PDP).</Muted>
                <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                  <Btn small variant="danger" title="Hapus Data Pribadi" onPress={confirmErase} />
                </View>
              </Card>
            )}

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
