# Generic Site (minimal)

A basic generic placeholder site with Lorem Ipsum content, built on the
[Rathji-template](https://perchance.org/rathji-template) design system.

## What's here

- `main.pjs` — two pieces:
  1. Lorem ipsum lists + helpers: `loremWords`, `loremSentence(n)`, `loremParagraph(n)`.
  2. Vendored Rathji components (from `scratch/generators/rathji-template/`):
     `rathjiTemplate()` badges and `rathjiCard()` cards, plus their options/preset
     lists and helper functions. Call them from lists or JS.
- `index.html` — the site: fixed nav bar, settings panel (theme/accent/text-size/
  reduce-motion, persisted in localStorage, URL-overridable via `?theme=&accent=&size=&motion=`),
  login/forgot-password modals (decorative only), toasts, and lorem content:
  hero + badges, "What we do" card grid, "About" paragraphs + quote, CTA, contact, footer.
  The 🎲 "Reroll lorem ipsum" button (or `R`/`Space`) regenerates the content from
  the pjs lorem lists.

## How to customize

- Swap the lorem lists for real copy in `main.pjs`, or just replace the text in `index.html`.
- Accent color, theme, text size are in the nav ⚙️ Settings panel.
- The Rathji badge/card components are used in the `reroll()` function in `index.html`.
