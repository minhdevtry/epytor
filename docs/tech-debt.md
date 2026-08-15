# Tech Debt

> A code quality improvement list aimed at developers; no user-facing feature changes.
> Last updated: 2026-07-17

***

## Pending

* [x] **`resolveCustomEditor` & `MarkdownEditorProvider` split** — Extracted `PathSuggestionService` / `ImageManagementService` / `DocumentSyncService` (993 → 450 lines)
* [x] **`editor.ts` plugins and Modal split** — Extracted 8 prose plugins into `webview/plugins/` and 3 Modals into `webview/ui/modals/` (1603 → 550 lines)
* [x] **Dead code cleanup** — Removed the `selectionToolbar/` directory and `webview/utils.ts`, cleaned up the redundant Vue define in `esbuild.mjs`
* [x] **File Watcher race condition fix** — Adopted content hash MD5 comparison in place of the 1500ms timer, avoiding erroneous reverts caused by concurrent writes

### 🟡 Medium Priority (incremental)

* [ ] **Inject fullscreen button into code blocks** — Change MutationObserver to a Crepe NodeView extension
* [ ] **CodeMirror theme alignment** — Change MutationObserver to be passed in via Compartment at init

***

## Paid Off

### 🔴 High Priority

* [x] **`setupSelectionToolbar` split** — Extracted `createFormatDropdown` / `createAlignmentDropdown` / `createTableDeleteButtons` (554 → 277 lines)
* [x] **`initToc` split** — Extracted `getHeadings` / `findHeadingElement` / `hasChildren` / `isHeadingVisible` to module level (406 → 338 lines)
* [x] **`createImageView` split** — Extracted the `startToolbarInlineEdit` shared inline-edit helper, eliminated the duplication between `startCaptionEdit`/`startSrcEdit` (~80 lines shared), and synchronously fixed malformed URLs caused by resolving non-existent paths during path resolution
* [x] **Magic number constantification** — Added `shared/constants.ts`, extracted 25 named constants, replaced ~55 hardcoded numbers
* [x] **`buildTopBar` type safety** — Used Crepe's official context types to remove 14 `as any` from `builder`, menu items, and callbacks

### 🟡 Medium Priority

* [x] **Dropdown completion duplication** — `pathComplete` / `imgPathComplete` → extracted `closeDropdown`/`updateActiveItem` to `ui/dropdownComplete.ts` (~40 lines of duplication removed)
* [x] **Confirm/cancel edit duplication** — `startCaptionEdit` / `startSrcEdit` → extracted `startToolbarInlineEdit` to module level in `imageView/index.ts`
* [x] **Top bar P dropdown not displayed** — `.top-bar-inner`'s `overflow: hidden` was clipping the Crepe heading dropdown; changed to `overflow: visible` and added CSS regression tests
* [x] **Empty catch blocks** (12) — All annotated with descriptive comments (4 already had sufficient comments, 8 added)

### Settings audit

* [x] All 13 settings have been verified to be in actual use in code; no dead settings.
  * `autoSave` / `autoSaveDelay` → `MarkdownEditorProvider._scheduleAutoSaveOrMarkDirty`
  * `codeBlockMaxHeight` / `editorMaxWidth` / `fontFamily` / `imageSelectionColor` → injected as CSS variables
  * `defaultMode` → `extension.ts` editor association sync
  * `debugMode` → global debug log toggle + WebView sync
  * `imageStorage` / `imageLocalPath` / `imageServer*` → `imageService.ts` image upload flow

### Test coverage

* [x] **`webview/utils/themeBus.ts`** — `isDark()` / `onThemeChange()` jsdom tests added; line coverage 100%
* [x] **`webview/i18n/index.ts`** — Mac/Win branches of `t()` / `kbd()` tested; line coverage 100%
* [x] **`src/MarkdownDocument.ts`** — `saveAs` cancel and `dispose` edge cases covered; line coverage 100%
* [x] **`src/utils/imageService.ts`** — Directory-read failure, non-file directory entries, and upload-timeout boundaries covered; line coverage 100%

***

## Deferred

The items below have been identified but are not urgent; handle them opportunistically.

### 🔴 Upstream workaround

* [ ] **`cellClickFixPlugin`** (~130 lines, [editor.ts:236-363](../webview/editor.ts#L236)) — `filterTransaction` + `appendTransaction` + `requestAnimationFrame` multi-layer interception to counter Crepe's unstable table click behavior. **Remove after the Milkdown upstream fix.**

### 🟠 DOM scraping / MutationObserver anti-pattern (remaining)

* [ ] **Language list keyboard navigation** ([index.ts:608-635](../webview/index.ts#L608)) — Manipulates internal DOM of `.language-list-item`. Small surface area, deferred.

### 🟡 Type safety (remaining)

* [ ] **119 `!important`** in [style.css](../webview/style.css) — Large count; needs to be analyzed one by one for alternatives.

### 🟢 Fragile event handling

* [ ] **`capture: true` event listener** (5 instances) — Milkdown won't overhaul the event mechanism in the short term, no action.
* [ ] **Link click `stopImmediatePropagation`** ([index.ts:371](../webview/index.ts#L371)) — Stable in practice, no action.

### Tooling

* [ ] **Integration tests**: `@vscode/test-electron + Mocha` not yet set up — mainly covers `extension.ts` + `MarkdownEditorProvider.ts`, wiring logic that unit tests cannot reach
