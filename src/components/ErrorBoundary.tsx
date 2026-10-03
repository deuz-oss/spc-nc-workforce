import React from 'react';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Btn } from './ui';
import { C, F, T } from '../theme';
import { reportError } from '../utils/errorReport';

/**
 * Catches a render crash anywhere below it, reports it (client_errors), and
 * shows a recovery screen instead of a blank app. Queued offline work is
 * unaffected — it lives in storage, not in the crashed component tree.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, `render${info.componentStack ? `: ${info.componentStack.trim().split('\n')[0]}` : ''}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: C.bg }}>
        <Ionicons name="alert-circle-outline" size={36} color={C.warn} />
        <Text style={[T.h2, { textAlign: 'center' }]}>Terjadi kesalahan pada aplikasi</Text>
        <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.muted, textAlign: 'center', maxWidth: 340 }}>
          Kesalahan ini sudah dicatat. Data yang tersimpan offline tetap aman dan akan dikirim saat tersinkron.
        </Text>
        <Btn title="Coba Lagi" onPress={() => this.setState({ error: null })} />
      </View>
    );
  }
}
