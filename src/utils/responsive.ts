import { useWindowDimensions } from 'react-native';

/**
 * Breakpoint scale: small mobile / large mobile / tablet / desktop / wide desktop.
 * Values are min-widths in dp.
 */
export const BP = {
  smallMobile: 0,
  largeMobile: 400,
  tablet: 700,
  desktop: 900,
  wideDesktop: 1280,
} as const;

export interface Breakpoint {
  width: number;
  isTablet: boolean; // >= 700
  isDesktop: boolean; // >= 900 — enough room for a persistent side rail
  isWideDesktop: boolean; // >= 1280 — enough room for multi-column detail layouts
}

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return {
    width,
    isTablet: width >= BP.tablet,
    isDesktop: width >= BP.desktop,
    isWideDesktop: width >= BP.wideDesktop,
  };
}
