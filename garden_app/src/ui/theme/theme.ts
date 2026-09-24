/**
 * Design tokens. Calm, natural and practical: warm paper background, leaf
 * green primary, soil and sun accents. Colours meet WCAG AA contrast for text
 * on their intended backgrounds; status is never conveyed by colour alone
 * (badges always pair an icon and a word).
 */
import { useColorScheme } from 'react-native';

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  accent: string;
  accentSoft: string;
  sky: string;
  skySoft: string;
  good: string;
  goodSoft: string;
  caution: string;
  cautionSoft: string;
  danger: string;
  dangerSoft: string;
  neutralSoft: string;
}

export const light: Palette = {
  bg: '#F6F4EE',
  surface: '#FFFFFF',
  surfaceAlt: '#EFECE3',
  border: '#DCD7CA',
  text: '#1E2A21',
  textMuted: '#55635A',
  primary: '#2F6B3F',
  onPrimary: '#FFFFFF',
  primarySoft: '#DDEBDD',
  accent: '#8B5E3C',
  accentSoft: '#F1E4D6',
  sky: '#245C7F',
  skySoft: '#DDEAF2',
  good: '#2F6B3F',
  goodSoft: '#DDEBDD',
  caution: '#7A4E00',
  cautionSoft: '#FCEFD2',
  danger: '#9B2C2C',
  dangerSoft: '#FBE3E1',
  neutralSoft: '#ECEAE4',
};

export const dark: Palette = {
  bg: '#111711',
  surface: '#1A221B',
  surfaceAlt: '#212B22',
  border: '#34413A',
  text: '#E8EDE6',
  textMuted: '#A9B6AC',
  primary: '#8CC79A',
  onPrimary: '#0E1A10',
  primarySoft: '#243A29',
  accent: '#D7A67C',
  accentSoft: '#3A2D22',
  sky: '#8EC3E6',
  skySoft: '#1D3140',
  good: '#8CC79A',
  goodSoft: '#243A29',
  caution: '#F2C66D',
  cautionSoft: '#3A301A',
  danger: '#F2A09A',
  dangerSoft: '#402221',
  neutralSoft: '#262E27',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** Minimum touch target (Android 48dp / iOS 44pt). */
export const TOUCH = 48;

export const type = {
  title: { fontSize: 26, fontWeight: '700' as const, lineHeight: 32 },
  h2: { fontSize: 20, fontWeight: '700' as const, lineHeight: 26 },
  h3: { fontSize: 17, fontWeight: '600' as const, lineHeight: 23 },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 14, lineHeight: 20 },
  tiny: { fontSize: 12, lineHeight: 16 },
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
