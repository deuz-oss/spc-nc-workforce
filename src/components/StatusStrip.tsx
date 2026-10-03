import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { C, SP, T, TOUCH } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDateTime, fmtDurShort } from '../utils/format';
import { Role } from '../types';
import { useNow } from './useNow';
import { useOnline } from './useOnline';

const FIELD_ROLES: Role[] = ['nc', 'tl', 'arco'];

function Item({ icon, label, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.xs }}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={T.status} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Always-visible field status under every header (tabs and pushed screens):
 * clock-in state, the store checked into, online/offline, and how much is
 * still waiting to reach the server. Tapping it opens the active visit (or the
 * attendance tab). Office roles only see it when offline or with unsent data.
 */
export function StatusStrip() {
  const me = useCurrentUser();
  const navigation = useNavigation();
  const pendingCount = useStore((s) => s.pendingOps.length);
  const snapshotAt = useStore((s) => s.offlineSnapshotAt);
  const attendances = useStore((s) => s.attendances);
  const visits = useStore((s) => s.visits);
  const stores = useStore((s) => s.stores);

  const field = !!me && FIELD_ROLES.includes(me.role);
  const active = me ? attendances.find((a) => a.userId === me.id && !a.clockOutAt) : undefined;
  const openVisit = me ? visits.find((v) => v.ncId === me.id && !v.checkOutAt) : undefined;
  const now = useNow(30000);
  const offline = !useOnline();

  if (!me || (!field && !offline && pendingCount === 0)) return null;

  // `now` ticks every 30 s, so right after clock-in it can be older than clockInAt.
  const worked = active ? fmtDurShort(Math.max(0, now - active.clockInAt)) : '';
  const storeName = openVisit ? (stores.find((s) => s.id === openVisit.storeId)?.name ?? 'toko') : null;
  const parts: string[] = [];
  if (field) parts.push(active ? `Sedang bekerja ${worked}` : 'Belum clock in');
  if (storeName) parts.push(`Check-in di ${storeName}`);
  parts.push(offline ? 'Offline' : 'Online');
  if (pendingCount) parts.push(`${pendingCount} data menunggu dikirim`);

  const onPress = openVisit
    ? () => navigation.navigate('StoreVisit', { visitId: openVisit.id })
    : field
      ? () => navigation.navigate('Main', { screen: me.role === 'nc' ? 'Absensi' : 'Dashboard' })
      : undefined;
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Status: ${parts.join(', ')}`}
      accessibilityHint={openVisit ? 'Buka kunjungan aktif' : undefined}
      role="status"
      style={{
        minHeight: TOUCH,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP.sm,
        paddingHorizontal: SP.lg,
        paddingVertical: SP.sm,
        backgroundColor: offline ? C.warnBg : C.surfaceAlt,
        borderBottomWidth: 1,
        borderColor: offline ? C.warnBorder : C.border,
      }}
    >
      {/* Items wrap among themselves; the chevron stays at the right edge. */}
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: SP.lg, rowGap: SP.xs }}>
      {field && (
        <Item
          icon={active ? 'time' : 'time-outline'}
          label={active ? `Bekerja ${worked}` : 'Belum clock in'}
          color={active ? C.okStrong : C.muted}
        />
      )}
      {storeName && <Item icon="storefront" label={storeName} color={C.infoStrong} />}
      <Item
        icon={offline ? 'cloud-offline' : 'cloud-done-outline'}
        label={offline ? (snapshotAt != null ? `Offline · data per ${fmtDateTime(snapshotAt)}` : 'Offline') : 'Online'}
        color={offline ? C.warnStrong : C.okStrong}
      />
      {pendingCount > 0 && <Item icon="sync" label={`${pendingCount} menunggu dikirim`} color={C.warnStrong} />}
      </View>
      {openVisit && <Ionicons name="chevron-forward" size={18} color={C.muted} />}
    </Wrapper>
  );
}
