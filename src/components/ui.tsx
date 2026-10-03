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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, ELEV, F, R, SP, T, toneOf, TOUCH } from '../theme';

/*
 * Shared building blocks. Field rules applied here once for every screen:
 * every tappable thing is >= 48 dp (TOUCH), text comes from the T scale
 * (nothing under 12 dp), status is never color alone (icon or text too), and
 * interactive elements carry their accessibility role, label and state.
 */

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
  return (
    <Text role="heading" style={[T.h2, style]}>
      {children}
    </Text>
  );
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

/** Text pill — tint background with strong text (>= 7:1), see toneOf. */
export function Badge({ label, color }: { label: string; color: string }) {
  const tone = toneOf(color);
  return (
    <View
      style={{
        backgroundColor: tone.bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={[T.badge, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

/**
 * Selectable pill. Without `onPress` it is shown as not selectable (dimmed,
 * not focusable) — e.g. a funnel stage that can't be picked right now.
 */
export function Chip({
  label,
  active,
  onPress,
  color = C.primary,
  accessibilityLabel,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
  accessibilityLabel?: string;
}) {
  const disabled = !onPress;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!active, disabled }}
      style={{
        minHeight: TOUCH,
        justifyContent: 'center',
        paddingHorizontal: SP.lg,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: active ? color : disabled ? C.border : C.borderStrong,
        backgroundColor: active ? color : disabled ? C.divider : C.card,
        opacity: disabled && !active ? 0.6 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {active && <Ionicons name="checkmark" size={16} color={C.onPrimary} />}
        <Text style={[T.label, { color: active ? C.onPrimary : C.text }]}>{label}</Text>
      </View>
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
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'danger' | 'ok';
  disabled?: boolean;
  /** Narrower and smaller text — still a full 48 dp tap target. */
  small?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const bg =
    variant === 'primary'
      ? C.primary
      : variant === 'danger'
        ? C.dangerFill
        : variant === 'ok'
          ? C.ok
          : C.card;
  const fg = variant === 'outline' ? C.primaryText : C.onPrimary;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={{
        backgroundColor: bg,
        borderWidth: variant === 'outline' ? 1.5 : 0,
        borderColor: C.primaryDark,
        opacity: disabled && !loading ? 0.45 : 1,
        borderRadius: R.btn,
        minHeight: TOUCH,
        paddingHorizontal: small ? SP.md : SP.lg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: SP.sm,
      }}
    >
      {loading && <ActivityIndicator size="small" color={fg} aria-label="Memproses" />}
      <Text style={[small ? T.buttonSmall : T.button, { color: fg, textAlign: 'center' }]}>{title}</Text>
    </TouchableOpacity>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={C.muted}
      {...props}
      style={[
        T.body,
        {
          minHeight: TOUCH,
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.borderStrong,
          borderRadius: R.input,
          paddingHorizontal: SP.md,
          paddingVertical: SP.md,
          fontSize: T.button.fontSize,
        },
        props.style,
      ]}
    />
  );
}

/** Form field with a label; `required` adds "(wajib)", `error` shows under it and is announced. */
export function Field({
  label,
  children,
  required,
  error,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  error?: string | null;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={T.label}>
        {label}
        {required ? <Text style={[T.label, { color: C.muted }]}> (wajib)</Text> : null}
      </Text>
      {children}
      {error ? (
        <View role="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: SP.xs }}>
          <Ionicons name="alert-circle" size={16} color={C.dangerStrong} />
          <Text style={[T.label, { color: C.dangerStrong, flexShrink: 1 }]}>{error}</Text>
        </View>
      ) : null}
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
    <Card style={{ flex: 1, minWidth: 140 }}>
      <Text style={T.caption}>{title}</Text>
      <Text style={[T.metric, { color, marginTop: 4 }]}>{value}</Text>
      {sub ? <Muted style={{ marginTop: 3 }}>{sub}</Muted> : null}
    </Card>
  );
}

/** Nothing to show yet — what it means, and (optionally) the one thing to do about it. */
export function Empty({
  text,
  icon = 'file-tray-outline',
  action,
}: {
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: SP.xl, paddingHorizontal: SP.lg, gap: SP.sm }}>
      <Ionicons name={icon} size={28} color={C.muted} />
      <Text style={[T.body, { color: C.muted, textAlign: 'center' }]}>{text}</Text>
      {action && <Btn small variant="outline" title={action.label} onPress={action.onPress} />}
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
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SP.sm }}>
      <View style={{ flexShrink: 1 }}>
        <Text role="heading" style={T.h1}>
          {title}
        </Text>
        {subtitle ? <Muted style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
      </View>
      {action && (
        <TouchableOpacity
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={{ minHeight: TOUCH, minWidth: TOUCH, justifyContent: 'center', paddingHorizontal: SP.sm }}
        >
          <Text style={[T.label, { color: C.primaryText, fontFamily: F.bold }]}>{action.label}</Text>
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
  const a11y = onPress
    ? {
        accessibilityRole: (selected !== undefined ? 'checkbox' : 'button') as 'checkbox' | 'button',
        accessibilityLabel: [title, subtitle, emphasis?.label, meta].filter(Boolean).join(', '),
        accessibilityState: selected !== undefined ? { checked: selected } : undefined,
      }
    : {};
  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.7}
      {...a11y}
      style={{
        flexDirection: 'row',
        alignItems: selected !== undefined ? 'center' : undefined,
        minHeight: onPress ? TOUCH : undefined,
        backgroundColor: C.card,
        borderRadius: R.card,
        borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        borderColor: selected ? C.primaryDark : C.borderStrong,
        overflow: 'hidden',
      }}
    >
      {emphasis && <View style={{ width: 4, backgroundColor: emphasis.color }} />}
      {selected !== undefined && (
        <View style={{ paddingLeft: SP.md }}>
          <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={24} color={selected ? C.primaryDark : C.muted} />
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SP.sm, marginTop: 6 }}>
            {emphasis ? (
              <Text style={[T.badge, { color: toneOf(emphasis.color).fg }]}>{emphasis.label}</Text>
            ) : (
              <View />
            )}
            {meta ? <Text style={[T.meta, { flexShrink: 1, textAlign: 'right' }]}>{meta}</Text> : null}
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
  const tone = toneOf(color);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: tone.bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Ionicons name={icon} size={14} color={tone.fg} />
      <Text style={[T.badge, { color: tone.fg }]}>{label}</Text>
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

/** Bottom padding for scroll content under a StickyFooter — its button plus the
 * home-indicator inset of edge-to-edge phones (~34 dp). */
export const STICKY_FOOTER_SPACE = 140;

/** Footer tombol yang menempel di bawah layar (CHECK IN / CHECK OUT dsb). */
export function StickyFooter({ children }: { children: React.ReactNode }) {
  // Clear the home indicator / gesture bar on edge-to-edge phones.
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: C.card,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: C.borderStrong,
        alignItems: 'center',
      }}
    >
      <View style={{ padding: SP.lg, paddingTop: 10, paddingBottom: SP.lg + insets.bottom, gap: SP.sm, maxWidth: 900, width: '100%' }}>
        {children}
      </View>
    </View>
  );
}

/** Garis pemisah tipis — dipakai daripada tiap layar bikin View 1px sendiri. */
export function Divider({ style }: { style?: object }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }, style]} />;
}

/** Icon-only button: a 48 dp target and a spoken label (an icon alone says nothing to a screen reader). */
export function IconButton({
  name,
  size = 22,
  color = C.text,
  onPress,
  label,
}: {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  color?: string;
  onPress?: () => void;
  label: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name={name} size={size} color={color} />
    </TouchableOpacity>
  );
}

export type KPIStatus = 'ok' | 'warn' | 'danger' | 'neutral';

const KPI_STATUS: Record<KPIStatus, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  ok: { color: C.okStrong, icon: 'checkmark-circle', label: 'Sesuai target' },
  warn: { color: C.warnStrong, icon: 'alert-circle', label: 'Perlu perhatian' },
  danger: { color: C.dangerStrong, icon: 'close-circle', label: 'Di bawah target' },
  neutral: { color: C.muted, icon: 'ellipse-outline', label: 'Belum ada data' },
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
  const trendColor = trend ? (trend.good === false ? C.dangerStrong : trend.good ? C.okStrong : C.muted) : C.muted;
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
        borderTopWidth: 3,
        borderTopColor: st.color,
        ...ELEV[1],
      }}
    >
      <Text style={T.caption}>{title}</Text>
      <Text style={[T.metric, { marginTop: 4 }]}>{value}</Text>
      {target ? <Muted style={{ marginTop: 2 }}>{target}</Muted> : null}
      {trend && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 }}>
          <Ionicons name={trendIcon} size={14} color={trendColor} />
          <Text style={[T.badge, { color: trendColor }]}>{trend.label}</Text>
        </View>
      )}
      {(status !== 'neutral' || statusLabel) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
          <Ionicons name={st.icon} size={14} color={st.color} />
          <Text style={[T.badge, { color: st.color }]}>{statusLabel ?? st.label}</Text>
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

/** Loading placeholder for a card or list; `label` is announced so the wait isn't silent. */
export function LoadingCard({ label = 'Memuat…' }: { label?: string }) {
  return (
    <Card style={{ gap: 8 }}>
      <View role="status" aria-label={label} accessibilityLabel={label}>
        <SkeletonBlock width="40%" height={12} />
        <SkeletonBlock width="60%" height={22} style={{ marginTop: 8 }} />
        <SkeletonBlock width="80%" height={12} style={{ marginTop: 8 }} />
      </View>
    </Card>
  );
}

/** Something failed to load — what happened, and a way to try again. */
export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View role="alert" style={{ alignItems: 'center', paddingVertical: SP.xl, gap: SP.sm }}>
      <Ionicons name="warning-outline" size={26} color={C.dangerStrong} />
      <Text style={[T.body, { fontFamily: F.semi, textAlign: 'center' }]}>{text}</Text>
      {onRetry && <Btn small variant="outline" title="Coba Lagi" onPress={onRetry} />}
    </View>
  );
}

/** Online-only action unavailable right now — says so instead of failing on tap. */
export function OfflineNote({ text }: { text: string }) {
  return (
    <View
      role="status"
      style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.md, borderRadius: R.input, backgroundColor: C.warnBg }}
    >
      <Ionicons name="cloud-offline" size={18} color={C.warnStrong} />
      <Text style={[T.label, { flex: 1 }]}>{text}</Text>
    </View>
  );
}
