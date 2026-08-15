# Spec: Milkdown upgrade migration (7.5.x → 7.21.2 + Crepe)

> **Status**: ✅ Completed (v1.1.0)

## Overview

Migrate the project from the legacy `@milkdown/*` standalone package set to `@milkdown/kit@7.21.2` + `@milkdown/crepe@7.21.2`.

## Final Architecture

```
Dependencies: @milkdown/kit + @milkdown/crepe (2 packages; the old 8 are removed)
Entry:        CrepeBuilder → .addFeature(codeMirror) + .addFeature(table) + .addFeature(latex) + .addFeature(topBar) + .addFeature(toolbar) + .addFeature(linkTooltip)

Feature layer:
  Code block   ← Crepe feature/code-mirror core + custom enhancements (fullscreen button, copy feedback, styles)
  Table        ← Crepe feature/table (native drag reorder, insert/delete, column alignment); cellClickFixPlugin fixes click behavior
  Image        ← Custom NodeView (resize handle, caption, lightbox, image picker, load retry)
  Toolbar      ← Crepe feature/top-bar + buildTopBar (Undo/Redo, image, clear format, settings) + custom tooltip injection
  Link         ← Crepe feature/link-tooltip (deleted the original linkPopup ~680 lines)
  Sel. toolbar ← Custom selectionToolbar (paragraph format, inline format, table alignment/delete)
  TOC          ← Custom
  Search       ← Custom FindBar
  Mermaid      ← Custom codeMirror renderPreview callback
  Auto-save    ← Provider layer
  Brand badge  ← Pure CSS ::after "EPYTOR🦖"
```

## Enabled / Unenabled Crepe Features

| Feature | Decision | Notes |
|---------|----------|-------|
| `feature/code-mirror` | ✅ | Core, layered with custom enhancements |
| `feature/table` | ✅ | Native drag reorder + column alignment; single-click behavior fixed by cellClickFixPlugin |
| `feature/latex` | ✅ | KaTeX rendering + CodeMirror editing |
| `feature/top-bar` | ✅ | buildTopBar injects custom buttons |
| `feature/toolbar` | ✅ | Crepe selection floating toolbar (coexists with our custom selectionToolbar) |
| `feature/link-tooltip` | ✅ | Replaces the custom linkPopup |
| `feature/list-item` | ✅ | Crepe list-item handling |
| `feature/image-block` | ❌ | Not enabled; keep the custom imageView |

## Custom Feature List

| Feature | File | Description |
|---------|------|-------------|
| Image NodeView | `webview/components/imageView/` | Zoom, caption, lightbox, toolbar |
| Image picker | `webview/components/imagePicker/` | Three tabs: upload / project library / URL |
| Selection toolbar | `webview/components/selectionToolbar/` | Paragraph format + inline format + table operations |
| TOC panel | `webview/components/toc/` | Auto-generated, pinnable, resizable |
| Search | `webview/components/findBar/` | Cmd/Ctrl+F |
| Path completion | `webview/components/pathLink/` | @/, ./, ../ triggers |
| Mermaid | webview/editor.ts renderPreview | Inline rendering, light/dark theme |
| Code fullscreen | webview/index.ts addFullscreenBtn | DOM injection into .tools-button-group |
| Top-bar tooltip | webview/index.ts setupTopBarTooltips | DOM scan + i18n tooltip injection |
| Brand badge | webview/style.css | ::after pseudo-element |
| Table click fix | webview/editor.ts cellClickFixPlugin | filterTransaction + appendTransaction |
| Theme bus | webview/utils/themeBus.ts | MutationObserver watching body class |

## Tech Debt

See the tech debt list at [docs/roadmap.md](../roadmap.md).

## Code Reduction

Old 8 `@milkdown/*` packages → unified into `@milkdown/kit`. Custom table/link/toolbar code replaced by native Crepe. Net reduction ~2,400 lines.

## Build

`esbuild.mjs` bundles KaTeX + CodeMirror + Vue (Crepe is already compiled), producing `dist/extension.js` + `dist/webview.js`.
