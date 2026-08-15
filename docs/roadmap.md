# EPYTOR Roadmap

> Last updated: 2026-08-16
> See [tech-debt.md](./tech-debt.md) for the tech debt list

***

## v1.3.x 🚀 (AI Knowledge Base & Advanced WYSIWYG)

### AI & Knowledge Base Features

* [ ] **YAML Frontmatter visual panel & schema autocompletion** — Edit tags, categories, metadata in an interactive top panel; perfect for personal RAG / Knowledge Base indexing.
* [ ] **Wikilinks & Bi-directional page links (`[[page]]`)** — Auto-complete links to other Markdown files in the workspace with real-time preview.
* [ ] **WYSIWYG Visual Diff for AI modifications** — Inline visual highlight of insertions/deletions when external AI extensions or Git edit markdown files.
* [ ] **Interactive Mindmaps (Markmap)** — Render interactive mindmaps with collapsible nodes directly from nested Markdown lists.

### Editor & Formatting Enhancements

* [ ] **Sticky heading + collapse** — Current section's heading sticks under the top bar while scrolling long documents; sibling headings can be collapsed/expanded.
* [ ] **Table wrap mode** — Support Shift+Enter soft wrap inside table cells, add the `epytor.tableWrapMode` setting.
* [ ] **Text alignment** — Paragraphs/headings support left/center/right/justified alignment.

***

## v1.2.x ✅ (Released: v1.2.0)

### Cloud Storage & Media

* [x] **Cloudflare R2 Image Storage** — S3 REST API SigV4 zero-dependency direct upload, custom public domain and bucket path prefix support.
* [x] **Paste/Drop duplicate image prevention** — `imagePastePlugin` middleware and capturing phase interception.

### Mermaid 2.0 Diagrams

* [x] **Modern HSL Themes & Bezier Curves** — Adaptive dark/light themes with smooth curves (`curve: 'basis'`).
* [x] **Interactive Flow Focus** — Hovering nodes highlights connected edges and dims background nodes.
* [x] **HD PNG & Vector SVG Export** — One-click 2x PNG clipboard copy and canvas modal export.

### UI & UX Polish

* [x] **Pure CSS Codeblock Fullscreen** — Preserves CodeMirror cursor state without DOM reparenting.
* [x] **Full Vector SVG Icon Overhaul** — Clean vector SVG icons replacing all emojis across menus, callouts, and dialogs.
* [x] **Callout Backspace clean removal** — No cursor trap in `font-size: 0`.
* [x] **Light theme contrast improvements** — Clean `--vscode-editorWidget-*` coverage.


***

## v1.1.x ✅ (Released: v1.1.0 \~ v1.1.3)

### Architecture Upgrades

* [x] Milkdown 7.5.x → 7.21.2 + Crepe
* [x] Prism → CodeMirror 6
* [x] Table / link / toolbar migrated to native Crepe implementations
* [x] Claude integration removed

### New Features

* [x] LaTeX math, image zoom and Caption, image picker, image load retry
* [x] Toolbar backdrop blur + sticky, brand badge, Undo/Redo/Clear Format/Settings buttons
* [x] Mermaid light/dark theme, TOC panel refinements, editor top margin 52px
* [x] H1-H6 heading style polish: h1 weight 700, h4 1.15em, h6 weight 400 + gray

### Fixed Bugs

* [x] **Incomplete clear-format** — `clear-format` only cleared bold/italic/strikethrough/inline code; need to verify links are cleared as well
* [x] **TOC click positioning inaccurate** — `domAtPos(pos + 1)` may not find the `<h1>`-`<h6>` element when the heading has inline formatting

### Completed Features

* [x] **One-click blockquote exit** — The blockquote toolbar button toggles instead
* [x] **Improved source/render toggle line positioning** — In-block proportional interpolation
* [x] **Narrow-window toolbar wrap** — container query + flex-wrap solution

### Design Decisions

* Line positioning: in-block proportional interpolation (Option A); no change to `computeLineMap` format, minimal change
* Blockquote fallback: use the native ProseMirror `lift` command to unwrap
