import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, ELEV, F, R, SP, T } from '../theme';

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View
      style={[
        {
          backgroundColor: C.card,
          borderRadius: R.card,
          padding: SP.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: C.border,
          ...ELEV[1],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function H({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[T.h2, style]}>{children}</Text>;
}

export function Muted({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: object;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[T.small, style]}>
      {children}
    </Text>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        // '08' (~3% alpha) keeps a visible tint while staying above the 4.5:1
        // AA contrast threshold for the text color placed on top of it.
        backgroundColor: color + '08',
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: '700', fontFamily: F.semi }}>{label}</Text>
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  color = C.primary,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const activeText = color === C.primary ? C.onPrimary : '#FFFFFF';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      style={{
        minHeight: 44, // WCAG 2.5.5 / platform touch-target minimum
        justifyContent: 'center',
        paddingHorizontal: 13,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? color : C.border,
        backgroundColor: active ? color : C.card,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: '600',
          fontFamily: F.semi,
          color: active ? activeText : C.text,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function Btn({
  title,
  onPress,
  variant = 'primary',
  disabled,
  small,
  loading,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'danger' | 'ok';
  disabled?: boolean;
  small?: boolean;
  loading?: boolean;
}) {
  const bg =
    variant === 'primary'
      ? C.primary
      : variant === 'danger'
      ? C.accent
      : variant === 'ok'
      ? C.ok
      : 'transparent';
  const fg = variant === 'outline' ? C.primaryText : variant === 'primary' ? C.onPrimary : '#FFFFFF';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      style={{
        backgroundColor: bg,
        borderWidth: variant === 'outline' ? 1.5 : 0,
        borderColor: C.primaryDark,
        opacity: disabled ? 0.45 : 1,
        borderRadius: R.btn,
        minHeight: small ? 38 : 48,
        paddingHorizontal: SP.lg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: SP.sm,
      }}
    >
      {loading && <ActivityIndicator size="small" color={fg} aria-label="Memproses" />}
      <Text
        style={{
          color: fg,
          fontWeight: '700',
          fontFamily: F.bold,
          fontSize: small ? 13 : 14.5,
          letterSpacing: 0.2,
        }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={C.faint}
      {...props}
      style={[
        {
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: R.input,
          paddingHorizontal: SP.md,
          paddingVertical: 12,
          fontSize: 14.5,
          color: C.text,
          fontFamily: F.reg,
        },
        props.style,
      ]}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={T.label}>{label}</Text>
      {children}
    </View>
  );
}

export function StatCard({
  title,
  value,
  sub,
  color = C.text,
}: {
  title: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Card style={{ flex: 1 }}>
      <Text style={T.caption}>{title}</Text>
      <Text style={[T.metric, { color, marginTop: 4 }]}>{value}</Text>
      {sub ? <Muted style={{ marginTop: 3 }}>{sub}</Muted> : null}
    </Card>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 32 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: C.border,
          marginBottom: 10,
        }}
      />
      <Text style={{ color: C.muted, fontSize: 13, fontFamily: F.reg }}>{text}</Text>
    </View>
  );
}

/** Header halaman: judul + subjudul + aksi opsional (dipakai di dalam ScrollView, bukan header navigasi) */
export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <View style={{ flexShrink: 1 }}>
        <Text style={T.h1}>{title}</Text>
        {subtitle ? <Muted style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
      </View>
      {action && (
        <TouchableOpacity onPress={action.onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ color: C.primaryText, fontFamily: F.bold, fontSize: 13 }}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Baris list generik: judul + subjudul + meta kanan-atas + trailing (badge/elemen bebas) */
export function ListRow({
  title,
  subtitle,
  meta,
  trailing,
  onPress,
  emphasis,
  numberOfLines = 1,
  selected,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  emphasis?: { color: string; label: string };
  numberOfLines?: number;
  selected?: boolean;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: selected !== undefined ? 'center' : undefined,
        backgroundColor: C.card,
        borderRadius: R.card,
        borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        borderColor: selected ? C.primaryDark : C.border,
        overflow: 'hidden',
      }}
    >
      {emphasis && <View style={{ width: 4, backgroundColor: emphasis.color }} />}
      {selected !== undefined && (
        <View style={{ paddingLeft: SP.md }}>
          <Ionicons
            name={selected ? 'checkbox' : 'square-outline'}
            size={22}
            color={selected ? C.primaryDark : C.faint}
          />
        </View>
      )}
      <View style={{ flex: 1, padding: SP.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={[T.h3, { flexShrink: 1 }]} numberOfLines={numberOfLines}>
            {title}
          </Text>
          {trailing}
        </View>
        {subtitle ? (
          <Muted style={{ marginTop: 2 }} numberOfLines={numberOfLines}>
            {subtitle}
          </Muted>
        ) : null}
        {(meta || emphasis) && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            {emphasis ? (
              <Text style={{ fontSize: 11, color: emphasis.color, fontFamily: F.semi }}>{emphasis.label}</Text>
            ) : (
              <View />
            )}
            {meta ? <Text style={{ fontSize: 11, color: C.muted, fontFamily: F.reg }}>{meta}</Text> : null}
          </View>
        )}
      </View>
    </Wrapper>
  );
}

/** Badge dgn ikon — status TIDAK hanya diwakili warna */
export function StatusBadge({
  label,
  color,
  icon,
}: {
  label: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: color + '08',
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Ionicons name={icon} size={11} color={color} />
      <Text style={{ color, fontSize: 11, fontWeight: '700', fontFamily: F.semi }}>{label}</Text>
    </View>
  );
}

/**
 * Badge ok/tidak-valid generik (geo-fence absensi, geo-valid kunjungan, dll).
 */
export function GeoValidBadge({
  ok,
  okLabel,
  badLabel,
}: {
  ok: boolean;
  okLabel: string;
  badLabel: string;
}) {
  return (
    <StatusBadge
      label={ok ? okLabel : badLabel}
      color={ok ? C.ok : C.accent}
      icon={ok ? 'checkmark-circle' : 'warning'}
    />
  );
}

/** Footer tombol yang menempel di bawah layar (CHECK IN / CHECK OUT dsb). */
export function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: C.card,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        alignItems: 'center',
      }}
    >
      <View style={{ padding: SP.lg, paddingTop: 10, gap: SP.sm, maxWidth: 900, width: '100%' }}>{children}</View>
    </View>
  );
}

/** Garis pemisah tipis — dipakai daripada tiap layar bikin View 1px sendiri. */
export function Divider({ style }: { style?: object }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }, style]} />;
}

/** Ikon dengan target tap yang konsisten — pembungkus tipis di atas Ionicons. */
export function IconButton({
  name,
  size = 20,
  color = C.text,
  onPress,
}: {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  color?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
    >
      <Ionicons name={name} size={size} color={color} />
    </TouchableOpacity>
  );
}

export type KPIStatus = 'ok' | 'warn' | 'danger' | 'neutral';

const KPI_STATUS: Record<KPIStatus, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  ok: { color: C.ok, icon: 'checkmark-circle', label: 'On Track' },
  warn: { color: C.warn, icon: 'alert-circle', label: 'Perlu Perhatian' },
  danger: { color: C.accent, icon: 'close-circle', label: 'Di Bawah Target' },
  neutral: { color: C.muted, icon: 'ellipse-outline', label: 'Belum Ada Data' },
};

/**
 * Kartu KPI enterprise: metric + target + variance + status + trend.
 * Status TIDAK hanya diwakili warna — selalu disertai ikon + label teks.
 */
export function KPICard({
  title,
  value,
  target,
  status = 'neutral',
  statusLabel,
  trend,
}: {
  title: string;
  value: string;
  target?: string;
  status?: KPIStatus;
  statusLabel?: string;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; good?: boolean };
}) {
  const st = KPI_STATUS[status];
  const trendIcon = trend?.direction === 'up' ? 'trending-up' : trend?.direction === 'down' ? 'trending-down' : 'remove';
  const trendColor = trend ? (trend.good === false ? C.accent : trend.good ? C.ok : C.muted) : C.muted;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 150,
        backgroundColor: C.card,
        borderRadius: R.card,
        padding: SP.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        borderTopWidth: 2.5,
        borderTopColor: st.color,
        ...ELEV[1],
      }}
    >
      <Text style={T.caption}>{title}</Text>
      <Text style={[T.metric, { marginTop: 4 }]}>{value}</Text>
      {target ? <Muted style={{ marginTop: 2 }}>{target}</Muted> : null}
      {trend && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 }}>
          <Ionicons name={trendIcon} size={13} color={trendColor} />
          <Text style={{ fontSize: 11, color: trendColor, fontFamily: F.semi }}>{trend.label}</Text>
        </View>
      )}
      {(status !== 'neutral' || statusLabel) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
          <Ionicons name={st.icon} size={13} color={st.color} />
          <Text style={{ fontSize: 11, color: st.color, fontFamily: F.semi }}>{statusLabel ?? st.label}</Text>
        </View>
      )}
    </View>
  );
}

/** Placeholder loading statis (tanpa animasi) utk skeleton kartu/list */
export function SkeletonBlock({ height = 16, width = '100%', style }: { height?: number; width?: number | string; style?: object }) {
  return (
    <View
      style={[{ height, width: width as any, borderRadius: 6, backgroundColor: C.divider }, style]}
    />
  );
}

export function LoadingCard() {
  return (
    <Card style={{ gap: 8 }}>
      <SkeletonBlock width="40%" height={11} />
      <SkeletonBlock width="60%" height={22} style={{ marginTop: 4 }} />
      <SkeletonBlock width="80%" height={12} style={{ marginTop: 4 }} />
    </Card>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
      <Ionicons name="warning-outline" size={22} color={C.accent} />
      <Text style={{ color: C.text, fontSize: 13, fontFamily: F.semi, textAlign: 'center' }}>{text}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry}>
          <Text style={{ color: C.primaryText, fontFamily: F.bold, fontSize: 13 }}>Coba lagi</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Placeholder kartu utk fitur yang belum diimplementasikan (Phase 2/3/4 — lihat README). */
export function ComingSoon({ title, phase, note }: { title: string; phase: string; note?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
      <Ionicons name="construct-outline" size={28} color={C.faint} />
      <Text style={{ ...T.h2, textAlign: 'center' }}>{title}</Text>
      <Badge label={phase} color={C.info} />
      {note ? (
        <Text style={{ color: C.muted, fontSize: 12.5, textAlign: 'center', maxWidth: 320, fontFamily: F.reg }}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}
