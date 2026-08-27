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
          "primary": "#000000",
          "inverse-primary": "#bec6e0",
          "on-primary-fixed": "#131b2e",
          "on-secondary": "#ffffff",
          "primary-fixed-dim": "#bec6e0",
          "surface-dim": "#d8dadc",
          "surface": "#f7f9fb",
          "tertiary-fixed": "#fcdeb5",
          "on-surface": "#191c1e",
          "tertiary": "#000000",
          "tertiary-container": "#271901",
          "outline-variant": "#c6c6cd",
          "error": "#ba1a1a",
          "surface-bright": "#f7f9fb",
          "on-surface-variant": "#45464d",
          "outline": "#76777d",
          "on-error": "#ffffff",
          "background": "#f7f9fb",
          "on-tertiary-container": "#98805d",
          "secondary": "#515f74",
          "surface-container-lowest": "#ffffff",
          "primary-container": "#131b2e",
          "surface-container-low": "#f2f4f6",
          "on-tertiary-fixed": "#271901",
          "on-background": "#191c1e",
          "surface-container": "#eceef0",
          "secondary-fixed": "#d5e3fd",
          "surface-container-highest": "#e0e3e5",
          "surface-container-high": "#e6e8ea",
          "on-primary": "#ffffff",
          "primary-fixed": "#dae2fd",
          "surface-tint": "#565e74",
          "tertiary-fixed-dim": "#dec29a",
          "on-secondary-fixed": "#0d1c2f",
          "on-secondary-fixed-variant": "#3a485c",
          "secondary-container": "#d5e3fd",
          "on-tertiary-fixed-variant": "#574425",
          "on-primary-container": "#7c839b",
          "error-container": "#ffdad6",
          "surface-variant": "#e0e3e5",
          "on-primary-fixed-variant": "#3f465c",
          "inverse-on-surface": "#eff1f3",
          "secondary-fixed-dim": "#b9c7e0",
          "on-error-container": "#93000a",
          "inverse-surface": "#2d3133",
          "on-tertiary": "#ffffff",
          "on-secondary-container": "#57657b"
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
