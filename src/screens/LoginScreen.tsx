import React, { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Btn, Card, Field, Input, Muted } from '../components/ui';
import { announce } from '../components/dialog';
import { APP_NAME } from '../config';
import { C, F, T } from '../theme';
import { useBreakpoint } from '../utils/responsive';
import { useStore } from '../store/useStore';

const DEMO_ACCOUNTS = [
  { role: 'Super Admin', u: 'superadmin', p: 'super123' },
  { role: 'Reckitt (Client, Read-only)', u: 'reckitt', p: 'reckitt123' },
  { role: 'Project Manager', u: 'pm', p: 'pm12345' },
  { role: 'Area Coordinator', u: 'arco.jkt', p: 'arco1234' },
  { role: 'Team Leader', u: 'tl.jaksel', p: 'tl123456' },
  { role: 'Nutrition Consultant', u: 'nc.budi', p: 'nc123456' },
];

function BrandPane() {
  return (
    <View style={{ alignItems: 'center', gap: 14 }}>
      <View style={styles.brandMark}>
        <Ionicons name="nutrition-outline" size={38} color={C.onGold} />
      </View>
      <Text style={styles.brandTitle}>{APP_NAME}</Text>
      <Text style={styles.brandSub}>Enfagrow A+ Nutrition Consultant Service Provider</Text>
      <View style={styles.trustRow}>
        <TrustPoint icon="shield-checkmark-outline" label="Geo-fence & audit trail" />
        <TrustPoint icon="analytics-outline" label="Skorkartu KPI real-time" />
        <TrustPoint icon="cloud-offline-outline" label="Offline-first di lapangan" />
      </View>
    </View>
  );
}

function TrustPoint({ icon, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name={icon} size={15} color={C.gold} />
      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontFamily: F.reg }}>{label}</Text>
    </View>
  );
}

export default function LoginScreen() {
  const login = useStore((s) => s.login);
  const { isDesktop } = useBreakpoint();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const error = await login(username, password);
    setErr(error);
    setBusy(false);
    if (error) announce(error);
  };

  const quick = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setErr(null);
    setShowDemo(true);
  };

  const toggleColor = isDesktop ? C.muted : 'rgba(255,255,255,0.8)';

  const formPane = (
    <View style={{ width: '100%', maxWidth: 380 }}>
      <Card>
        <Field label="Username">
          <Input
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="username"
            autoComplete="username"
            aria-label="Username"
            aria-invalid={!!err}
            aria-describedby={err ? 'login-error' : undefined}
          />
        </Field>
        <Field label="Password">
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••"
            autoComplete="current-password"
            aria-label="Password"
            aria-invalid={!!err}
            aria-describedby={err ? 'login-error' : undefined}
          />
        </Field>
        {err ? (
          <Text id="login-error" style={{ color: C.accent, fontSize: 12.5, fontFamily: F.semi }}>
            {err}
          </Text>
        ) : null}
        <Btn title="Masuk" onPress={submit} loading={busy} disabled={busy} />
      </Card>

      <TouchableOpacity
        onPress={() => setShowDemo((v) => !v)}
        activeOpacity={0.7}
        style={styles.demoToggle}
      >
        <Ionicons name="flask-outline" size={14} color={toggleColor} />
        <Text style={[styles.demoToggleText, { color: toggleColor }]}>
          {showDemo ? 'Sembunyikan akun demo' : 'Lingkungan Demo — lihat akun contoh'}
        </Text>
        <Ionicons name={showDemo ? 'chevron-up' : 'chevron-down'} size={14} color={toggleColor} />
      </TouchableOpacity>

      {showDemo && (
        <Card style={{ marginTop: 10 }}>
          <Muted>Ketuk salah satu peran untuk isi otomatis (hanya tersedia setelah `npm run seed:supabase`):</Muted>
          <View style={{ gap: 8, marginTop: 10 }}>
            {DEMO_ACCOUNTS.map((a) => (
              <Btn key={a.u} small variant="outline" title={`${a.role} · ${a.u}`} onPress={() => quick(a.u, a.p)} />
            ))}
          </View>
        </Card>
      )}

      <Text style={[styles.footer, { color: toggleColor }]}>© 2026 SPC Group · NC Workforce — Reckitt/Mead Johnson</Text>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
        <View style={[styles.desktopBrandPane]}>
          <BrandPane />
        </View>
        <ScrollView tabIndex={0} role="main" contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          {formPane}
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.railBg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ marginBottom: 28 }}>
          <BrandPane />
        </View>
        {formPane}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  desktopBrandPane: {
    flex: 1,
    maxWidth: 520,
    backgroundColor: C.railBg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  brandMark: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: C.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    ...T.display,
    color: '#FFFFFF',
  },
  brandSub: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: F.reg,
  },
  trustRow: {
    marginTop: 10,
    gap: 8,
    alignSelf: 'stretch',
    paddingHorizontal: 8,
  },
  demoToggle: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  demoToggleText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontFamily: F.semi,
  },
  footer: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 18,
    fontFamily: F.reg,
  },
});
