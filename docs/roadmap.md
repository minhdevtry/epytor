# EPYTOR 路线图

> 最后更新：2026-07-17
> 技术债务清单见 [tech-debt.md](./tech-debt.md)

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

### 新功能

* [ ] **标题吸顶 + 折叠** — 长文档滚动时当前章节标题 sticky 在顶栏下方，同级标题间可折叠/展开。参考上游 `heading-sticky-title` 实现。
* [ ] **表格换行模式** — 表格单元格内支持 Shift+Enter 软换行，新增 `epytor.tableWrapMode` 配置项。
* [ ] **文字对齐** — 段落/标题支持左对齐/居中/右对齐/两端对齐。工具栏已有对齐按钮占位但未实现功能（`selectionToolbar` `alignWrap`）。
* [ ] **工具栏溢出菜单** — 窗口窄时溢出按钮收入「更多」弹出菜单，替代当前 container query + flex-wrap 方案（后者导致布局跳动且不可控）。
* [ ] **Frontmatter 可视化面板** — 不编辑源码就能改 title/date/tags 等 YAML 元数据，表单式编辑。参考上游 frontmatter 面板实现。


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

