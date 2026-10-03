import React from 'react';
import { ActivityIndicator, Platform, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabBarProps, BottomTabHeaderProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Header, getHeaderTitle } from '@react-navigation/elements';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_NAME, ROLE_LABEL } from './src/config';
import { C, F, T } from './src/theme';
import { useBreakpoint } from './src/utils/responsive';
import { DialogHost } from './src/components/dialog';
import { useCurrentUser, useStore } from './src/store/useStore';
import { Role, User } from './src/types';
import { fmtDateTime } from './src/utils/format';

import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StoresScreen from './src/screens/StoresScreen';
import StoreDetailScreen from './src/screens/StoreDetailScreen';
import StoreVisitScreen from './src/screens/StoreVisitScreen';
import ImportScreen from './src/screens/ImportScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import UsersScreen from './src/screens/UsersScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import StockTakingScreen from './src/screens/StockTakingScreen';
import OfftakeScreen from './src/screens/OfftakeScreen';
import ConsumersScreen from './src/screens/ConsumersScreen';
import ConsumerDetailScreen from './src/screens/ConsumerDetailScreen';
import ShareOfShelfScreen from './src/screens/ShareOfShelfScreen';
import PaidVisibilityScreen from './src/screens/PaidVisibilityScreen';
import PriceMonitoringScreen from './src/screens/PriceMonitoringScreen';
import SurveyListScreen from './src/screens/SurveyListScreen';
import SurveyRespondScreen from './src/screens/SurveyRespondScreen';
import SurveyBuilderScreen from './src/screens/SurveyBuilderScreen';
import SurveyResultsScreen from './src/screens/SurveyResultsScreen';
import NutritionQuizScreen from './src/screens/NutritionQuizScreen';
import ValidationQueueScreen from './src/screens/ValidationQueueScreen';
import CoachingLogScreen from './src/screens/CoachingLogScreen';
import NcTrackerScreen from './src/screens/NcTrackerScreen';
import ScorecardScreen from './src/screens/ScorecardScreen';
import TargetsScreen from './src/screens/TargetsScreen';
import CertificationsScreen from './src/screens/CertificationsScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatThreadScreen from './src/screens/ChatThreadScreen';
import AuditLogScreen from './src/screens/AuditLogScreen';
import PjpScreen from './src/screens/PjpScreen';
import { TrackingWatcher } from './src/components/TrackingWatcher';
import type { RootStackParamList } from './src/navigation';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { installGlobalErrorHandlers } from './src/utils/errorReport';

installGlobalErrorHandlers();

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator();

const TAB_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Dashboard: 'grid-outline',
  Toko: 'storefront-outline',
  Absensi: 'time-outline',
  Validasi: 'checkmark-done-outline',
  Chat: 'chatbubbles-outline',
  Pengguna: 'people-outline',
  Profil: 'person-circle-outline',
};

/**
 * Sync status strip under the tab header: shown while the app runs from the
 * on-device snapshot (cold start without a server connection — data may be
 * stale), and while writes are still waiting in the offline queue, so a field
 * user never mistakes "saved on this phone" for "reached the server".
 */
function SyncStatusBanner({ snapshotAt, pendingCount }: { snapshotAt: number | null; pendingCount: number }) {
  if (snapshotAt == null && pendingCount === 0) return null;
  const parts: string[] = [];
  if (snapshotAt != null) parts.push(`Mode offline — data tersimpan per ${fmtDateTime(snapshotAt)}`);
  if (pendingCount > 0) parts.push(`${pendingCount} data menunggu dikirim ke server`);
  return (
    <View
      role="status"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: C.warnBg,
        borderBottomWidth: 1,
        borderColor: C.border,
      }}
    >
      <Ionicons name="cloud-offline-outline" size={16} color={C.warn} />
      <Text style={{ flex: 1, color: C.text, fontFamily: F.semi, fontSize: 12 }}>
        {parts.join(' · ')}. Disinkron otomatis saat koneksi tersedia.
      </Text>
    </View>
  );
}

const RAIL_WIDTH = 232;
const COMPACT_RAIL_WIDTH = 76;

/** Kartu identitas ringkas di puncak rail penuh (desktop) — memberi konteks "siapa saya & di mana" */
function RailHeader({ me }: { me: User }) {
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 22, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: C.gold,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="nutrition" size={18} color={C.onGold} />
        </View>
        <Text style={{ color: C.onDark, fontFamily: F.xbold, fontSize: 15 }}>{APP_NAME}</Text>
      </View>
      <View style={{ marginTop: 18, borderTopWidth: 1, borderColor: C.darkDivider, paddingTop: 14 }}>
        <Text style={{ color: C.onDark, fontFamily: F.bold, fontSize: 13 }} numberOfLines={1}>
          {me.name}
        </Text>
        <Text style={{ color: C.onDarkFaint, fontFamily: F.reg, fontSize: 11.5, marginTop: 1 }}>
          {ROLE_LABEL[me.role]}
        </Text>
      </View>
    </View>
  );
}

/**
 * Tab bar responsif — 3 mode:
 * - mobile (<700dp): bottom tabs berlabel
 * - tablet (700-899dp): rail vertikal ringkas, ikon saja
 * - desktop (>=900dp): rail vertikal penuh berlabel + identitas pengguna
 */
function ResponsiveTabBar({
  state,
  navigation,
  isTablet,
  isDesktop,
  me,
}: BottomTabBarProps & { isTablet: boolean; isDesktop: boolean; me: User }) {
  const routes = state.routes;
  const insets = useSafeAreaInsets();

  if (!isTablet) {
    return (
      <View
        role="navigation"
        aria-label="Navigasi utama"
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderColor: C.border,
          backgroundColor: C.card,
          paddingTop: 6,
          // Clear the home indicator / gesture bar on edge-to-edge phones.
          paddingBottom: 8 + insets.bottom,
        }}
      >
        {routes.map((route, i) => {
          const focused = state.index === i;
          const color = focused ? C.primaryText : C.faint;
          return (
            <TouchableOpacity
              key={route.key}
              onPress={() => navigation.navigate(route.name)}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              style={{ flex: 1, alignItems: 'center', gap: 2, minHeight: 44, justifyContent: 'center' }}
            >
              <Ionicons name={TAB_ICON[route.name] ?? 'ellipse-outline'} size={21} color={color} />
              <Text style={{ fontSize: 10.5, fontFamily: F.semi, color }}>{route.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  if (!isDesktop) {
    return (
      <View
        role="navigation"
        aria-label="Navigasi utama"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: COMPACT_RAIL_WIDTH,
          backgroundColor: C.railBg,
          alignItems: 'center',
          paddingTop: 22,
          gap: 4,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: C.gold,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          <Ionicons name="nutrition" size={18} color={C.onGold} />
        </View>
        {routes.map((route, i) => {
          const focused = state.index === i;
          return (
            <TouchableOpacity
              key={route.key}
              onPress={() => navigation.navigate(route.name)}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              style={{
                width: 52,
                height: 44,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: focused ? C.darkActive : 'transparent',
                borderLeftWidth: 3,
                borderLeftColor: focused ? C.gold : 'transparent',
              }}
            >
              <Ionicons
                name={TAB_ICON[route.name] ?? 'ellipse-outline'}
                size={20}
                color={focused ? C.gold : C.onDarkMuted}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <View
      role="navigation"
      aria-label="Navigasi utama"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: RAIL_WIDTH,
        backgroundColor: C.railBg,
      }}
    >
      <RailHeader me={me} />
      <View style={{ paddingHorizontal: 12, gap: 2 }}>
        {routes.map((route, i) => {
          const focused = state.index === i;
          return (
            <TouchableOpacity
              key={route.key}
              onPress={() => navigation.navigate(route.name)}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 11,
                paddingHorizontal: 10,
                borderRadius: 10,
                backgroundColor: focused ? C.darkActive : 'transparent',
                borderLeftWidth: 3,
                borderLeftColor: focused ? C.gold : 'transparent',
              }}
            >
              <Ionicons
                name={TAB_ICON[route.name] ?? 'ellipse-outline'}
                size={19}
                color={focused ? C.gold : C.onDarkMuted}
              />
              <Text
                style={{
                  fontSize: 13.5,
                  fontFamily: focused ? F.bold : F.semi,
                  color: focused ? C.onDark : C.onDarkMuted,
                }}
              >
                {route.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Per-role tab set (PRD §2); every other screen is pushed on the stack. */
function tabsForRole(role: Role): string[] {
  switch (role) {
    case 'nc':
      return ['Dashboard', 'Toko', 'Absensi', 'Chat', 'Profil'];
    case 'tl':
    case 'arco':
      return ['Dashboard', 'Toko', 'Validasi', 'Chat', 'Profil'];
    case 'super_admin':
      return ['Dashboard', 'Toko', 'Pengguna', 'Profil'];
    case 'admin_data_entry':
      // Account provisioning is Super Admin-only per PRD §2 — Admin Data Entry
      // gets store master data (CSV import/bulk assignment) but not accounts.
      return ['Dashboard', 'Toko', 'Profil'];
    case 'pm':
    case 'data_analyst':
    case 'lead_trainer':
    case 'trainer':
    case 'reckitt_client':
    default:
      return ['Dashboard', 'Profil'];
  }
}

function screenFor(name: string) {
  switch (name) {
    case 'Dashboard':
      return DashboardScreen;
    case 'Toko':
      return StoresScreen;
    case 'Absensi':
      return AttendanceScreen;
    case 'Pengguna':
      return UsersScreen;
    case 'Validasi':
      return ValidationQueueScreen;
    case 'Chat':
      return ChatListScreen;
    default:
      return ProfileScreen;
  }
}

function MainTabs({ role, me }: { role: Role; me: User }) {
  const { isTablet, isDesktop } = useBreakpoint();
  const railWidth = isDesktop ? RAIL_WIDTH : isTablet ? COMPACT_RAIL_WIDTH : 0;
  const tabs = tabsForRole(role);
  const offlineSnapshotAt = useStore((s) => s.offlineSnapshotAt);
  const pendingCount = useStore((s) => s.pendingOps.length);

  return (
    <Tabs.Navigator
      tabBar={(props) => <ResponsiveTabBar {...props} isTablet={isTablet} isDesktop={isDesktop} me={me} />}
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: C.railBg, shadowOpacity: 0, borderBottomWidth: 0 },
        headerTintColor: C.onDark,
        headerTitleStyle: { fontFamily: F.bold, fontSize: 17 },
        headerShadowVisible: false,
        sceneStyle: railWidth ? { marginLeft: railWidth } : undefined,
        header: ({ layout, options, route: r }: BottomTabHeaderProps) => (
          <View role="banner">
            <Header {...options} layout={layout} title={getHeaderTitle(options, r.name)} />
            <SyncStatusBanner snapshotAt={offlineSnapshotAt} pendingCount={pendingCount} />
          </View>
        ),
        headerRight: () => (
          <View
            style={{
              marginRight: 16,
              maxWidth: 170,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: C.darkChip,
            }}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: C.onDark, fontFamily: F.semi, fontSize: 11.5 }}
            >
              {ROLE_LABEL[role]}
            </Text>
          </View>
        ),
        tabBarIcon: ({ color, size }) =>
          <Ionicons name={TAB_ICON[route.name] ?? 'ellipse-outline'} color={color} size={size} />,
      })}
    >
      {tabs.map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          component={screenFor(name)}
        />
      ))}
    </Tabs.Navigator>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const user = useCurrentUser();
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  React.useEffect(() => {
    useStore.getState().init();
  }, []);

  React.useEffect(() => {
    // @react-navigation/elements sets aria-hidden="true" on inactive tab
    // screens (correctly shielding screen readers) but never pairs it with
    // `inert`, so those screens' controls stay reachable by Tab even though
    // they're invisible. Keep `inert` in sync with aria-hidden ourselves —
    // web only, harmless no-op on native since aria-hidden/inert don't exist there.
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const sync = () => {
      document.querySelectorAll('[aria-hidden="true"]:not([inert])').forEach((el) => el.setAttribute('inert', ''));
      document.querySelectorAll('[inert]').forEach((el) => {
        if (el.getAttribute('aria-hidden') !== 'true') el.removeAttribute('inert');
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['aria-hidden'], subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!ready || !fontsLoaded)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            backgroundColor: C.gold,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="nutrition" size={34} color={C.onGold} />
        </View>
        <Text style={[T.h1, { marginTop: 16 }]}>{APP_NAME}</Text>
        <ActivityIndicator style={{ marginTop: 14 }} color={C.primaryDark} aria-label="Memuat aplikasi" />
      </View>
    );

  const navTheme = {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, primary: C.primaryDark, background: C.bg, card: C.card },
  };

  const stackOpts = {
    headerStyle: { backgroundColor: C.railBg, shadowOpacity: 0, borderBottomWidth: 0 },
    headerTintColor: C.onDark,
    headerTitleStyle: { fontFamily: F.bold, fontSize: 17 },
    headerShadowVisible: false,
  };

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          {!user ? (
            <Stack.Navigator screenOptions={stackOpts}>
              <Stack.Screen
                name="Login"
                component={LoginScreen}
                options={{ title: APP_NAME, headerShown: false }}
              />
            </Stack.Navigator>
          ) : (
            <Stack.Navigator screenOptions={stackOpts}>
              <Stack.Screen name="Main" options={{ headerShown: false }}>
                {() => <MainTabs role={user.role} me={user} />}
              </Stack.Screen>
              <Stack.Screen
                name="StoreDetail"
                component={StoreDetailScreen}
                options={{ title: 'Detail Toko' }}
              />
              <Stack.Screen
                name="Import"
                component={ImportScreen}
                options={{ title: 'Impor Data' }}
              />
              <Stack.Screen
                name="StoreVisit"
                component={StoreVisitScreen}
                options={{ title: 'Kunjungan Toko', headerBackTitle: 'Tutup' }}
              />
              <Stack.Screen name="StockTaking" component={StockTakingScreen} options={{ title: 'Stock Taking' }} />
              <Stack.Screen name="Offtake" component={OfftakeScreen} options={{ title: 'Offtake' }} />
              <Stack.Screen name="Consumers" component={ConsumersScreen} options={{ title: 'Konsumen NTG & GWP' }} />
              <Stack.Screen
                name="ConsumerDetail"
                component={ConsumerDetailScreen}
                options={{ title: 'Detail Konsumen' }}
              />
              <Stack.Screen name="NutritionQuiz" component={NutritionQuizScreen} options={{ title: 'Quick Nutrition Check' }} />
              <Stack.Screen name="ShareOfShelf" component={ShareOfShelfScreen} options={{ title: 'Share of Shelf' }} />
              <Stack.Screen name="PaidVisibility" component={PaidVisibilityScreen} options={{ title: 'Paid Visibility' }} />
              <Stack.Screen name="PriceMonitoring" component={PriceMonitoringScreen} options={{ title: 'Price Monitoring' }} />
              <Stack.Screen name="SurveyList" component={SurveyListScreen} options={{ title: 'Survey' }} />
              <Stack.Screen name="SurveyRespond" component={SurveyRespondScreen} options={{ title: 'Isi Survey' }} />
              <Stack.Screen name="SurveyBuilder" component={SurveyBuilderScreen} options={{ title: 'Kelola Survey' }} />
              <Stack.Screen name="SurveyResults" component={SurveyResultsScreen} options={{ title: 'Hasil Survey' }} />
              <Stack.Screen name="CoachingLog" component={CoachingLogScreen} options={{ title: 'Coaching Log' }} />
              <Stack.Screen name="NcTracker" component={NcTrackerScreen} options={{ title: 'NC Tracker' }} />
              <Stack.Screen name="Scorecard" component={ScorecardScreen} options={{ title: 'Skorkartu' }} />
              <Stack.Screen name="Targets" component={TargetsScreen} options={{ title: 'Target Bulanan' }} />
              <Stack.Screen name="Certifications" component={CertificationsScreen} options={{ title: 'Sertifikasi' }} />
              <Stack.Screen name="Products" component={ProductsScreen} options={{ title: 'Master Produk' }} />
              <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: 'Log Aktivitas' }} />
            <Stack.Screen name="Pjp" component={PjpScreen} options={{ title: 'Jadwal Kunjungan' }} />
              <Stack.Screen
                name="ChatThread"
                component={ChatThreadScreen}
                options={({ route }) => ({ title: route.params.counterpartName || 'Pesan' })}
              />
            </Stack.Navigator>
          )}
          <DialogHost />
          <TrackingWatcher />
        </NavigationContainer>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

