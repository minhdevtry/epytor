# EPYTOR🦖

[![Version](https://img.shields.io/github/package-json/v/peiyucn/epytor?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)
[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-epytor-blue?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=peiyucn.epytor-vscode)
[![License](https://img.shields.io/github/license/peiyucn/epytor?style=for-the-badge)](https://github.com/peiyucn/epytor/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge\&logo=typescript\&logoColor=white)]()
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge\&logo=pnpm\&logoColor=white)]()

[Simplified Chinese](README.zh-CN.md) | English | [GitHub](https://github.com/peiyucn/epytor)

A WYSIWYG Markdown editor for VS Code, powered by [Milkdown](https://milkdown.dev/). Edit `.md` / `.markdown` as rich text, saved as standard Markdown.

> Originally based on [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) (MIT) v0.1.6.
>
> v1.0.0 / v1.0.1: adapted for VS Code Marketplace, fixed critical issues (blank-line accumulation, table-cell enter).
>
> v1.1.0: rebuilt foundations (Milkdown 7.21.2 + Crepe / CodeMirror 6), new features (LaTeX math, image enhancements, toolbar, TOC).
>
> **v1.1.3 onwards: independently developed.** See [CHANGELOG](CHANGELOG.md).

## Features

* **Rich text**: headings, bold, italic, strikethrough, inline code, blockquote, horizontal rule, lists
* **LaTeX math**: inline `$...$` / block `$$...$$`, KaTeX rendering
* **Tables**: GFM tables, insert/delete rows & columns, drag reorder, column alignment
* **Code blocks**: CodeMirror 6 highlighting, language picker, copy, smooth pure CSS fullscreen
* **Mermaid diagrams 2.0**: modern HSL themes, smooth Bezier curves, interactive node path highlighting, 1-click HD PNG copy & SVG export
* **Images & Cloud Storage**: paste/drag/picker insert, drag resize, caption, local deduplicated storage, custom server, or **Cloudflare R2 (S3 API zero-dependency direct upload)**
* **TOC**: auto-generated, pinnable, click to navigate
* **Path autocomplete**: `@/`, `./`, `../` triggers directory browsing
* **Toolbars & Clean UI**: sticky top bar, floating selection toolbar, crisp vector SVG icons
* **Auto save**: writes to disk 1s after editing stops

## Settings

| Setting | Default | Description |
|---|---|---|
| `epytor.autoSave` | `true` | Auto save on edit |
| `epytor.autoSaveDelay` | `1000` | Auto save delay (ms) |
| `epytor.defaultMode` | `"wysiwyg"` | Default open mode |
| `epytor.editorMaxWidth` | `900` | Editor max width (px) |
| `epytor.fontFamily` | `""` | Editor font family |
| `epytor.codeBlockMaxHeight` | `600` | Code block max height (px) |
| `epytor.imageStorage` | `"local"` | Image storage: `local` / `r2` / `server` |
| `epytor.imageLocalPath` | `""` | Local image path |
| `epytor.r2.accountId` | `""` | Cloudflare Account ID for R2 storage |
| `epytor.r2.accessKeyId` | `""` | R2 S3 Access Key ID |
| `epytor.r2.secretAccessKey` | `""` | R2 S3 Secret Access Key |
| `epytor.r2.bucket` | `""` | R2 Bucket name |
| `epytor.r2.publicDomain` | `""` | R2 Public Domain (e.g. `https://r2.2tocom.space` or `https://pub-xxx.r2.dev`) |
| `epytor.r2.pathPrefix` | `"images/"` | Path prefix for uploaded images in R2 bucket |
| `epytor.debugMode` | `false` | Debug mode |

> See Settings UI for all options (`epytor.*`).

## Requirements

* VS Code **1.93.0**+

## Known Limitations

* ⚠️ Upstream — Table cell click-selection temporarily disabled (Crepe instability, clicks go to edit mode)
* ⚠️ Upstream — Ordered list multi-level numbering: decimal only (Milkdown kernel limitation)
* ⚠️ Upstream — Inline styles at paragraph end cannot exit to normal text ([Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413))
* Global search may not scroll precisely with multiple `.md` files open
* Some extended Markdown syntax (footnotes, inline HTML, etc.) not yet supported
* Narrow window (< 720px): toolbar auto-wraps — usable but less compact

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and submission guidelines. Coding and testing standards are maintained in [AGENTS.md](AGENTS.md).

