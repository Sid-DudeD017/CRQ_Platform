import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      "colors": {
          "primary": "var(--primary)",
          "inverse-primary": "var(--inverse-primary)",
          "on-primary-fixed": "var(--on-primary-fixed)",
          "on-secondary": "var(--on-secondary)",
          "primary-fixed-dim": "var(--primary-fixed-dim)",
          "surface-dim": "var(--surface-dim)",
          "surface": "var(--surface)",
          "tertiary-fixed": "var(--tertiary-fixed)",
          "on-surface": "var(--on-surface)",
          "tertiary": "var(--tertiary)",
          "tertiary-container": "var(--tertiary-container)",
          "outline-variant": "var(--outline-variant)",
          "error": "var(--error)",
          "surface-bright": "var(--surface-bright)",
          "on-surface-variant": "var(--on-surface-variant)",
          "outline": "var(--outline)",
          "on-error": "var(--on-error)",
          "background": "var(--background)",
          "on-tertiary-container": "var(--on-tertiary-container)",
          "secondary": "var(--secondary)",
          "surface-container-lowest": "var(--surface-container-lowest)",
          "primary-container": "var(--primary-container)",
          "surface-container-low": "var(--surface-container-low)",
          "on-tertiary-fixed": "var(--on-tertiary-fixed)",
          "on-background": "var(--on-background)",
          "surface-container": "var(--surface-container)",
          "secondary-fixed": "var(--secondary-fixed)",
          "surface-container-highest": "var(--surface-container-highest)",
          "surface-container-high": "var(--surface-container-high)",
          "on-primary": "var(--on-primary)",
          "primary-fixed": "var(--primary-fixed)",
          "surface-tint": "var(--surface-tint)",
          "tertiary-fixed-dim": "var(--tertiary-fixed-dim)",
          "on-secondary-fixed": "var(--on-secondary-fixed)",
          "on-secondary-fixed-variant": "var(--on-secondary-fixed-variant)",
          "secondary-container": "var(--secondary-container)",
          "on-tertiary-fixed-variant": "var(--on-tertiary-fixed-variant)",
          "on-primary-container": "var(--on-primary-container)",
          "error-container": "var(--error-container)",
          "surface-variant": "var(--surface-variant)",
          "on-primary-fixed-variant": "var(--on-primary-fixed-variant)",
          "inverse-on-surface": "var(--inverse-on-surface)",
          "secondary-fixed-dim": "var(--secondary-fixed-dim)",
          "on-error-container": "var(--on-error-container)",
          "inverse-surface": "var(--inverse-surface)",
          "on-tertiary": "var(--on-tertiary)",
          "on-secondary-container": "var(--on-secondary-container)"
      
      },
      "borderRadius": {
          "DEFAULT": "0.125rem",
          "lg": "0.25rem",
          "xl": "0.5rem",
          "full": "0.75rem"
      },
      "spacing": {
          "stack-sm": "8px",
          "gutter": "24px",
          "stack-lg": "32px",
          "container-padding": "32px",
          "stack-md": "16px",
          "unit": "4px"
      },
      "fontFamily": {
          "body-md": ["Inter"],
          "headline-sm": ["Hanken Grotesk"],
          "headline-md": ["Hanken Grotesk"],
          "data-mono": ["JetBrains Mono"],
          "body-sm": ["Inter"],
          "title-lg": ["Inter"],
          "label-caps": ["Inter"],
          "display-lg": ["Hanken Grotesk"]
      },
      "fontSize": {
          "body-md": ["16px", { "lineHeight": "24px", "fontWeight": "400" }],
          "headline-sm": ["24px", { "lineHeight": "32px", "fontWeight": "600" }],
          "headline-md": ["32px", { "lineHeight": "40px", "letterSpacing": "-0.01em", "fontWeight": "600" }],
          "data-mono": ["14px", { "lineHeight": "20px", "letterSpacing": "0.02em", "fontWeight": "500" }],
          "body-sm": ["14px", { "lineHeight": "20px", "fontWeight": "400" }],
          "title-lg": ["18px", { "lineHeight": "28px", "fontWeight": "600" }],
          "label-caps": ["12px", { "lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "700" }],
          "display-lg": ["48px", { "lineHeight": "56px", "letterSpacing": "-0.02em", "fontWeight": "700" }]
      }
    },
  },
  plugins: [],
};
export default config;
