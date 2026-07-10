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
- [x] Prevent horizontal clipping at the 900px minimum window and the smoke
      harness's 1100x802 logical viewport.
- [x] Keep a meaningful macOS title/drag region and platform-like toolbar.
- [x] Make the trailing inspector collapse or overlay before document content
      becomes cramped.
- [x] Consolidate surface, separator, text, control, focus, and semantic tokens.
- [x] Make the macOS system font the first UI font; reserve serif for authored
      content and mono for code/data.
- [x] Standardize buttons, fields, page headers, sections, inspectors, tabs,
      status messages, toasts, and empty states.
- [x] Remove page-local application backgrounds and decorative glass from
      ordinary content.
- [x] Replace routine card wrappers with spacing, section headings, lists,
      tables, and separators.
- [x] Standardize keyboard focus and icon-only control labels/hit areas.

## Navigation and settings

- [x] Reduce the sidebar to Core, Library, optional Packs, and More.
- [x] Remove generated Content Studio storage pages from everyday navigation.
- [x] Move the dominant New Chat action into the Assistant surface/toolbar.
- [x] Keep connection status compact and move global Settings to the app-level
      command/profile path.
- [x] Use one functional icon language; page emoji remains content metadata.
- [x] Make Home one stable product concept.
- [x] Replace the full-screen Control Center overlay with a single settings
      presentation that has one navigation model and one close path.
- [x] Keep global appearance/preferences in Settings and limit Workspace
      settings to local layout controls.

## Core surfaces

- [x] Home/document: remove duplicate page identity and persistent onboarding
      chrome.
- [x] Dashboard: remove the tilted/inverted scratchpad and simplify into a calm
      Today overview.
- [x] Search: use a compact command/search presentation and show preview only
      for document results.
- [x] Document editor: one title, subordinate metadata, readable line length.
- [x] Document inspector: labels never clip; less-used tabs move to overflow.
- [x] Query database: use available width and make row creation on demand.
- [x] Graph: remove dashboard-card framing; toolbar owns graph controls and the
      inspector owns selection detail.
- [x] Insights: provide a contextual empty state and primary action.

## Workflow surfaces

- [x] Work: focus on Today, Next, Scheduled, Delegated, and Review.
- [x] Journal: remain a distinct secondary destination, not the Work default.
- [x] Learning: use a clear list/detail structure and move Advanced creation
      into developer settings.
- [x] Research: become a persistent search/history surface; use sheets only for
      short scheduling/options decisions.
- [x] Content Studio: expose Ideas -> Run -> Draft -> Evidence -> Publish ->
      Analytics as a staged workflow, not one continuous mega-form.
- [x] Content Studio: use typed success/warning/error feedback; successful runs
      must never render with error styling.
- [x] RSS: use the shared SPS surface language and a sidebar/list/detail layout;
      Capture becomes a sheet or toolbar popover.
- [x] Deck Studio: retain navigator/canvas/inspector, make the inspector
      collapsible, and use a compact export sheet with Reveal in Finder.
- [x] Health: use shared tokens, conservative tabs/forms/results, explicit units,
      and no novelty emoji or separate navy application skin.
- [x] Quick Capture: use a focused macOS utility-window hierarchy, title case,
      compact type selection, secondary attachment tools, and one Save action.

## Responsive and accessibility acceptance

- [x] Verify every named surface at compact (900x700), standard (1100x802), and
      expanded (1440x900) logical sizes.
- [x] No meaningless label truncation, horizontal page clipping, or hidden
      primary action at any acceptance width.
- [x] Loading, empty, error, success, disabled, hover, pressed, and focus states
      are visually distinguishable without relying on color alone.
- [x] Keyboard navigation, Escape behavior, focus visibility, accessible names,
      and reduced-motion behavior pass focused checks.
- [x] Text contrast meets 4.5:1 for normal text and 3:1 for large text/UI
      boundaries where WCAG applies.

## Required completion evidence

- [x] Focused Vitest suites for every migrated surface.
- [x] `npm run typecheck`.
- [x] ESLint on every touched source file with zero errors.
- [x] Full `npx vitest run` outside sandbox when loopback tests require it.
- [x] `npm run build`.
- [x] `node scripts/sps-smoke.mjs` with all steps passing.
- [x] `node scripts/sps-surfaces-smoke.mjs` with all steps passing.
- [x] Compact, standard, and expanded screenshot sets visually reviewed against
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

### Settings information architecture phase

- Control Center Overview now contains only AI status and actionable readiness;
  it no longer repeats every sidebar destination as a card.
- Global theme, palette, accent, density, authored-content font, display zoom,
  and custom skin controls live in Preferences. Storage migration, vault
  location, OKF import/export, backups, and privacy controls live in Data &
  Privacy. The local Workspace settings panel contains only layout and sidebar
  controls.
- Ordinary Settings sections now use dividers and spacing instead of nested
  rectangular cards.
- Focused Control Center, Workspace appearance, Workspace storage, and local
  layout tests pass (9 tests); both TypeScript projects and the production build
  pass.
- Primary Electron smoke passes 31 steps, including dedicated Preferences and
  Data & Privacy screenshots. `02d-control-center.png`,
  `02e-settings-preferences.png`, `02f-settings-data-privacy.png`, and
  `04-tweaks.png` were visually reviewed.

### Core workspace surfaces phase

- Home now opens directly on the document, current-page identity appears only
  in the editable page title, and authored content is no longer preceded by a
  persistent onboarding/update strip. Parent breadcrumbs remain keyboard
  accessible in the toolbar.
- Dashboard is a restrained Today surface with New page/New task, a plain
  inline local scratchpad, and simple Pinned/Recent lists. The rotated post-it
  treatment and fabricated market, weather, news, sports, and schedule panels
  were removed.
- Command search is compact for commands and expands only when a highlighted
  page or in-page result has a document preview. Result rows are real buttons.
- Query database row creation is hidden until New row is requested; Escape and
  Cancel dismiss it. Graph summary, relation legend, toolbar, and canvas now
  form one full-width surface without a surrounding card or shadow.
- Insights has an explanatory no-usage state and Start a chat action; populated
  summary metrics use separators rather than cards.
- Focused Home, Dashboard, command-search, Query Database, Graph, and Insights
  suites pass (29 tests); both TypeScript projects and the production build pass.
- Primary Electron smoke passes 32 steps. `01-home.png`, `02-palette.png`,
  `02-dashboard.png`, `03-graph.png`, `06-querydb.png`, and
  `07-querydb-addrow.png` were visually reviewed at the standard viewport.

### Workflow and specialized workspace phase

- Work now has only Today, Next, Scheduled, Delegated, and Review; Journal is a
  separate More destination. Learning uses a list/detail workspace and keeps
  Skills/Curator creation in Advanced Settings. Research is persistent and
  retains local recent-history navigation.
- Content Studio renders a single six-stage workflow and uses icon-backed typed
  feedback. RSS uses list/detail navigation with a bounded Manage Feeds sheet.
  Deck Studio retains navigator/canvas/inspector with inspector collapse and a
  compact export sheet that reveals exports in Finder. Health and Quick Capture
  use shared SPS/macOS hierarchy with no novelty emoji.
- Focused migrated-surface suites pass. The full suite passes 366 files and
  2,785 tests (3 skipped). Touched-source ESLint passes with zero errors.

### Final responsive and runtime phase

- The production build and both TypeScript projects pass.
- Primary Electron smoke passes 80 screenshots/steps, including Home,
  Dashboard, Work, Assistant, Journal, Learning, Research, Graph, Insights,
  Health, RSS, Content Studio, Deck Studio, Query Database, Settings, and Search
  at 900x700, 1100x802, and 1440x900. Each step asserts that `.main` has no
  horizontal overflow.
- Secondary Electron surface smoke passes all 16 stateful workflows, including
  document persistence, DnD, Trash, scheduling, Journal, Health CRUD, and the
  offline clinical digest.
- Compact, standard, and expanded screenshot sets in `/private/tmp/sps-smoke`
  were visually reviewed. Compact mode uses the icon rail, closes the document
  inspector, and presents RSS as one primary pane. Dark-mode hover surfaces and
  toasts use theme-correct raised-surface tokens; normal tertiary text measures
  4.77:1 (light) and 4.85:1 (black dark) against its canvas.
