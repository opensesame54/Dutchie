import { Platform } from 'react-native';

/**
 * Dutchie's visual identity: a paper ledger.
 *
 * Warm off-white "paper", ink-dark text, a single ochre accent, and monospace
 * for every number so amounts align in a column the way they would on a
 * receipt. Deliberately not default React Navigation blue-on-white.
 */

const palette = {
  paper: '#F4EFE3',
  paperRaised: '#FBF8F1',
  ink: '#1F1B14',
  inkSoft: '#5C5346',
  inkFaint: '#8C8272',
  rule: '#DCD3C0',
  ochre: '#B8791F',
  ochreSoft: '#F0E2C8',
  // Owed-to-you and you-owe need to be distinguishable without relying on
  // colour alone, so the UI always pairs these with a +/- sign and a label.
  positive: '#2F6B4F',
  negative: '#A33A28',
};

const darkPalette = {
  paper: '#14110C',
  paperRaised: '#1E1A13',
  ink: '#F2ECE0',
  inkSoft: '#B5AC9B',
  inkFaint: '#7E7566',
  rule: '#332D23',
  ochre: '#E0A64B',
  ochreSoft: '#3A2E19',
  positive: '#68B98F',
  negative: '#E38071',
};

export type Palette = typeof palette;

export const themes = { light: palette, dark: darkPalette };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
};

/**
 * A real monospace face on each platform — amounts must line up digit for
 * digit, which the system sans will not do.
 */
export const monoFont = Platform.select({
  android: 'monospace',
  ios: 'Menlo',
  default: 'monospace',
}) as string;

export const typography = {
  screenTitle: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  sectionTitle: { fontSize: 13, fontWeight: '700' as const, letterSpacing: 1.2 },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  amount: { fontFamily: monoFont, fontSize: 15, fontWeight: '600' as const },
  amountLarge: { fontFamily: monoFont, fontSize: 34, fontWeight: '700' as const },
};

/** Android's minimum comfortable touch target. */
export const MIN_TOUCH_TARGET = 48;
