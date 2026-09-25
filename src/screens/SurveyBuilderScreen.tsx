import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Btn, Card, Empty, Field, H, Input, ListRow, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { NUTRITION_QUIZ_CAMPAIGN_TAG, SURVEY_BUILDER_ROLES } from '../config';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { SurveyQuestion } from '../types';
import { uid } from '../utils/uuid';

interface DraftQuestion extends SurveyQuestion {
  optionsText: string; // raw comma-separated input for multiple_choice
}

/** Data Analyst-facing survey builder (PRD §5.7). Question sets are simple —
 * multiple choice or free text, no conditional branching (that's what makes
 * the Nutrition Quiz its own dedicated screen rather than a config here). */
export default function SurveyBuilderScreen() {
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const allSurveys = useStore((s) => s.surveys);
  // Filter outside the selector: a selector returning a fresh array every call
  // makes zustand re-render on every store change.
  const surveys = useMemo(() => allSurveys.filter((sv) => sv.campaignTag !== NUTRITION_QUIZ_CAMPAIGN_TAG), [allSurveys]);
  const upsertSurvey = useStore((s) => s.upsertSurvey);
  const surveyResponses = useStore((s) => s.surveyResponses);
  const responseCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of surveyResponses) m.set(r.surveyId, (m.get(r.surveyId) ?? 0) + 1);
    return m;
  }, [surveyResponses]);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [campaignTag, setCampaignTag] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [busy, setBusy] = useState(false);

  if (!SURVEY_BUILDER_ROLES.includes(me.role)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Muted>Hanya Data Analyst dan Super Admin yang dapat mengelola Survey.</Muted>
      </View>
    );
  }

  const addQuestion = (type: SurveyQuestion['type']) =>
    setQuestions((q) => [...q, { id: uid('q_'), text: '', type, options: [], optionsText: '' }]);
  const updateQuestion = (id: string, patch: Partial<DraftQuestion>) =>
    setQuestions((q) => q.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeQuestion = (id: string) => setQuestions((q) => q.filter((x) => x.id !== id));

  const resetForm = () => {
    setCreating(false);
    setTitle('');
    setCampaignTag('');
    setQuestions([]);
  };

  const optionsOf = (q: DraftQuestion) => q.optionsText.split(',').map((o) => o.trim()).filter(Boolean);
  const canSave =
    title.trim().length > 0 &&
    questions.length > 0 &&
    questions.every((q) => q.text.trim().length > 0 && (q.type !== 'multiple_choice' || optionsOf(q).length >= 2));

  const save = async () => {
    if (!canSave) {
      showDialog(
        'Belum lengkap',
        'Isi judul survey dan minimal satu pertanyaan. Semua pertanyaan harus punya teks, dan pilihan ganda minimal 2 pilihan.',
      );
      return;
    }
    setBusy(true);
    try {
      const err = await upsertSurvey({
        id: uid('sv_'),
        title: title.trim(),
        questions: questions.map((q) => ({
          id: q.id,
          text: q.text.trim(),
          type: q.type,
          options: q.type === 'multiple_choice' ? optionsOf(q) : undefined,
        })),
        campaignTag: campaignTag.trim() || undefined,
        createdBy: me.id,
        createdAt: Date.now(),
      });
      if (err) return;
      showDialog('Survey Tersimpan', undefined, [{ label: 'OK', onPress: resetForm }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: creating ? 110 : 24, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      >
        <SectionHeader
          title="Kelola Survey"
          subtitle="Question set multiple choice / free text (PRD §5.7)"
          action={creating ? undefined : { label: '+ Survey Baru', onPress: () => setCreating(true) }}
        />

        {!creating && (
          <Card>
            {surveys.length === 0 ? (
              <Empty text="Belum ada survey. Buat survey baru untuk mulai." />
            ) : (
              <View style={{ gap: 8 }}>
                {surveys.map((s) => (
                  <ListRow
                    key={s.id}
                    title={s.title}
                    subtitle={`${s.questions.length} pertanyaan${s.campaignTag ? ` · ${s.campaignTag}` : ''} · ${responseCounts.get(s.id) ?? 0} respons`}
                    meta="Lihat hasil"
                    onPress={() => navigation.navigate('SurveyResults', { surveyId: s.id })}
                  />
                ))}
              </View>
            )}
          </Card>
        )}

        {creating && (
          <>
            <Card>
              <Field label="Judul Survey">
                <Input value={title} onChangeText={setTitle} placeholder="mis. Survey Kepuasan Konsumen Q1" />
              </Field>
              <View style={{ height: 10 }} />
              <Field label="Campaign Tag (opsional)">
                <Input value={campaignTag} onChangeText={setCampaignTag} placeholder="mis. campaign_ramadan_2027" />
              </Field>
            </Card>

            <Card>
              <H>Pertanyaan ({questions.length})</H>
              <View style={{ gap: 10, marginTop: 10 }}>
                {questions.map((q, i) => (
                  <View key={q.id} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, gap: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.muted }}>
                        {`Pertanyaan ${i + 1} · ${q.type === 'multiple_choice' ? 'Pilihan Ganda' : 'Isian Bebas'}`}
                      </Text>
                      <TouchableOpacity onPress={() => removeQuestion(q.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ color: C.accent, fontFamily: F.semi, fontSize: 12 }}>Hapus</Text>
                      </TouchableOpacity>
                    </View>
                    <Input value={q.text} onChangeText={(v) => updateQuestion(q.id, { text: v })} placeholder="Teks pertanyaan" />
                    {q.type === 'multiple_choice' && (
                      <Input
                        value={q.optionsText}
                        onChangeText={(v) => updateQuestion(q.id, { optionsText: v })}
                        placeholder="Pilihan, dipisah koma (mis. Ya, Tidak, Belum yakin)"
                      />
                    )}
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Btn small variant="outline" title="+ Pilihan Ganda" onPress={() => addQuestion('multiple_choice')} />
                <Btn small variant="outline" title="+ Isian Bebas" onPress={() => addQuestion('free_text')} />
              </View>
            </Card>

            <Btn variant="outline" title="Batal" onPress={resetForm} />
          </>
        )}
      </ScrollView>

      {creating && (
        <StickyFooter>
          <Btn title="Simpan Survey" onPress={save} disabled={!canSave || busy} loading={busy} />
        </StickyFooter>
      )}
    </View>
  );
}
