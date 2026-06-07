import type { Config } from "tailwindcss";

/**
 * FuelMetrics design system.
 * Tokens are taken verbatim from the Stitch design export (fuelmetrics/DESIGN.md)
 * so the implemented UI matches the approved visual language.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#f8f9ff",
        "surface-dim": "#cbdbf5",
        "surface-bright": "#f8f9ff",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#eff4ff",
        "surface-container": "#e5eeff",
        "surface-container-high": "#dce9ff",
        "surface-container-highest": "#d3e4fe",
        "on-surface": "#0b1c30",
        "on-surface-variant": "#43474d",
        "inverse-surface": "#213145",
        "inverse-on-surface": "#eaf1ff",
        outline: "#74777e",
        "outline-variant": "#c4c6ce",
        "surface-tint": "#49607e",
        primary: "#0a2540",
        "on-primary": "#ffffff",
        "primary-container": "#0a2540",
        "on-primary-container": "#768dad",
        "inverse-primary": "#b0c8eb",
        secondary: "#006c49",
        "on-secondary": "#ffffff",
        "secondary-container": "#6cf8bb",
        "on-secondary-container": "#00714d",
        tertiary: "#7d5800",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#ffdea8",
        "on-tertiary-container": "#5e4200",
        error: "#ba1a1a",
        "on-error": "#ffffff",
        "error-container": "#ffdad6",
        "on-error-container": "#93000a",
        success: "#006c49",
        "success-container": "#6cf8bb",
        warning: "#7d5800",
        "warning-container": "#ffdea8",
        background: "#f8f9ff",
        "on-background": "#0b1c30",
        "surface-variant": "#d3e4fe",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "headline-lg": ["24px", { lineHeight: "32px", fontWeight: "700" }],
        "headline-md": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "headline-sm": ["16px", { lineHeight: "24px", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-md": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "body-sm": ["12px", { lineHeight: "16px", fontWeight: "400" }],
        "data-display": [
          "18px",
          { lineHeight: "24px", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        "label-caps": [
          "11px",
          { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "700" },
        ],
      },
      borderRadius: {
        sm: "0.125rem",
        DEFAULT: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      boxShadow: {
        card: "0px 2px 4px rgba(10, 37, 64, 0.05)",
        floating: "0px 8px 16px rgba(10, 37, 64, 0.1)",
      },
      spacing: {
        "touch-min": "2.75rem",
      },
    },
  },
  plugins: [],
};

export default config;
