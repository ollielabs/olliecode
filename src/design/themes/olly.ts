/**
 * Olly - Default theme
 *
 * A minimal, achromatic theme with blue accents.
 * Dark blacks and grays for backgrounds, white/gray for text.
 */

import type { Theme } from '../tokens';

export const ollyTheme: Theme = {
  id: 'olly',
  name: 'Olly',
  dark: {
    seeds: {
      neutral: '#0a0a0a',
      primary: '#5c8ed9',
      success: '#6fbf73',
      warning: '#d9a85c',
      error: '#d96b6b',
      info: '#5cb8d9',
    },
    overrides: {
      // Deep blacks for backgrounds
      bgBase: '#0a0a0a',
      bgSurface: '#141414',
      bgInput: '#1e1e1e',
      bgSurfaceHover: '#1e1e1e',
      bgOverlay: 'rgba(10, 10, 10, 0.9)',
      // Subtle gray borders
      borderBase: '#2a2a2a',
      borderMuted: '#1e1e1e',
      borderAccent: '#5c8ed9',
      // White/gray text
      textBase: '#e5e5e5',
      textMuted: '#a0a0a0',
      textSubtle: '#606060',
      // Syntax - muted but readable
      syntaxKeyword: '#5c8ed9',
      syntaxString: '#6fbf73',
      syntaxNumber: '#d9a85c',
      syntaxFunction: '#5cb8d9',
      syntaxProperty: '#8fb8d9',
      syntaxType: '#8fb8d9',
      syntaxConstant: '#d9a85c',
      syntaxComment: '#505050',
      syntaxOperator: '#a0a0a0',
      syntaxVariable: '#c0c0c0',
      syntaxPunctuation: '#707070',
      syntaxDefault: '#c0c0c0',
      // Diff colors
      diffAdd: '#22c55e',
      diffAddBg: '#1a4d1a',
      diffDelete: '#ef4444',
      diffDeleteBg: '#4d1a1a',
    },
  },
  light: {
    seeds: {
      neutral: '#f5f5f5',
      primary: '#2563eb',
      success: '#16a34a',
      warning: '#ca8a04',
      error: '#dc2626',
      info: '#0891b2',
    },
    overrides: {
      bgBase: '#f5f5f5',
      bgSurface: '#ffffff',
      bgInput: '#ffffff',
      bgOverlay: 'rgba(245, 245, 245, 0.9)',
      borderBase: '#d4d4d4',
      borderMuted: '#e5e5e5',
      textBase: '#171717',
      textMuted: '#525252',
      textSubtle: '#a3a3a3',
    },
  },
};
