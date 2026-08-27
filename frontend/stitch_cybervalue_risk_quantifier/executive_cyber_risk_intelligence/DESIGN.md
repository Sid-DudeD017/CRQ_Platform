---
name: Executive Cyber Risk Intelligence
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#515f74'
  on-secondary: '#ffffff'
  secondary-container: '#d5e3fd'
  on-secondary-container: '#57657b'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#271901'
  on-tertiary-container: '#98805d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d5e3fd'
  secondary-fixed-dim: '#b9c7e0'
  on-secondary-fixed: '#0d1c2f'
  on-secondary-fixed-variant: '#3a485c'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 32px
  gutter: 24px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

The design system is anchored in the concept of **Executive Minimalist**. It is designed for Chief Information Security Officers (CISOs) and Board Directors who require immediate clarity on complex financial exposure. The aesthetic prioritizes high-end fintech precision over decorative flair.

The brand personality is **authoritative, analytical, and discreet**. It avoids the "hacker" tropes of cybersecurity in favor of a strategic consulting aesthetic. Visuals are defined by wide margins, meticulous alignment, and a systematic approach to data density. The emotional goal is to provide a sense of calm control amidst high-stakes risk environments.

## Colors

This design system utilizes a high-contrast, professional palette designed for long-form data analysis.

- **Primary (Trust Blue):** `#0F172A` (Slate 900). Used for primary navigation, high-level headers, and core brand elements to establish authority.
- **Secondary (Steel):** `#334155`. Used for sub-headers and secondary UI controls.
- **Semantic Risk Tones:** 
  - **Emerald Green:** For ROI indicators, mitigated risks, and "Safe" zones.
  - **Amber:** For moderate exposure requiring attention.
  - **Coral Red:** For high-risk exposure; tuned to be visible and urgent without inducing panic.
- **Backgrounds:** The primary interface uses a tiered white/light-gray system (`#F8FAFC`) to separate data containers from the application canvas.

## Typography

Typography is the primary tool for hierarchy in this design system. 

- **Headlines:** Hanken Grotesk provides a sharp, contemporary feel that distinguishes the product from legacy enterprise software.
- **Body:** Inter is used for all functional text to ensure maximum legibility at various sizes.
- **Data & Financials:** JetBrains Mono is employed for financial figures, risk scores, and technical IDs to ensure numerical alignment and a "calculated" feel.
- **Mobile Adjustments:** For `display-lg`, reduce font size to `32px` on mobile devices to prevent overflow in data dashboards.

## Layout & Spacing

The system follows a **12-column fixed grid** for desktop dashboards, centered with a maximum width of 1440px to prevent excessive eye travel during data analysis.

- **Rhythm:** A 4px baseline grid governs all spacing.
- **Margins:** Generous 32px external margins provide the "Executive" airiness required for the brand style.
- **Grouping:** Use `stack-lg` (32px) to separate distinct functional modules (e.g., Financial Impact vs. Threat Landscape). Use `stack-sm` (8px) for internal element relationships like labels and their respective inputs.

## Elevation & Depth

To maintain a clean, professional aesthetic, this design system avoids heavy shadows. Depth is communicated through **Tonal Layering** and **Subtle Outlines**.

- **Level 0 (Canvas):** Background color `#F8FAFC`.
- **Level 1 (Cards/Modules):** Pure white background with a 1px border in `#E2E8F0`. No shadow.
- **Level 2 (Dropdowns/Popovers):** Pure white background with a 1px border and a very soft, diffused shadow (`0 10px 15px -3px rgba(15, 23, 42, 0.08)`).
- **Interactive States:** On hover, a card may transition its border color to the Primary Blue, but should not "lift" off the page.

## Shapes

The shape language is **precise and disciplined**. 

A "Soft" (`0.25rem`) corner radius is applied to almost all elements—buttons, input fields, and small UI components. This provides just enough approachable warmth without losing the professional, rigorous feel of a strategic tool. 

Larger containers like dashboard cards may use `rounded-lg` (0.5rem) to subtly distinguish them from the UI's smaller functional atoms.

## Components

### Buttons & Interaction
- **Primary Button:** Solid Trust Blue (`#0F172A`) with white text. High-contrast, sharp corners (4px).
- **Secondary Button:** Ghost style with a 1px border of `#CBD5E1`.
- **Sliders:** Used for risk appetite and "What-if" simulations. Track should be thin (2px) in Slate 200, with a solid Primary Blue circular handle.

### Financial Scorecards
These are the core of the CRQ platform. They should feature a `data-mono` figure (e.g., $1.2M) as the hero element, with a small semantic "Risk Trend" arrow (up/down) next to it.

### Data Visualization
Charts should utilize the semantic risk colors. For complex line graphs, use a 2px stroke width and avoid area fills to maintain the minimalist aesthetic. 

### Inputs & Toggles
- **Input Fields:** Minimalist design with a 1px bottom border that transforms into a full 1px box on focus.
- **Toggles:** Small, rectangular toggles that mimic physical high-end switches, moving from Slate 300 (Off) to Primary Blue (On).

### Risk Chips
Small, high-contrast labels used for categorizing threats. Use low-saturation backgrounds of the semantic colors with high-saturation text to ensure readability (e.g., Light Emerald background with Dark Emerald text).