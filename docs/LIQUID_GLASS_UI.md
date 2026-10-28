# Liquid Glass UI System

**Product:** Lucky Bajaj Agency  
**Software provider:** QuantaEdge  
**Status:** shared visual system applied to the React web shell, sign-in, notification studio/inbox, workshop, sales and spare-parts surfaces.

## Visual intent

The app uses a calm, premium glass-on-canvas look rather than applying blur to every element. The canvas uses soft cool-blue and warm-orange light; large structural surfaces use translucent white layers with a fine edge, a top highlight and a restrained shadow. Orange is reserved for primary actions and selected navigation. Status colors communicate business state, not decoration.

## Surface hierarchy

1. **Canvas:** layered soft radial gradients behind the page. This is decorative only and never carries information.
2. **Primary glass:** sticky topbar, main panels, workshop job detail, sales panels, spare-parts panels, studio panels and inbox popover.
3. **Inset glass:** form groups, queue/detail blocks, selected records, preview frames and invoice sections. These use less transparency so labels, tables and monetary figures remain readable.
4. **Controls:** input, select and textarea backgrounds remain more opaque than the surrounding glass. Focus uses a visible orange outline. Status chips retain their semantic color and text.

## Shared CSS tokens

Defined in apps/web/src/styles.css:

- --glass-canvas: cool neutral page background.
- --glass-surface / --glass-surface-strong: translucent surface levels.
- --glass-border / --glass-edge: bright glass edges and neutral separators.
- --glass-shadow: diffuse depth plus a small close shadow.
- --glass-blur: primary backdrop blur level.
- --glass-highlight, --glass-inner, and --glass-inner-strong: highlights and nested surface opacity.

Blur and transparency are visual enhancements only; no text or state depends on them. A @supports fallback provides opaque surfaces when backdrop filters are unavailable.

## Consistency rules

- Reuse the current semantic component classes; do not add page-specific competing design systems.
- Keep all surfaces within the same radius, border and shadow family. Stronger blur belongs on large containers; dense rows and inputs use restrained effects.
- Use the same selected/hover grammar for navigation, tabs, search results and selected records.
- Tables retain horizontal overflow on small screens instead of compressing essential columns until unreadable.
- Preserve orange primary actions, neutral secondary actions, visible business statuses and plain-language validation messages.
- Avoid making every small element a translucent card. Use whitespace and separators to preserve hierarchy.

## Accessibility and resilience

- Focus-visible outlines must remain visible above glass surfaces.
- Text contrast must be checked against the actual surface, not the decorative background behind it.
- Motion is reduced when prefers-reduced-motion: reduce is enabled.
- Browsers without backdrop-filter support fall back to opaque backgrounds.
- Glass cannot be the only distinction for status: status labels remain visible as text.
- Mobile breakpoints reduce blur and stack controls, rather than shrinking the interaction targets.

## Release checks

For any future UI change, run the React production build and manually verify at minimum:

- desktop and phone-width layouts;
- sign-in and staff shell navigation;
- notification studio, approval state and inbox popover;
- sales pipeline list, enquiry detail and forms;
- workshop appointment/job-card/estimate/billing steps;
- spare-part catalogue, receipt entry, stock movement and reservation actions;
- keyboard focus, disabled controls, error/success messages and text contrast.

Do not modify business workflow, API contract or authorization solely to achieve a visual effect. Any visual changes to financial screens must preserve invoice disclaimers, balance labels, payment receipt state and handover gates.
