import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { Btn, Card, Empty, Field, H, IconButton, Input, Muted, SectionHeader, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { confirmSkippedRows, SkuPicker } from '../components/SkuPicker';
import { DraftNotice } from '../components/DraftNotice';
import { draftKey, useDraft } from '../components/useDraft';
import { EvidencePhotoField } from '../components/EvidencePhotoField';
import { C, R, SP, T } from '../theme';
import { fmtIDR } from '../utils/format';
import { reportedSkus, ShownError, useStore } from '../store/useStore';

interface DraftRow {
  key: string;
  sku: string;
  label: string;
  ownPrice: string;
  competitor1: string;
  competitor2: string;
  competitor3: string;
  manual: boolean;
}

/** Price Monitoring (PRD §5.6) — optional photo, up to 3 competitor prices per SKU. */
export default function PriceMonitoringScreen() {
  const route = useAppRoute<'PriceMonitoring'>();
  const navigation = useNavigation();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitPriceMonitoring = useStore((s) => s.submitPriceMonitoring);

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useMemo(() => ({ rows, photoUri }), [rows, photoUri]);
  const saved = useDraft(
    draftKey(visitId, 'price_monitoring'),
    draft,
    (d) => {
      setRows(d.rows);
      setPhotoUri(d.photoUri);
    },
    (d) => !d.rows.length && !d.photoUri,
  );

  const pickedSkus = useMemo(() => new Set(rows.map((r) => r.sku.toLowerCase())), [rows]);
  // One report per visit per SKU (a second one would double the numbers):
  // SKUs already sent for this visit are listed, not offered again.
  const allReported = useStore((s) => s.priceMonitoringRows);
  const reportedList = useMemo(() => allReported.filter((r) => r.visitId === visitId), [allReported, visitId]);
  const reported = useMemo(() => reportedSkus(reportedList, visitId), [reportedList, visitId]);

  // SkuPicker only offers SKUs that are neither in the form nor already reported.
  const addProduct = (sku: string, label: string, manual: boolean) => {
    setRows((r) => [...r, { key: sku + Date.now(), sku, label, ownPrice: '', competitor1: '', competitor2: '', competitor3: '', manual }]);
  };

  const updateRow = (key: string, patch: Partial<DraftRow>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removeRow = (key: string) => setRows((r) => r.filter((x) => x.key !== key));



  const validRows = rows.filter((r) => r.ownPrice.trim() !== '' && Number(r.ownPrice) >= 0);
  const canSubmit = validRows.length > 0 && !busy;

  const submit = async () => {
    if (!validRows.length) {
      showDialog('Belum lengkap', 'Isi minimal satu SKU dengan harga sendiri (boleh 0) sebelum menyimpan.');
      return;
    }
    const skipped = rows.filter((r) => !validRows.includes(r)).map((r) => r.sku);
    if (!(await confirmSkippedRows(skipped))) return;
    setBusy(true);
    try {
      const { queued } = await submitPriceMonitoring(
        visitId,
        storeId,
        validRows.map((r) => ({
          sku: r.sku,
          ownPrice: Number(r.ownPrice),
          competitorPrices: [r.competitor1, r.competitor2, r.competitor3]
            .filter((v) => v.trim() !== '')
            .map(Number)
            .filter((n) => isFinite(n) && n >= 0),
        })),
        photoUri ?? undefined,
      );
      await saved.clear();
      // Saved offline: the store already told the user — no second message.
      if (!queued) showToast('Price Monitoring tersimpan');
      navigation.goBack();
    } catch (e: any) {
      if (!(e instanceof ShownError)) {
        showDialog('Gagal Menyimpan', e?.message ?? 'Coba lagi.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: STICKY_FOOTER_SPACE, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      >
        <SectionHeader title="Price Monitoring" subtitle="Harga produk kita dan kompetitor di toko ini" />
        <DraftNotice
          savedAt={saved.restoredAt}
          onDiscard={() => {
            void saved.discard();
            setRows([]);
            setPhotoUri(null);
          }}
        />

        {reportedList.length > 0 && (
          <Card>
            <H>{`Sudah dikirim di kunjungan ini (${reportedList.length} produk)`}</H>
            <Muted style={{ marginTop: 2 }}>{reportedList.map((r) => `${r.sku}: ${fmtIDR(r.ownPrice)}`).join(' · ')}</Muted>
          </Card>
        )}

        <SkuPicker picked={pickedSkus} reported={reported} onAdd={addProduct} />

        <Card>
          <H>{`Produk dipilih (${rows.length})`}</H>
          {rows.length === 0 ? (
            <Empty icon="pricetag-outline" text="Belum ada produk dipilih. Ketuk produk di daftar atas." />
          ) : (
            <View style={{ gap: 10, marginTop: 10 }}>
              {rows.map((r) => (
                <View key={r.key} style={{ borderWidth: 1, borderColor: C.borderStrong, borderRadius: R.input, padding: SP.md, gap: SP.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SP.sm }}>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={T.h3} numberOfLines={2}>
                        {r.label}
                      </Text>
                      <Text style={T.small}>{r.manual ? `${r.sku} · ditambah manual` : r.sku}</Text>
                    </View>
                    <IconButton name="trash-outline" color={C.dangerStrong} label={`Hapus ${r.label}`} onPress={() => removeRow(r.key)} />
                  </View>
                  <Field label="Harga produk kita (Rp)" required>
                    <Input
                      placeholder="mis. 125000"
                      keyboardType="numeric"
                      value={r.ownPrice}
                      onChangeText={(v) => updateRow(r.key, { ownPrice: v.replace(/[^0-9.]/g, '') })}
                      accessibilityLabel={`Harga ${r.label}`}
                    />
                  </Field>
                  <Text style={T.label}>Harga kompetitor (opsional, maks. 3)</Text>
                  {/* Wraps to rows on a narrow phone instead of three 90 dp fields side by side. */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
                    {(['competitor1', 'competitor2', 'competitor3'] as const).map((k, i) => (
                      <View key={k} style={{ flexGrow: 1, flexBasis: 140 }}>
                        <Input
                          placeholder={`Kompetitor ${i + 1}`}
                          keyboardType="numeric"
                          value={r[k]}
                          onChangeText={(v) => updateRow(r.key, { [k]: v.replace(/[^0-9.]/g, '') })}
                          accessibilityLabel={`Harga kompetitor ${i + 1} untuk ${r.label}`}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <H>Foto label harga (opsional)</H>
          <EvidencePhotoField
            uri={photoUri}
            onChange={setPhotoUri}
            tips={['Label harga terbaca jelas', 'Produk dan labelnya ada di satu foto', 'Tidak silau dan tidak buram']}
          />
        </Card>
      </ScrollView>

      <StickyFooter>
        <Btn title={busy ? 'Mengirim…' : validRows.length ? `Simpan Price Monitoring (${validRows.length} produk)` : 'Isi harga produk dulu'} onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
