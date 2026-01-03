/**
 * Nord Theme
 *
 * An arctic, north-bluish color palette with cold, clean aesthetics.
 * https://www.nordtheme.com/
 */

import type { Theme } from "../tokens";

export const nordTheme: Theme = {
  id: "nord",
  name: "Nord",
  dark: {
    seeds: {
      neutral: "#2e3440",
      primary: "#88c0d0",
      success: "#a3be8c",
      warning: "#ebcb8b",
      error: "#bf616a",
      info: "#81a1c1",
    },
    overrides: {
      bgBase: "#2e3440",
      bgSurface: "#3b4252",
      bgInput: "#434c5e",
      bgSurfaceHover: "#434c5e",
      borderBase: "#4c566a",
      borderMuted: "#434c5e",
      textBase: "#eceff4",
      textMuted: "#d8dee9",
      textSubtle: "#4c566a",
      // Nord Frost colors for syntax
      syntaxKeyword: "#81a1c1",
      syntaxString: "#a3be8c",
      syntaxNumber: "#b48ead",
      syntaxFunction: "#88c0d0",
      syntaxProperty: "#8fbcbb",
      syntaxType: "#8fbcbb",
      syntaxConstant: "#b48ead",
      syntaxComment: "#616e88",
      syntaxOperator: "#81a1c1",
      syntaxVariable: "#d8dee9",
      // Diff colors
      diffAdd: "#a3be8c",
      diffAddBg: "#2e3d2e",
      diffDelete: "#bf616a",
      diffDeleteBg: "#3d2e2e",
    },
  },
  light: {
    seeds: {
      neutral: "#eceff4",
      primary: "#5e81ac",
      success: "#8fbcbb",
      warning: "#d08770",
      error: "#bf616a",
      info: "#81a1c1",
    },
    overrides: {
      bgBase: "#eceff4",
      bgSurface: "#e5e9f0",
      bgInput: "#ffffff",
      textBase: "#2e3440",
      textMuted: "#4c566a",
    },
  },
};
