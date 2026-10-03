/**
 * Design tokens — SPC NC Workforce
 * Re-themed from spc-field-force's Trust Blue to a navy/gold enterprise
 * palette per PRD §3. Deep navy primary chrome + a restrained gold accent
 * for brand moments (not status — status colors stay conventional
 * green/amber/blue/red so meaning never collides with brand).
 * Contrast: semantic colors kept AA (>=4.5:1) against their expected background.
 */

export const C = {
  // Brand — deep navy, with a gold accent reserved for brand marks / emphasis,
  // not for status meaning. Navy passes AA as text-on-white at ~11:1.
  primary: '#0B1B3A',
  primaryDark: '#081226', // pressed state
  primaryText: '#13284F',
  onPrimary: '#FFFFFF', // text/icon color to place ON a primary-colored surface
  gold: '#C9A227',
  onGold: '#1A1400',

  // Neutral — cool slate
  bg: '#F8FAFC',
  card: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  railBg: '#0B1B3A', // side-rail nav (web/tablet) — deep navy
  // Content on the dark navy surfaces (rail, header, login brand pane)
  onDark: '#FFFFFF',
  onDarkMuted: 'rgba(255,255,255,0.7)',
  onDarkFaint: 'rgba(255,255,255,0.55)',
  darkActive: 'rgba(255,255,255,0.08)', // selected rail item
  darkDivider: 'rgba(255,255,255,0.08)',
  darkChip: 'rgba(255,255,255,0.16)', // role pill in the header
  text: '#1E293B',
  muted: '#475569',
  faint: '#94A3B8',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  divider: '#F1F5F9',
  overlay: 'rgba(11, 27, 58, 0.45)',
  focus: '#13284F',

  // Semantik — status warna tetap konvensional (hijau/oranye/biru/merah)
  // supaya tidak bentrok dengan brand; hanya brand yang pindah, bukan makna status.
  ok: '#15803D',
  warn: '#B45309',
  info: '#0369A1',
  accent: '#DC2626', // destruktif / error
  purple: '#6D28D9',
  teal: '#0E7490',

  // Latar lembut untuk badge/tint
  okBg: '#DCFCE7',
  warnBg: '#FEF3C7',
  infoBg: '#DBEAFE',
  dangerBg: '#FEE2E2',
  surfaceAlt: '#EFF6FF', // kartu terpilih / baris aktif
  warnBorder: '#FCD34D', // garis tepi dekoratif pada latar warnBg

  // Status penting yang dibaca di bawah cahaya toko yang terang: >= 7:1 pada
  // putih dan semua latar tint di atas (okBg/warnBg/infoBg/dangerBg/surfaceAlt).
  okStrong: '#14532D',
  warnStrong: '#78350F',
  infoStrong: '#0C4A6E',
  dangerStrong: '#7F1D1D',
  tealStrong: '#134E4A',
  tealBg: '#CCFBF1',
  purpleStrong: '#4C1D95',
  purpleBg: '#EDE9FE',
  /** destructive button fill — white text 6.5:1 */
  dangerFill: '#B91C1C',
};

/**
 * Badge / status pill colors: a tint background with strong text, >= 7:1.
 * Callers pass any status color (ok, okStrong, warn, info, accent, teal…);
 * unknown colors fall back to a neutral pill.
 */
export function toneOf(color: string): { fg: string; bg: string } {
  switch (color) {
    case C.ok:
    case C.okStrong:
      return { fg: C.okStrong, bg: C.okBg };
    case C.warn:
    case C.warnStrong:
      return { fg: C.warnStrong, bg: C.warnBg };
    case C.info:
    case C.infoStrong:
    case C.primary:
    case C.primaryText:
    case C.primaryDark:
      return { fg: C.infoStrong, bg: C.infoBg };
    case C.accent:
    case C.dangerStrong:
    case C.dangerFill:
      return { fg: C.dangerStrong, bg: C.dangerBg };
    case C.teal:
    case C.tealStrong:
      return { fg: C.tealStrong, bg: C.tealBg };
    case C.purple:
    case C.purpleStrong:
      return { fg: C.purpleStrong, bg: C.purpleBg };
    default:
      return { fg: C.text, bg: C.divider };
  }
}

/** Target sentuh minimum (dp) — tombol, chip, baris yang bisa diketuk. */
export const TOUCH = 48;

/** Warna status skorkartu (On Track / Perlu Perhatian / Di Bawah Target) — lihat PRD §9 */
export const STATUS_COLOR = {
  on_track: C.ok,
  needs_attention: C.warn,
  below_target: C.accent,
} as const;

/** Font: Plus Jakarta Sans di semua tier (mengikuti spc-field-force) — angka tabular pakai fontVariant. */
export const F = {
  reg: 'PlusJakartaSans_400Regular',
  semi: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  xbold: 'PlusJakartaSans_800ExtraBold',
};

/**
 * Skala tipografi — Display → H1-H3 → Body → Small → Caption → Label → Metric.
 * Tidak ada teks di bawah 12 dp: dibaca berdiri, di bawah lampu toko yang terang.
 */
export const T = {
  display: { fontSize: 30, lineHeight: 36, fontFamily: F.xbold, color: C.text, letterSpacing: -0.3 } as const,
  h1: { fontSize: 22, lineHeight: 28, fontFamily: F.xbold, color: C.text } as const,
  h2: { fontSize: 16, lineHeight: 22, fontFamily: F.bold, color: C.text } as const,
  h3: { fontSize: 14, lineHeight: 20, fontFamily: F.bold, color: C.text } as const,
  body: { fontSize: 14, lineHeight: 20, fontFamily: F.reg, color: C.text } as const,
  small: { fontSize: 13, lineHeight: 18, fontFamily: F.reg, color: C.muted } as const,
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: F.semi,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: C.muted,
  } as const,
  label: { fontSize: 13, lineHeight: 18, fontFamily: F.semi, color: C.text } as const,
  /** badge / status pill text */
  badge: { fontSize: 12, lineHeight: 16, fontFamily: F.bold } as const,
  /** bottom-tab label */
  tab: { fontSize: 12, lineHeight: 15, fontFamily: F.semi } as const,
  /** secondary line under list rows: times, counts */
  meta: { fontSize: 12, lineHeight: 16, fontFamily: F.reg, color: C.muted } as const,
  button: { fontSize: 15, lineHeight: 20, fontFamily: F.bold, letterSpacing: 0.2 } as const,
  buttonSmall: { fontSize: 14, lineHeight: 18, fontFamily: F.bold, letterSpacing: 0.2 } as const,
  /** screen title in the navigation header */
  header: { fontSize: 17, fontFamily: F.bold } as const,
  /** status bar & status lines read at a glance (strip, required-report ticks) */
  status: { fontSize: 13, lineHeight: 18, fontFamily: F.bold, color: C.text } as const,
  /** angka besar di KPI/metric card — mono tabular agar sejajar saat berubah */
  metric: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: F.xbold,
    color: C.text,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'] as any,
  },
  /** timer absensi/kunjungan aktif — angka besar, dipisah dari `display` (dipakai brand title Login) */
  timer: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: F.xbold,
    color: C.primaryDark,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'] as any,
  },
};

/** Skala spacing (density dashboard) */
export const SP = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/** Radius — card 16 / input & tombol 12; rail nav tetap 10 (hardcoded di App.tsx) */
export const R = {
  card: 16,
  input: 12,
  btn: 12,
} as const;

const shadowCard = {
  shadowColor: '#0B1B3A',
  shadowOpacity: 0.05,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 1,
};

/** Elevasi — Level 1 (card) & Level 3 (modal) */
export const ELEV = {
  0: {},
  1: shadowCard,
  2: {
    shadowColor: '#0B1B3A',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;
