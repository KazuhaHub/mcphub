# TypeScript and frontend conventions

- Use `.js` extensions for relative ESM imports, including in TypeScript files.
- Keep TypeScript strict; narrow types or define shared types instead of using `any` as a workaround.
- Write code comments in English.
- Follow the repository formatter: two-space indentation and single quotes. Use the flat [eslint.config.mjs](../../eslint.config.mjs) ESLint configuration.
- Name services and DAOs with `Service` and `Dao` suffixes.
- Name React components and their files in `PascalCase`; name utility modules in `camelCase`.
- Put shared types in [src/types/](../../src/types/) instead of redefining DTOs locally.
- When adding a translation key, add it to every locale file in `locales/`: `locales/en.json`, `locales/es.json`, `locales/fr.json`, `locales/tr.json`, `locales/vi.json`, and `locales/zh.json`. The backend discovers locales from the directory (see [src/utils/i18n.ts](../../src/utils/i18n.ts)), but the frontend registers each locale explicitly in [frontend/src/i18n.ts](../../frontend/src/i18n.ts) and lists it in [frontend/src/components/ui/LanguageSwitch.tsx](../../frontend/src/components/ui/LanguageSwitch.tsx).

## Settings and feature management

- When adding user-facing configuration, provide matching controls in the existing settings UI, including defaults, validation, permission checks, and translations. Configuration-file or API support alone does not complete a dashboard-managed feature.
- When a feature creates user-managed state such as application authorizations, provide a discoverable page to inspect and revoke it. Keep personal controls available to ordinary authenticated users and restrict global settings to their existing permissions.
- Verify saving and reloading settings and the relevant management actions in a running browser. Include screenshots in the PR as required by [git-and-contribution.md](git-and-contribution.md).

## Phone layout

- The app shell switches at Tailwind's `md` breakpoint (768px). Below it the sidebar is an off-canvas drawer owned by [frontend/src/layouts/MainLayout.tsx](../../frontend/src/layouts/MainLayout.tsx); its open/collapsed state lives in [frontend/src/utils/sidebarState.ts](../../frontend/src/utils/sidebarState.ts) and its focus, Escape and scroll-lock handling in [frontend/src/hooks/useModalDrawer.ts](../../frontend/src/hooks/useModalDrawer.ts).
- Check new pages at 375px and 390px: `document.documentElement.scrollWidth` must not exceed the viewport width. Measure against the intended width, not `innerWidth`, because a mobile-emulated viewport widens to fit overflowing content.
- Page headers use `flex flex-wrap` so their action buttons wrap. Grid-based table rows (`hub-row`) add the `stack` modifier to become two-line cards on phones; wide real tables sit in a `hub-scroll-x` wrapper that scrolls inside the card and pins the first column.
- Keep icon buttons in the top bar at 40px or larger on phones.
