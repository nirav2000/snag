# Snag visual themes

The live application keeps a stable base stylesheet (`styles.css`). Visual experiments should be added as separate theme layers rather than editing the base design wherever possible.

## Current theme

`theme-coral.css` is the Image-4-inspired theme. It is loaded after `styles.css` and `notes.css` in `index.html`, so it overrides presentation without changing application behaviour.

To revert to the previous design, remove or disable only the `theme-coral.css` link from `index.html`.

## Future themes

Examples: `theme-classic.css`, `theme-coral.css`, `theme-dark.css`, `theme-editorial.css`. Only one theme should normally be active. A later theme switcher can change the final stylesheet link or save the selected theme in local storage.

## Rules

1. Theme files change colour, typography, radii, shadows, spacing and related presentation.
2. Avoid changing IDs, data attributes or DOM structure in a theme.
3. App behaviour must not depend on a theme file.
4. If a design needs structural UI changes, implement those separately and keep the visual skin independent.
5. Prefer CSS custom properties at the top of a theme so palette changes remain centralised.

## Landing page

`welcome.html` uses `welcome-v4.css` because the public landing page has different layout needs from the application. It uses `snag-mark-v4.svg`.

The current landing-page direction is based on option 4: split hero, before/after issue imagery, four equal process cards, a dark multi-use strip and staged product access rather than invented prices.

## Photographic media

The public landing page remains HTML/CSS-driven. Photographs are individual responsive assets, not a single screenshot of the page. Use-case photographs use `object-fit: cover`, and the hero composition reflows at tablet and phone breakpoints. This keeps text, buttons, app mock-ups and pricing accessible and independently editable.

The current landing page uses remotely hosted Unsplash imagery for the photographic layers. If Snag moves to production hosting, these assets should be copied into the Snag media/CDN bucket so the page has no third-party image dependency.
