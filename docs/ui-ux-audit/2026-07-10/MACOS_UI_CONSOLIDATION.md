# macOS UI consolidation completion matrix

This file is the authoritative implementation checklist for the July 10, 2026
Hermes Desktop UI/UX audit. An item is complete only when the code change and
the named validation evidence both exist.

## Product invariants

- Preserve the current black, charcoal, and warm-gold identity.
- Preserve markdown-on-disk storage and every existing product capability.
- Prefer deletion and consolidation over new presentation layers.
- At compact widths, show one primary work surface instead of compressing
  navigation, content, and inspector until labels clip.
- Use one semantic meaning for selection, primary, success, warning, danger,
  information, and neutral states.

## Shell and visual system

- [x] Replace window-only responsive behavior with explicit compact, standard,
      and expanded workspace states derived from usable content width.
- [ ] Prevent horizontal clipping at the 900px minimum window and the smoke
      harness's 1100x802 logical viewport.
- [x] Keep a meaningful macOS title/drag region and platform-like toolbar.
- [x] Make the trailing inspector collapse or overlay before document content
      becomes cramped.
- [ ] Consolidate surface, separator, text, control, focus, and semantic tokens.
- [x] Make the macOS system font the first UI font; reserve serif for authored
      content and mono for code/data.
- [ ] Standardize buttons, fields, page headers, sections, inspectors, tabs,
      status messages, toasts, and empty states.
- [ ] Remove page-local application backgrounds and decorative glass from
      ordinary content.
- [ ] Replace routine card wrappers with spacing, section headings, lists,
      tables, and separators.
- [ ] Standardize keyboard focus and icon-only control labels/hit areas.

## Navigation and settings

- [ ] Reduce the sidebar to Core, Library, optional Packs, and More.
- [x] Remove generated Content Studio storage pages from everyday navigation.
- [x] Move the dominant New Chat action into the Assistant surface/toolbar.
- [x] Keep connection status compact and move global Settings to the app-level
      command/profile path.
- [ ] Use one functional icon language; page emoji remains content metadata.
- [ ] Make Home one stable product concept.
- [x] Replace the full-screen Control Center overlay with a single settings
      presentation that has one navigation model and one close path.
- [ ] Keep global appearance/preferences in Settings and limit Workspace
      settings to local layout controls.

## Core surfaces

- [ ] Home/document: remove duplicate page identity and persistent onboarding
      chrome.
- [ ] Dashboard: remove the tilted/inverted scratchpad and simplify into a calm
      Today overview.
- [ ] Search: use a compact command/search presentation and show preview only
      for document results.
- [ ] Document editor: one title, subordinate metadata, readable line length.
- [x] Document inspector: labels never clip; less-used tabs move to overflow.
- [ ] Query database: use available width and make row creation on demand.
- [ ] Graph: remove dashboard-card framing; toolbar owns graph controls and the
      inspector owns selection detail.
- [ ] Insights: provide a contextual empty state and primary action.

## Workflow surfaces

- [ ] Work: focus on Today, Next, Scheduled, Delegated, and Review.
- [ ] Journal: remain a distinct secondary destination, not the Work default.
- [ ] Learning: use a clear list/detail structure and move Advanced creation
      into developer settings.
- [ ] Research: become a persistent search/history surface; use sheets only for
      short scheduling/options decisions.
- [ ] Content Studio: expose Ideas -> Run -> Draft -> Evidence -> Publish ->
      Analytics as a staged workflow, not one continuous mega-form.
- [ ] Content Studio: use typed success/warning/error feedback; successful runs
      must never render with error styling.
- [ ] RSS: use the shared SPS surface language and a sidebar/list/detail layout;
      Capture becomes a sheet or toolbar popover.
- [ ] Deck Studio: retain navigator/canvas/inspector, make the inspector
      collapsible, and use a compact export sheet with Reveal in Finder.
- [ ] Health: use shared tokens, conservative tabs/forms/results, explicit units,
      and no novelty emoji or separate navy application skin.
- [ ] Quick Capture: use a focused macOS utility-window hierarchy, title case,
      compact type selection, secondary attachment tools, and one Save action.

## Responsive and accessibility acceptance

- [ ] Verify every named surface at compact (900x700), standard (1100x802), and
      expanded (1440x900) logical sizes.
- [ ] No meaningless label truncation, horizontal page clipping, or hidden
      primary action at any acceptance width.
- [ ] Loading, empty, error, success, disabled, hover, pressed, and focus states
      are visually distinguishable without relying on color alone.
- [ ] Keyboard navigation, Escape behavior, focus visibility, accessible names,
      and reduced-motion behavior pass focused checks.
- [ ] Text contrast meets 4.5:1 for normal text and 3:1 for large text/UI
      boundaries where WCAG applies.

## Required completion evidence

- [ ] Focused Vitest suites for every migrated surface.
- [ ] `npm run typecheck`.
- [ ] ESLint on every touched source file with zero errors.
- [ ] Full `npx vitest run` outside sandbox when loopback tests require it.
- [ ] `npm run build`.
- [ ] `node scripts/sps-smoke.mjs` with all steps passing.
- [ ] `node scripts/sps-surfaces-smoke.mjs` with all steps passing.
- [ ] Compact, standard, and expanded screenshot sets visually reviewed against
      this matrix.

## Implementation evidence

### Shell phase

- `App.test.tsx`: compact, standard, and expanded content-width states plus
  compact inspector closure; 5 tests passing.
- `RightPanel.test.tsx`: explicit close and labelled overflow navigation; 2
  tests passing.
- Both TypeScript projects and touched-file ESLint pass.
- `npm run build` passes.
- Primary Electron smoke passes all 29 steps after the inspector navigation
  harness was updated to exercise the overflow menu.

### Navigation and Settings presentation phase

- `Sidebar.test.tsx`: Content Studio's generated page subtree is hidden, the
  duplicate New Chat launcher is absent, and Appearance plus Settings route
  through one profile menu; 4 tests passing.
- `App.test.tsx`: Settings opens as one labelled dialog with one close path;
  8 tests passing.
- Both TypeScript projects, touched-file ESLint, and `npm run build` pass.
- Primary Electron smoke passes all 29 steps through the new profile-menu path.
- `01-home.png`, `02d-control-center.png`, and `04-tweaks.png` were reviewed at
  the standard smoke viewport; the modal is bounded and the sidebar has no
  duplicate New Chat action or generated Content Studio subtree.
