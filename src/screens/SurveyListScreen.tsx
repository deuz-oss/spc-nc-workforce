import React, { useMemo } from 'react';
import { FlatList, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Empty, ListRow, SectionHeader } from '../components/ui';
import { NUTRITION_QUIZ_CAMPAIGN_TAG } from '../config';
import { useStore } from '../store/useStore';

/** Survey (PRD §5.7) — generic, ad hoc/campaign-driven question sets, tied to
 * the active visit like every other report module (PRD §5's "tied to an
 * active store check-in"). The Nutrition Quiz (§6) is a separate, dedicated
 * flow (NutritionQuizScreen) reached from a consumer's funnel, not this list. */
export default function SurveyListScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const allSurveys = useStore((s) => s.surveys);
  // The Nutrition Quiz's backing row has no questions (its flow lives in
  // NutritionQuizScreen) — listed here it would be an unsubmittable empty form.
  const surveys = useMemo(
    () => allSurveys.filter((s) => s.campaignTag !== NUTRITION_QUIZ_CAMPAIGN_TAG && s.questions.length > 0),
    [allSurveys],
  );

  return (
    <View role="main" style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 10 }}>
        <SectionHeader title={`Survey Tersedia (${surveys.length})`} subtitle="Ad hoc / campaign-driven (PRD §5.7)" />
      </View>
      <FlatList
        data={surveys}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}
        ListEmptyComponent={<Empty text="Belum ada survey yang dibuat Data Analyst." />}
        renderItem={({ item: s }) => (
          <ListRow
            onPress={() => navigation.navigate('SurveyRespond', { surveyId: s.id, visitId, storeId })}
            title={s.title}
            subtitle={`${s.questions.length} pertanyaan${s.campaignTag ? ` · ${s.campaignTag}` : ''}`}
          />
        )}
      />
    </View>
  );
}
