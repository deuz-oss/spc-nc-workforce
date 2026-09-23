import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Btn, Card, Chip, Field, H, Input, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { useStore } from '../store/useStore';
import { uid } from '../utils/uuid';

/** Generic Survey response flow (PRD §5.7) — renders whatever question set a
 * Data Analyst configured. Not used for the Nutrition Quiz (§6), which has
 * mandatory consent/branching rules the generic renderer doesn't model — see
 * NutritionQuizScreen. */
export default function SurveyRespondScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const surveyId: string = route.params?.surveyId;
  const visitId: string | undefined = route.params?.visitId;

  const survey = useStore((s) => s.surveys.find((x) => x.id === surveyId));
  const submitSurveyResponse = useStore((s) => s.submitSurveyResponse);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!survey) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>Survey tidak ditemukan.</Muted>
      </View>
    );
  }

  const answered = survey.questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length;
  const canSubmit = answered > 0 && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      const err = await submitSurveyResponse({
        id: uid('resp_'),
        surveyId: survey.id,
        visitId: visitId ?? null,
        consumerId: null,
        answers,
        createdAt: Date.now(),
      });
      if (err) return; // store action already showed a dialog
      showDialog('Jawaban Tersimpan', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 110, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      >
        <SectionHeader title={survey.title} subtitle={survey.campaignTag} />
        {survey.questions.map((q, i) => (
          <Card key={q.id}>
            <H>{`${i + 1}. ${q.text}`}</H>
            <View style={{ marginTop: 10 }}>
              {q.type === 'multiple_choice' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(q.options ?? []).map((opt) => (
                    <Chip
                      key={opt}
                      label={opt}
                      active={answers[q.id] === opt}
                      onPress={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                    />
                  ))}
                </View>
              ) : (
                <Field label="Jawaban">
                  <Input
                    value={answers[q.id] ?? ''}
                    onChangeText={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                    multiline
                    placeholder="Ketik jawaban..."
                  />
                </Field>
              )}
            </View>
          </Card>
        ))}
      </ScrollView>
      <StickyFooter>
        <Btn title={`Kirim Jawaban (${answered}/${survey.questions.length})`} onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
