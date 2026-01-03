/**
 * Catppuccin Theme (Mocha variant for dark, Latte for light)
 *
 * A soothing pastel theme with warm, cozy colors.
 * https://github.com/catppuccin/catppuccin
 */

import type { Theme } from "../tokens";

export const catppuccinTheme: Theme = {
  id: "catppuccin",
  name: "Catppuccin",
  dark: {
    // Mocha variant
    seeds: {
      neutral: "#1e1e2e",
      primary: "#cba6f7",
      success: "#a6e3a1",
      warning: "#f9e2af",
      error: "#f38ba8",
      info: "#89dceb",
    },
    overrides: {
      bgBase: "#1e1e2e",
      bgSurface: "#313244",
      bgInput: "#45475a",
      bgSurfaceHover: "#45475a",
      borderBase: "#45475a",
      borderMuted: "#313244",
      textBase: "#cdd6f4",
      textMuted: "#a6adc8",
      textSubtle: "#6c7086",
      // Catppuccin Mocha syntax
      syntaxKeyword: "#cba6f7",
      syntaxString: "#a6e3a1",
      syntaxNumber: "#fab387",
      syntaxFunction: "#89b4fa",
      syntaxProperty: "#94e2d5",
      syntaxType: "#f9e2af",
      syntaxConstant: "#fab387",
      syntaxComment: "#6c7086",
      syntaxOperator: "#89dceb",
      syntaxVariable: "#cdd6f4",
      // Diff colors
      diffAdd: "#a6e3a1",
      diffAddBg: "#2d4a2d",
      diffDelete: "#f38ba8",
      diffDeleteBg: "#4a2d3a",
    },
  },
  light: {
    // Latte variant
    seeds: {
      neutral: "#eff1f5",
      primary: "#8839ef",
      success: "#40a02b",
      warning: "#df8e1d",
      error: "#d20f39",
      info: "#04a5e5",
    },
    overrides: {
      bgBase: "#eff1f5",
      bgSurface: "#e6e9ef",
      bgInput: "#ffffff",
      textBase: "#4c4f69",
      textMuted: "#6c6f85",
      textSubtle: "#9ca0b0",
    },
  },
};
