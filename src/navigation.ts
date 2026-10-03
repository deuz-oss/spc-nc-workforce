/**
 * Every route the app can navigate to, with its params. Registered globally
 * (ReactNavigation.RootParamList below), so plain `useNavigation()` /
 * `navigation.navigate(...)` are type-checked everywhere, and screens read
 * their params through `useAppRoute<'Name'>()`.
 */
import { NavigatorScreenParams, RouteProp, useRoute } from '@react-navigation/native';

/** A report form opened from a store visit. */
type VisitReportParams = { visitId: string; storeId: string };

export type TabParamList = {
  Dashboard: undefined;
  Toko: undefined;
  Absensi: undefined;
  Validasi: undefined;
  Chat: undefined;
  Pengguna: undefined;
  Profil: undefined;
};

export type RootStackParamList = {
  // Signed-out stack
  Login: undefined;
  // Tabs, nested in Main. From a pushed (stack) screen go through Main —
  // navigate('Main', { screen: 'Dashboard' }); a bare tab name is only
  // handled from inside the tabs (React Navigation 7).
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Dashboard: undefined;
  Toko: undefined;
  Absensi: undefined;
  Validasi: undefined;
  Chat: undefined;
  Pengguna: undefined;
  Profil: undefined;
  // Stack screens
  StoreDetail: { storeId: string };
  /** Opens on that import tab (default: stores). */
  Import: { mode?: 'stores' | 'users' | 'products' | 'pjp' } | undefined;
  StoreVisit: { visitId: string };
  StockTaking: VisitReportParams;
  Offtake: VisitReportParams;
  ShareOfShelf: VisitReportParams;
  PaidVisibility: VisitReportParams;
  PriceMonitoring: VisitReportParams;
  Consumers: VisitReportParams;
  ConsumerDetail: { consumerId?: string; visitId?: string; storeId?: string };
  NutritionQuiz: { consumerId: string; visitId: string };
  SurveyList: VisitReportParams;
  SurveyRespond: { surveyId: string; visitId?: string; storeId?: string };
  SurveyBuilder: undefined;
  SurveyResults: { surveyId: string };
  CoachingLog: undefined;
  NcTracker: { ncId: string; attendanceId?: string };
  Scorecard: undefined;
  Targets: undefined;
  Certifications: undefined;
  Products: undefined;
  AuditLog: undefined;
  Pjp: { ncId?: string } | undefined;
  ChatThread: { conversationId: string; counterpartName?: string };
};

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

/** The current screen's route, with its params typed. */
export function useAppRoute<K extends keyof RootStackParamList>() {
  return useRoute<RouteProp<RootStackParamList, K>>();
}
