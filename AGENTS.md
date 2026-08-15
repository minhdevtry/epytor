# Project Instructions — epytor

## Language

* **Reply to users in Vietnamese**

***

## Requirements

* New feature design docs go in `docs/specs/`, filename `YYYY-MM-DD-<feature-name>.md`
* Write the spec before development — define the requirement scope, interaction boundaries, and acceptance criteria
* See [Development → Configuration Reference](#configuration-reference) for settings

***

## Development

### Basic Rules

* **Package manager**: must use `pnpm`; npm/yarn are forbidden
* **Build**: run `pnpm build` after every code change to verify compilation
* **Debug**: F5 launches the extension debug instance (`.vscode/launch.json`)
* **Language**: TypeScript only; extension side uses `tsconfig.json`, WebView side uses `tsconfig.webview.json`
* **Dual-target build**: `dist/extension.js` (Node.js) + `dist/webview.js` (Browser), built by `esbuild.mjs`
* **Git commit convention**: commit message **in Chinese**, type prefix kept in English (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, etc.). Example: `feat: add XXXX feature`, `fix: fix XXXX issue`
* **Per-item commits**: every independent task in the todo list **must** be committed separately; multiple todos must never be mixed into one commit (so issues can be traced back precisely)
* **Honesty principle**: when uncertain, just say "not sure"; never fabricate URLs, issue numbers, API endpoints, doc references, or any factual information
* **Elegance principle**: hacks and patch-style writing are forbidden; prefer framework/library official APIs, CSS variables, configuration callbacks, and other clean approaches
* **Self-check principle**: after moving/extracting code you **must** search to confirm the old location is deleted; no dead code or same-name shadowing; before marking a roadmap item as done, list what is actually completed and what is not — never mark partial completion as full completion
* **Verification principle**: when citing file locations, function names, or call relationships, grep to confirm before writing; never rely on memory

### Architecture Constraints

* WebView ↔ Extension communication goes **only** through the functions in `webview/messaging.ts`
* The WebView side does not `import` the VSCode API directly; it gets a handle via `acquireVsCodeApi()`
* CSS must use `--vscode-*` variables to adapt to light/dark themes
* Do not maintain global state outside of modules (singletons excepted, e.g. editor view)

### Key File Reference

```
src/extension.ts                         — Extension entry, registers CustomEditorProvider
src/MarkdownEditorProvider.ts            — Provider core (message routing, auto-save, revert)
src/utils/getNonce.ts                    — CSP nonce generation
src/utils/imageService.ts               — Image local save (MD5 dedup) + server upload
src/i18n/webviewTranslations.ts         — WebView translation data
webview/index.ts                         — WebView entry (message routing, DOM event delegation, brand badge injection)
webview/editor.ts                        — CrepeBuilder entry (Milkdown 7.21.2 + Crepe native features registration)
webview/messaging.ts                     — WebView ↔ Extension message protocol (the only communication layer)
webview/style.css                        — VSCode theme coverage (--vscode-* CSS variables, overriding Crepe components)
webview/i18n/index.ts                    — t() / kbd() translation functions
webview/ui/icons.ts                      — SVG icons
webview/ui/tooltip.ts                    — Tooltip component
webview/utils/themeBus.ts               — Mermaid/CodeMirror light/dark theme unified event bus
webview/components/selectionToolbar/index.ts — Selection change callback (drives source line number mapping)
webview/components/toc/index.ts         — Table of Contents (TOC) panel (below the sticky toolbar, pinnable, resizable)
webview/components/imageView/index.ts   — Image NodeView (select / lightbox / toolbar / resize handle)
webview/components/findBar/index.ts     — In-editor find bar (Cmd/Ctrl+F)
webview/components/pathLink/            — Path link auto-completion
webview/headingIds.ts                    — Heading id management (does not touch DOM, only keeps the signature)
docs/specs/                              — Feature spec documents
docs/roadmap.md                          — Project roadmap (user-facing feature planning)
docs/tech-debt.md                        — Tech debt list (developer-facing code improvements)
```

### Configuration Reference

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `epytor.autoSave` | boolean | `true` | Auto-write to disk after editing |
| `epytor.autoSaveDelay` | number | `1000` | Debounce delay (ms) |

***

## Testing

### Tech Stack

| Layer | Framework | Scope |
| :--- | :--- | :--- |
| Extension unit tests | **Vitest 2.x** (Node environment) | `src/utils/`, `src/MarkdownDocument.ts` |
| WebView unit tests | **Vitest 2.x + jsdom 24.x** | `webview/utils/`, `webview/messaging.ts` |
| Integration tests (planned) | **@vscode/test-electron + Mocha** | Requires a real VSCode Extension Host |

The `vscode` module is mocked uniformly through `__mocks__/vscode.ts` and injected by `resolve.alias` in `vitest.config.ts`; do not call `vi.mock("vscode")` inside individual test files.

### Commands

```bash
pnpm test              # Run all unit tests once
pnpm test:watch        # Watch mode (use during development)
pnpm test:coverage     # Run tests and generate coverage report (coverage/)
```

### Directory and Naming

```
src/__tests__/           — Extension-side unit tests (Node environment)
webview/__tests__/       — WebView-side unit tests (jsdom environment)
webview/__tests__/setup.ts  — jsdom global setup (injects acquireVsCodeApi)
shared/__tests__/        — Shared type tests
__mocks__/vscode.ts      — vscode API unified mock
```

* Test file naming: `<module-name>.test.ts`, same name as the file under test
* Test structure follows the **AAA principle** (Arrange / Act / Assert), with `describe` → `it` two layers
* `it` description format: `input condition should expected result` (Chinese)

### Coverage Requirements

| Module | Minimum line coverage |
| :--- | :--- |
| `src/utils/imageService.ts` | ≥ 85% |
| `src/utils/getNonce.ts` | 100% |
| `src/MarkdownDocument.ts` | ≥ 80% |
| `src/utils/contentTransform.ts` | ≥ 90% |
| `src/utils/lineMap.ts` | ≥ 90% |
| `webview/utils/slug.ts` | ≥ 90% |
| **Overall** | ≥ 70% |

### Mandatory Workflow

Every code change (bug fix, new feature, refactor debt repayment) must complete the full workflow below:

```
Code change → pnpm build → pnpm test → output manual test checklist → vscode_askQuestions item-by-item confirmation → git commit
```

Detailed requirements for each stage:

**Stage 1: Automated Verification**

1. Run `pnpm build` to confirm compilation succeeds
2. Run `pnpm test` to confirm all tests pass
3. If any fail, fix them first; do not skip

**Stage 2: Manual Acceptance**

1. **Output manual test checklist**: list the affected interaction paths and acceptance points, one per line, numbered in order
2. **Item-by-item confirmation**: pop up a confirmation dialog via `vscode_askQuestions` (≤4 items per screen; split if more)
3. Developer selects "✅ Pass" or "🛑 Has Issue" for each item
4. All pass → proceed to Stage 3; any fail → fix and restart from Stage 1

**Stage 3: Commit**

Only then may you `git commit` (follow the [per-item commits](#basic-rules) rule)

***

**After feature development** additional requirements:

* Write corresponding unit tests (at least one case each for core logic, edge values, and error paths)

**After bug fixes** additional requirements:

* First add a **test case that reproduces the bug** (in the same commit as the fix)
* Confirm the case fails before the fix and passes after

**Before `git push`**:

* **Must** run `pnpm test`; all must pass before pushing

### Test Failure Handling

```
Test failed
  │
  ├─ Is it a newly introduced failure? → Locate the code change, fix it and rerun
  │
  ├─ Does the test expectation not match the implementation (intentional change)? → Update the test in sync
  │
  └─ Is it an environment/dependency issue? → Check jsdom version, vscode mock completeness
```

**Forbidden behavior**:

* Skipping (`it.skip`) or commenting out failing test cases to make CI pass is forbidden
* Modifying test expected values to mask a bug is forbidden (unless the implementation has been intentionally changed and reviewed)
* Pushing to `main` or `dev` without running tests is forbidden

### Mock Conventions

* Each `describe` block calls `vi.clearAllMocks()` in `beforeEach` to reset mock state
* Filesystem operations uniformly mock `vscode.workspace.fs` (real `fs` writes to disk are forbidden)
* Time-dependent logic uses `vi.useFakeTimers()` / `vi.useRealTimers()`; do not actually wait via `setTimeout`
* Do not test `private` class methods; verify behavior through public interfaces

### CI Automation

Every push/PR to `main`/`dev` automatically runs tests + coverage checks + build verification; see `.github/workflows/ci.yml` for config.

***

## Release

### Document Roles

| File | Purpose | Update Timing |
| :--- | :--- | :--- |
| `README.md` / `README.zh-CN.md` | User docs: feature overview, install, settings, **known limitations** | When features change or new limitations are discovered |
| `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md` | Contribution guide: dev environment, submission flow, bug reports | When dev flow or branch strategy changes |
| `CHANGELOG.md` / `CHANGELOG.zh-CN.md` | Version change log ([Keep a Changelog](https://keepachangelog.com/) format), **English first, Chinese second** | **When releasing a new version** |

### Release Workflow (must follow in order)

**Stage 1: Content Confirmation** (before editing)

Before performing any edit, show the following to the user for confirmation item by item:

1. Whether `README.md` + `README.zh-CN.md` have release-related changes
2. The full content of the new version section in `CHANGELOG.md` + `CHANGELOG.zh-CN.md`
3. Whether any items in `docs/roadmap.md` need to be marked done or adjusted
4. `package.json` version number
5. Merge commit message
6. Tag annotation content

***

**Stage 2: Edit & Verify**

1. **Confirm all changes are committed to the `dev` branch**
2. **Update `CHANGELOG.md` and `CHANGELOG.zh-CN.md`**: the new version section goes at the top of the file
3. **Update the `package.json` version number**
4. **Run `pnpm test`** to confirm all tests pass
5. **Run `pnpm build`** to confirm compilation succeeds

***

**Stage 3: Final Confirmation** (after editing, before release)

After all edits are done, **show the user the actual changes again for confirmation** (CHANGELOG diff, version number, commit message, tag annotation); only after the user confirms may you continue.

***

**Stage 4: Release**

6. **Merge `dev` → `main`**: `git checkout main && git merge dev --no-ff -m "chore: merge dev → main, release v<VERSION>"`
7. **Push both branches**: `git push origin dev main`
8. **Tag to trigger release**: `git tag -a v<VERSION> -m "v<VERSION>: <brief summary>" && git push origin v<VERSION>`
9. **Switch back to `dev`**: `git checkout dev`

### CI Automation

After pushing a `v*.*.*` tag, automatically package the VSIX, publish to VS Code Marketplace, and create a GitHub Release; see `.github/workflows/release.yml` for config.

***

## Issue Management

### Label System

| Label | Purpose |
| :--- | :--- |
| `bug` | Confirmed bug |
| `bug` + `known-limitation` | Known limitation (issue still present after development) |
| `enhancement` + `roadmap` | Planned feature (in the roadmap) |
| `enhancement` | Other feature improvements |

### Roadmap Linkage

* When issue status changes affect the roadmap, update `docs/roadmap.md` in sync
* If a roadmap item has a corresponding issue, annotate the issue number in the roadmap

### Templates

Issues use `.yml` Issue Forms (structured forms); template files are in `.github/ISSUE_TEMPLATE/`:

| Template | File | Auto Label |
|------|------|----------|
| Bug report | `bug_report.yml` | `bug` |
| Feature request | `feature_request.yml` | `enhancement` |

* `blank_issues_enabled: false` (in `config.yml`) forces template usage; blank issues are not allowed

* Labels are set automatically by the template's `labels:` field; users do not need to select them manually

* Non-bug feature discussions are routed to [Discussions](https://github.com/peiyucn/epytor/discussions)

* **Trigger during development**: when any of the following occur, proactively remind the user to create an issue:

  * You discover a bug that cannot be fixed in this round
  * You come up with a new feature idea but are not developing it yet
  * You discover a tech debt item that needs recording
  * Example prompt: "This bug can't be fixed for now — would you like me to create an Issue to track it?"

***

## Roadmap

The project roadmap is at `docs/roadmap.md`; **record future plans only** — do not include already-released version content.

Update it synchronously when planning new features or when stage progress changes.

***

## Upstream Limitations

The following limitations come from upstream dependencies such as Milkdown / Crepe / ProseMirror, and EPYTOR cannot fix them on its own. When upgrading upstream dependencies, verify each item one by one to see whether it has been resolved.

| # | Limitation | Source | Tracking |
|---|------|------|------|
| 1 | Inline styles (bold, italic, inline code, etc.) at the end of content cannot exit | Milkdown | [Milkdown#2413](https://github.com/Milkdown/milkdown/issues/2413) |
| 2 | Ordered list multi-level numbering is all decimal (no a.b.c. / i.ii.iii. distinction) | Milkdown kernel | [Milkdown#2415](https://github.com/Milkdown/milkdown/issues/2415) |
| 3 | Table single-click cell selection is temporarily disabled | Crepe | [Milkdown#2414](https://github.com/Milkdown/milkdown/issues/2414) |

**Maintenance rules**:

* When a new upstream limitation is discovered, append it to this table and mark it `⚠️ Upstream` in each `README` known limitations section
* When upgrading dependencies, verify each item in this table; remove resolved entries and write them under Fixed in the CHANGELOG
* Prefer filing issues in the corresponding upstream repo and put the link in the "Tracking" column
* **When filing an upstream issue, follow the other side's template spec**: title should have a `[Bug]` or `[Feature]` prefix; body should be structured (repro steps / expected / actual / environment). If the other side uses `.yml` Issue Forms, the `gh issue create` CLI cannot trigger template validation, so manually align with the fields required by the template
