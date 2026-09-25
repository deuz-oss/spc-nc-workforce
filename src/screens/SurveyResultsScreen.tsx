import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Card, Empty, H, Muted, SectionHeader, StatCard } from '../components/ui';
import { HistoryNotice } from '../components/HistoryNotice';
import { C, F } from '../theme';
import { useStore } from '../store/useStore';
import { toCsv } from '../utils/csv';
import { exportCsv } from '../utils/export';
import { fmtDateTime } from '../utils/format';
import { summarizeSurvey, surveyCsvRows } from '../utils/survey';

/**
 * Survey results (PRD §5.7) for Data Analyst / Super Admin: per-question
 * answer distribution, free-text answers, and a CSV export of every response.
 * Before this screen, answers were only readable straight from the database.
 * Responses are field activity, so only the login history window is loaded —
 * HistoryNotice offers the rest.
 */
export default function SurveyResultsScreen() {
  const route = useRoute<any>();
  const surveyId: string = route.params?.surveyId;
  const survey = useStore((s) => s.surveys.find((x) => x.id === surveyId));
  const responses = useStore((s) => s.surveyResponses);
  const visits = useStore((s) => s.visits);
  const users = useStore((s) => s.users);
  const stores = useStore((s) => s.stores);

  const mine = useMemo(() => responses.filter((r) => r.surveyId === surveyId), [responses, surveyId]);
  const summary = useMemo(() => (survey ? summarizeSurvey(survey, mine) : []), [survey, mine]);

  if (!survey) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>Survey tidak ditemukan.</Muted>
      </View>
    );
  }

  const context = (visitId: string | null) => {
    const v = visitId ? visits.find((x) => x.id === visitId) : undefined;
    return {
      nc: v ? (users.find((u) => u.id === v.ncId)?.name ?? '') : '',
      store: v ? (stores.find((s) => s.id === v.storeId)?.name ?? '') : '',
    };
  };

  const doExport = () =>
    exportCsv(`survey_${survey.title}`, toCsv(surveyCsvRows(survey, mine, (r) => context(r.visitId))));

  const latest = mine.reduce<number | null>((m, r) => (m == null || r.createdAt > m ? r.createdAt : m), null);

  return (
    <ScrollView
      tabIndex={0}
      role="main"
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader
        title={survey.title}
        subtitle={survey.campaignTag ? `Hasil survey · ${survey.campaignTag}` : 'Hasil survey'}
        action={mine.length ? { label: 'Ekspor CSV', onPress: doExport } : undefined}
      />
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <StatCard title="Jumlah Respons" value={String(mine.length)} />
        <StatCard title="Respons Terakhir" value={latest ? fmtDateTime(latest) : '-'} />
      </View>
      <HistoryNotice />

      {mine.length === 0 ? (
        <Card>
          <Empty text="Belum ada jawaban untuk survey ini." />
        </Card>
      ) : (
        summary.map((q, i) => (
          <Card key={q.questionId} style={{ gap: 8 }}>
            <H>{`${i + 1}. ${q.text}`}</H>
            <Muted>{q.answered} menjawab</Muted>
            {q.kind === 'choice' ? (
              q.options.map((o) => (
                <View key={o.option} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.text, flexShrink: 1 }}>{o.option}</Text>
                    <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.muted }}>
                      {o.count} · {o.pct}%
                    </Text>
                  </View>
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: C.divider, overflow: 'hidden' }}>
                    <View style={{ width: `${o.pct}%`, height: '100%', backgroundColor: C.primary }} />
                  </View>
                </View>
              ))
            ) : q.answers.length === 0 ? (
              <Muted>Belum ada jawaban.</Muted>
            ) : (
              <View style={{ gap: 6 }}>
                {q.answers.slice(0, 50).map((a) => (
                  <View key={a.responseId} style={{ borderLeftWidth: 3, borderColor: C.border, paddingLeft: 8 }}>
                    <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.text }}>{a.answer}</Text>
                    <Muted>{fmtDateTime(a.createdAt)}</Muted>
                  </View>
                ))}
                {q.answers.length > 50 && <Muted>...dan {q.answers.length - 50} jawaban lain (lihat Ekspor CSV).</Muted>}
              </View>
            )}
          </Card>
        ))
      )}
    </ScrollView>
  );
}
