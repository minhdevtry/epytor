# EPYTOR 路线图

> 最后更新：2026-07-17

***

## v1.2.x 🚀（规划中）

### 上游参考

fork 上游 [git-xing/md-wysiwyg-editor](https://github.com/git-xing/md-wysiwyg-editor) v0.1.6 → v0.3.1，以下功能可参考移植：

* 标题吸顶 + 折叠（v0.2.0）
* 表格换行模式（v0.2.0）
* 工具栏溢出菜单（v0.2.0，替代我们当前的 container query + flex-wrap 方案）
* Frontmatter 可视化面板（v0.2.0）
* 自定义主题（v0.2.0）— 不移植
* 颜色主题切换（v0.2.0）— 我们已通过 `--vscode-*` CSS 变量实现，无需移植

### 偿还技术债务（优先）

> 先清理地基再做新功能。与后续功能耦合的债务做新功能时穿插。

#### 🔴 高优先级（影响面大，独立处理）

* [x] **`setupSelectionToolbar` 拆分** — 提取 `createFormatDropdown` / `createAlignmentDropdown` / `createTableDeleteButtons` 三个模块函数（554→277 行）
* [x] **`initToc` 拆分** — 提取 `getHeadings` / `findHeadingElement` / `hasChildren` / `isHeadingVisible` 到模块级（406→338 行）
* [ ] **`createImageView` 拆分** — 当前 499 行，`startCaptionEdit` / `startSrcEdit` 可提取为模块函数
* [ ] **`resolveCustomEditor` 拆分** — [`MarkdownEditorProvider.ts:183`](../src/MarkdownEditorProvider.ts#L183)，322 行，可提取面板清理 / ViewState / 消息路由 / 文件监听为类方法
* [ ] **顶栏 button tooltip 注入** — 用正路方案替代 MutationObserver + `requestAnimationFrame` 扫描 `.top-bar-item`
* [ ] **魔法数字常量化** — 顶栏高度 `36`/`40`、滚动偏移 `8`、选择器 `.milkdown-top-bar` 出现 10+ 次 → 定义常量
* [x] **`buildTopBar` 类型安全** — 已使用 Crepe 官方上下文类型移除 `builder`、菜单项和回调中的 14 处 `as any`

#### 🟡 中优先级（每次改一点，不单独排 PR）

* [x] **下拉补全重复** — `pathComplete` / `imgPathComplete` → 提取 `closeDropdown`/`updateActiveItem` 到 `ui/dropdownComplete.ts`（~40 行重复消除）
* [x] **确认/取消编辑重复** — `startCaptionEdit` / `startSrcEdit` → 提取 `startToolbarInlineEdit` 到 `imageView/index.ts` 模块级
* [ ] **hover 弹出菜单不显示 bug** — v1.1.3 预埋：选中文字工具栏出现后，hover/点击 P 按钮，格式下拉菜单 `display=flex` 已设置但不渲染（疑似 z-index/stacking context/pointer-events 被遮挡）。点击切换方案已实现但未根治，需独立排查。
* [x] **空 catch 块**（12 处）— 已全部添加描述性注释（4 处已有充分注释未改，8 处补充）
* [ ] **代码块全屏按钮注入** — MutationObserver 改为 Crepe NodeView 扩展
* [ ] **CodeMirror 主题补配** — MutationObserver 改为 Compartment 初始化时传入

### 测试补齐

> 基于 `pnpm test:coverage` 实际数据。

#### 🔴 零覆盖 + 纯逻辑（必须补）

* [x] **`webview/utils/themeBus.ts`** — `isDark()` / `onThemeChange()` 已补 jsdom 测试，行覆盖率 100%
* [x] **`webview/i18n/index.ts`** — `t()` / `kbd()` Mac/Win 分支已补测试，行覆盖率 100%

#### 🟡 已有测试但有缺口

* [x] **`src/MarkdownDocument.ts`** — 已补 `saveAs` 取消与 `dispose` 边界，行覆盖率 100%
* [x] **`src/utils/imageService.ts`** — 已补目录读取失败、非文件目录项与上传超时边界，行覆盖率 100%

#### ⚫ 不需要单测

* ~~`shared/messages.ts`~~ — 纯类型定义，`tsc` 编译即验证
* `src/extension.ts` / `src/MarkdownEditorProvider.ts` — wiring 代码，应走集成测试
* `webview/editor.ts` / 各组件 — 重度依赖 Milkdown/Crepe/ProseMirror，单测成本极高

### 新功能

* [ ] **标题吸顶 + 折叠** — 长文档滚动时当前章节标题 sticky 在顶栏下方，同级标题间可折叠/展开。参考上游 `heading-sticky-title` 实现。
* [ ] **表格换行模式** — 表格单元格内支持 Shift+Enter 软换行，新增 `epytor.tableWrapMode` 配置项。
* [ ] **文字对齐** — 段落/标题支持左对齐/居中/右对齐/两端对齐。工具栏已有对齐按钮占位但未实现功能（`selectionToolbar` `alignWrap`）。
* [ ] **工具栏溢出菜单** — 窗口窄时溢出按钮收入「更多」弹出菜单，替代当前 container query + flex-wrap 方案（后者导致布局跳动且不可控）。
* [ ] **Frontmatter 可视化面板** — 不编辑源码就能改 title/date/tags 等 YAML 元数据，表单式编辑。参考上游 frontmatter 面板实现。

### 配置项检修

* [x] 全部 13 个配置项已验证在代码中实际使用，无死配置。
  * `autoSave` / `autoSaveDelay` → `MarkdownEditorProvider._scheduleAutoSaveOrMarkDirty`
  * `codeBlockMaxHeight` / `editorMaxWidth` / `fontFamily` / `imageSelectionColor` → 注入 CSS 变量
  * `defaultMode` → `extension.ts` 编辑器关联同步
  * `debugMode` → 全局调试日志开关 + WebView 同步
  * `imageStorage` / `imageLocalPath` / `imageServer*` → `imageService.ts` 图片上传流程

***

## v1.1.x ✅（已发布：v1.1.0 \~ v1.1.3）

### 架构升级

* [x] Milkdown 7.5.x → 7.21.2 + Crepe
* [x] Prism → CodeMirror 6
* [x] 表格 / 链接 / 工具栏迁移至 Crepe 原生实现
* [x] Claude 集成移除

### 新功能

* [x] LaTeX 数学公式、图片缩放与 Caption、图片选择器、图片加载重试
* [x] 工具栏毛玻璃吸顶 + 品牌标识、Undo/Redo/清除格式/设置按钮
* [x] Mermaid 深浅主题、TOC 面板优化、编辑器上边距 52px
* [x] H1-H6 标题样式打磨：h1 字重 700、h4 1.15em、h6 字重 400 + 灰色

### 已修复 Bug

* [x] **清除格式不彻底** — `clear-format` 按钮只清粗体/斜体/删除线/行内代码，需验证链接是否也能清除
* [x] **TOC 点击定位不准** — `domAtPos(pos + 1)` 在标题有行内格式时可能找不到 `<h1>`-`<h6>` 元素

### 已完成功能

* [x] **引用块一键退出** — blockquote 工具栏按钮改为 toggle
* [x] **源代码/渲染切换行定位改进** — 段内比例插值滚动
* [x] **窄窗口工具栏换行** — container query + flex-wrap 方案

### 设计决策

* 行定位方案：段内比例插值（方案 A），不改 `computeLineMap` 格式，改动最小
* 引用回退：用 ProseMirror 原生 `lift` 命令解包

***

## 技术债务（跨版本，未来择机清理）

> 🔴🟡 已纳入 v1.2.x 的条目此处不再重复，仅列出暂不处理的项目。

### 🔴 上游 workaround

* [ ] **`cellClickFixPlugin`**（\~130 行，[editor.ts:236-363](../webview/editor.ts#L236)）— `filterTransaction` + `appendTransaction` + `requestAnimationFrame` 多层拦截，对抗 Crepe 表格单击行为不稳定。**需等 Milkdown 上游修复后移除。**

### 🟠 DOM 刮削 / MutationObserver 反模式（剩余）

* [ ] **语言列表键盘导航**（[index.ts:608-635](../webview/index.ts#L608)）— 操作 `.language-list-item` 内部 DOM。影响面小，暂缓。

### 🟡 类型安全（剩余）

* [ ] **119 处** **`!important`**（[style.css](../webview/style.css)）— 量大，需逐个分析替代方案，不适合穿插做。

### 🟢 脆弱事件处理

* [ ] **`capture: true`** **事件监听**（5 处）— Milkdown 短期不会大改事件机制，暂不处理。
* [ ] **链接点击** **`stopImmediatePropagation`**（[index.ts:371](../webview/index.ts#L371)）— 运行稳定，暂不处理。

### 工具链（剩余）

* [ ] **集成测试**：`@vscode/test-electron + Mocha` 未搭建 — 主要覆盖 `extension.ts` + `MarkdownEditorProvider.ts`，单测无法触及的 wiring 逻辑

