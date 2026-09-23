import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, Btn, Card, Chip, Field, H, Input, Muted, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { CHILD_AGE_BRACKETS, NUTRITION_QUIZ_SURVEY_ID } from '../config';
import { C, F } from '../theme';
import { useStore } from '../store/useStore';
import { SurveyQuestion } from '../types';
import { uid } from '../utils/uuid';

/**
 * Nutrition Quiz (PRD §6) — ~9 questions completed by the mom, linked to an
 * NTG & GWP record. A dedicated flow, not the generic SurveyRespondScreen,
 * because its rules are mandatory and not configurable:
 *   - explicit consent screen before any question
 *   - first question (age bracket) branches: under 1 year gets an ASI/MPASI-
 *     only informational branch with NO product recommendation and NO stage
 *     advancement / follow-up trigger (finishUnder1 never calls upsertNtgGwp)
 *   - no child weight/height/name/DOB anywhere — only the existing bracket
 *   - output is a rule-based segment tag, not a medical assessment
 */

const QUIZ_QUESTIONS: SurveyQuestion[] = [
  {
    id: 'milk_current',
    text: 'Apa jenis susu/nutrisi yang sedang dikonsumsi anak saat ini?',
    type: 'multiple_choice',
    options: ['ASI Eksklusif', 'Susu Formula Lain', 'Enfagrow A+', 'Kombinasi/Campuran', 'Belum Menentu'],
  },
  {
    id: 'feed_frequency',
    text: 'Seberapa sering anak mengonsumsi susu pertumbuhan dalam sehari?',
    type: 'multiple_choice',
    options: ['1x', '2x', '3x atau lebih', 'Tidak rutin'],
  },
  {
    id: 'concern',
    text: 'Apa perhatian utama Anda terkait tumbuh kembang anak saat ini?',
    type: 'multiple_choice',
    options: ['Berat badan', 'Tinggi badan', 'Daya tahan tubuh', 'Perkembangan otak/kognitif', 'Nafsu makan'],
  },
  {
    id: 'allergy',
    text: 'Apakah anak memiliki alergi atau kondisi khusus terkait makanan/susu?',
    type: 'multiple_choice',
    options: ['Tidak ada', 'Alergi susu sapi', 'Intoleransi laktosa', 'Lainnya'],
  },
  {
    id: 'purchase_channel',
    text: 'Dari mana Anda biasa membeli susu pertumbuhan untuk anak?',
    type: 'multiple_choice',
    options: ['Apotek', 'Minimarket', 'Supermarket', 'Toko online', 'Lainnya'],
  },
  {
    id: 'interest',
    text: 'Seberapa tertarik Anda mencoba Enfagrow A+ untuk anak?',
    type: 'multiple_choice',
    options: ['Sangat tertarik', 'Cukup tertarik', 'Belum yakin', 'Tidak tertarik'],
  },
  {
    id: 'other_notes',
    text: 'Apakah ada hal lain yang ingin Anda tanyakan seputar nutrisi anak? (opsional)',
    type: 'free_text',
  },
  {
    id: 'followup_channel',
    text: 'Bagaimana Anda ingin menerima info lanjutan (follow-up)?',
    type: 'multiple_choice',
    options: ['WhatsApp', 'Kunjungan langsung berikutnya', 'Tidak perlu follow-up'],
  },
];

/** Plain rule-based lookup — a consumer segment tag, not a medical assessment (PRD §6). */
function computeSegmentTag(answers: Record<string, string>): string {
  const currentMilk = answers['milk_current'];
  const interest = answers['interest'];
  if (currentMilk === 'Enfagrow A+') return 'Existing User';
  if (interest === 'Sangat tertarik' || interest === 'Cukup tertarik') return 'Hot Lead - Siap Konversi';
  if (currentMilk === 'ASI Eksklusif') return 'ASI Eksklusif - Nurture';
  if (interest === 'Belum yakin') return 'Warm Lead - Perlu Edukasi';
  return 'Cold Lead';
}

type Step = 'consent' | 'age' | 'under1' | 'done_under1' | 'done' | number;

export default function NutritionQuizScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const consumerId: string = route.params?.consumerId;
  const visitId: string = route.params?.visitId;

  const consumers = useStore((s) => s.consumers);
  const surveys = useStore((s) => s.surveys);
  const upsertConsumer = useStore((s) => s.upsertConsumer);
  const upsertNtgGwp = useStore((s) => s.upsertNtgGwp);
  const submitSurveyResponse = useStore((s) => s.submitSurveyResponse);

  const consumer = consumers.find((c) => c.id === consumerId);
  const quizSurvey = surveys.find((s) => s.id === NUTRITION_QUIZ_SURVEY_ID);

  const [step, setStep] = useState<Step>('consent');
  const [consent, setConsent] = useState(false);
  const [ageBracket, setAgeBracket] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [segmentTag, setSegmentTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!consumer) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>Data konsumen tidak ditemukan.</Muted>
      </View>
    );
  }

  if (!quizSurvey) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>
        <Ionicons name="alert-circle-outline" size={28} color={C.warn} />
        <Muted style={{ textAlign: 'center' }}>
          Quick Nutrition Check belum di-setup (survey seed belum dijalankan Data Analyst). Hubungi admin.
        </Muted>
      </View>
    );
  }

  const bracket = CHILD_AGE_BRACKETS.find((b) => b.key === ageBracket);

  const finishUnder1 = async () => {
    setBusy(true);
    try {
      const err = await submitSurveyResponse({
        id: uid('resp_'),
        surveyId: quizSurvey.id,
        visitId,
        consumerId,
        answers: { age_bracket: ageBracket ?? '' },
        createdAt: Date.now(),
      });
      if (err) return;
      await upsertConsumer({ ...consumer, childAgeBracket: ageBracket ?? consumer.childAgeBracket });
      // Deliberately NOT calling upsertNtgGwp here — under-1-year branch must
      // not advance the funnel stage or trigger any NC follow-up (PRD §6).
      setStep('done_under1');
    } finally {
      setBusy(false);
    }
  };

  const finishQuiz = async () => {
    setBusy(true);
    try {
      const tag = computeSegmentTag(answers);
      const err = await submitSurveyResponse({
        id: uid('resp_'),
        surveyId: quizSurvey.id,
        visitId,
        consumerId,
        answers: { age_bracket: ageBracket ?? '', ...answers },
        createdAt: Date.now(),
      });
      if (err) return;
      const cErr = await upsertConsumer({
        ...consumer,
        childAgeBracket: ageBracket ?? consumer.childAgeBracket,
        quizResult: tag,
      });
      if (cErr) return;
      setSegmentTag(tag);
      setStep('done');
    } finally {
      setBusy(false);
    }
  };

  const markQuizCompleted = async () => {
    setBusy(true);
    try {
      const err = await upsertNtgGwp({
        id: uid('ntg_'),
        consumerId,
        visitId,
        stage: 'quiz_completed',
        createdAt: Date.now(),
      });
      if (err) return;
      showDialog('Tahap NTG & GWP Diperbarui', 'Tahap funnel konsumen ini sekarang "Nutrition Quiz Selesai".', [
        { label: 'OK', onPress: () => navigation.goBack() },
      ]);
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
        <SectionHeader title="Quick Nutrition Check" subtitle={`Untuk ${consumer.name} (PRD §6)`} />

        {step === 'consent' && (
          <Card>
            <TouchableOpacity
              onPress={() => setConsent((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consent }}
            >
              <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={24} color={consent ? C.primaryDark : C.faint} />
              <Text style={{ flex: 1, fontFamily: F.semi, fontSize: 13, color: C.text }}>
                Saya (orang tua/wali) bersedia menjawab beberapa pertanyaan singkat seputar nutrisi anak. Jawaban tidak
                mencakup data berat/tinggi/tanggal lahir anak dan bukan merupakan diagnosis medis.
              </Text>
            </TouchableOpacity>
            <View style={{ marginTop: 14 }}>
              <Btn title="Mulai Quiz" onPress={() => setStep('age')} disabled={!consent} />
            </View>
          </Card>
        )}

        {step === 'age' && (
          <Card>
            <H>Usia Anak</H>
            <Muted style={{ marginTop: 2 }}>Bracket usia saja — bukan tanggal lahir (PRD §6).</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {CHILD_AGE_BRACKETS.map((b) => (
                <Chip key={b.key} label={b.label} active={ageBracket === b.key} onPress={() => setAgeBracket(b.key)} />
              ))}
            </View>
            <View style={{ marginTop: 14 }}>
              <Btn
                title="Lanjut"
                disabled={!bracket}
                onPress={() => setStep(bracket?.under1 ? 'under1' : 0)}
              />
            </View>
          </Card>
        )}

        {step === 'under1' && (
          <Card>
            <Badge label="Usia di bawah 1 tahun" color={C.info} />
            <H style={{ marginTop: 10 }}>ASI / MPASI</H>
            <Muted style={{ marginTop: 6 }}>
              Untuk usia di bawah 1 tahun, rekomendasi nutrisi terbaik adalah ASI eksklusif (0-6 bulan) atau MPASI sesuai
              anjuran dokter/ahli gizi (6-12 bulan). Kami tidak memberikan rekomendasi produk susu pertumbuhan untuk
              kelompok usia ini, dan sesi ini tidak akan memicu follow-up penjualan.
            </Muted>
            <View style={{ marginTop: 14 }}>
              <Btn title="Selesai" onPress={finishUnder1} disabled={busy} loading={busy} />
            </View>
          </Card>
        )}

        {typeof step === 'number' && (
          <Card>
            <Muted>{`Pertanyaan ${step + 1} dari ${QUIZ_QUESTIONS.length}`}</Muted>
            <H style={{ marginTop: 4 }}>{QUIZ_QUESTIONS[step].text}</H>
            <View style={{ marginTop: 10 }}>
              {QUIZ_QUESTIONS[step].type === 'multiple_choice' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(QUIZ_QUESTIONS[step].options ?? []).map((opt) => (
                    <Chip
                      key={opt}
                      label={opt}
                      active={answers[QUIZ_QUESTIONS[step].id] === opt}
                      onPress={() => setAnswers((a) => ({ ...a, [QUIZ_QUESTIONS[step].id]: opt }))}
                    />
                  ))}
                </View>
              ) : (
                <Field label="Jawaban (opsional)">
                  <Input
                    value={answers[QUIZ_QUESTIONS[step].id] ?? ''}
                    onChangeText={(v) => setAnswers((a) => ({ ...a, [QUIZ_QUESTIONS[step].id]: v }))}
                    multiline
                    placeholder="Ketik jawaban..."
                  />
                </Field>
              )}
            </View>
            <View style={{ marginTop: 14 }}>
              <Btn
                title={step === QUIZ_QUESTIONS.length - 1 ? 'Selesai' : 'Lanjut'}
                disabled={
                  busy ||
                  (QUIZ_QUESTIONS[step].type === 'multiple_choice' && !answers[QUIZ_QUESTIONS[step].id])
                }
                loading={busy}
                onPress={() => (step === QUIZ_QUESTIONS.length - 1 ? finishQuiz() : setStep(step + 1))}
              />
            </View>
          </Card>
        )}

        {step === 'done_under1' && (
          <Card>
            <Ionicons name="checkmark-circle" size={28} color={C.ok} />
            <H style={{ marginTop: 8 }}>Terima Kasih</H>
            <Muted style={{ marginTop: 4 }}>Jawaban tersimpan.</Muted>
            <View style={{ marginTop: 14 }}>
              <Btn variant="outline" title="Tutup" onPress={() => navigation.goBack()} />
            </View>
          </Card>
        )}

        {step === 'done' && (
          <Card>
            <Ionicons name="checkmark-circle" size={28} color={C.ok} />
            <H style={{ marginTop: 8 }}>Quiz Selesai</H>
            <Muted style={{ marginTop: 4 }}>Segmen konsumen (bukan diagnosis medis):</Muted>
            <View style={{ marginTop: 8 }}>
              <Badge label={segmentTag ?? '-'} color={C.teal} />
            </View>
            <View style={{ marginTop: 14, gap: 8 }}>
              <Btn
                title='Tandai NTG & GWP: "Nutrition Quiz Selesai"'
                onPress={markQuizCompleted}
                disabled={busy}
                loading={busy}
              />
              <Btn variant="outline" title="Tutup Tanpa Update Tahap" onPress={() => navigation.goBack()} />
            </View>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
