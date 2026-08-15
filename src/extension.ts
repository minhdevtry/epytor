import * as vscode from "vscode";
import { MarkdownEditorProvider } from "./MarkdownEditorProvider";

function debugLog(...args: unknown[]): void {
    if (vscode.workspace.getConfiguration("epytor").get<boolean>("debugMode", false)) {
        console.log(...args);
    }
}

/**
 * Synchronize workbench.editorAssociations based on defaultMode:
 * - "source"  → inject "*.md"/"*.markdown": "default" so the text editor opens directly, without triggering the custom editor
 * - "wysiwyg" → delete those entries, restoring the priority:default declared in package.json
 */
function syncEditorAssociation(mode: string): void {
    const wbConfig = vscode.workspace.getConfiguration("workbench");
    const current: Record<string, string> = {
        ...(wbConfig.get<Record<string, string>>("editorAssociations") ?? {}),
    };
    if (mode === "source") {
        current["*.md"] = "default";
        current["*.markdown"] = "default";
    } else {
        // Preview mode: delete the association and rely on the priority:default from package.json to take effect automatically
        delete current["*.md"];
        delete current["*.markdown"];
    }
    wbConfig.update("editorAssociations", current, vscode.ConfigurationTarget.Global);
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        MarkdownEditorProvider.register(context),
    );

    // Synchronize editorAssociations once on activation
    const initialMode = vscode.workspace
        .getConfiguration("epytor")
        .get<string>("defaultMode", "wysiwyg");
    syncEditorAssociation(initialMode);

    // With priority:option, file opens are not auto-taken over; use onDidChangeTabs to listen to text tabs and switch to WYSIWYG
    // The diff view only produces TabInputTextDiff and will not trigger this logic
    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs(async (event) => {
            const mode = vscode.workspace
                .getConfiguration("epytor")
                .get<string>("defaultMode", "wysiwyg");
            if (mode !== "wysiwyg") { return; }

            for (const tab of event.opened) {
                if (!(tab.input instanceof vscode.TabInputText)) { continue; }
                const uri = (tab.input as vscode.TabInputText).uri;
                if (uri.scheme !== "file") { continue; }
                if (!/\.(md|markdown)$/i.test(uri.fsPath)) { continue; }

                const uriStr = uri.toString();
                if (MarkdownEditorProvider.suppressAutoSwitch.has(uriStr)) { continue; }

                // If the URI fragment contains a line number (global search passes #L10), store it ahead of time so the WYSIWYG editor can jump after init
                const fragMatch = uri.fragment?.match(/^L?(\d+)/);
                if (fragMatch) {
                    const fragLine = parseInt(fragMatch[1], 10);
                    if (fragLine >= 1) {
                        debugLog('[onDidChangeTabs] fragment line:', fragLine, 'fsPath:', uri.fsPath);
                        MarkdownEditorProvider.current?.setPendingNavigation(uri.fsPath, fragLine);
                    }
                }

                // Close the text tab first, then open WYSIWYG (consistent with the switchToPreview command)
                const isPreview = tab.isPreview;
                const viewCol = tab.group.viewColumn;
                await vscode.window.tabGroups.close(tab);
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    uri,
                    MarkdownEditorProvider.viewType,
                    { viewColumn: viewCol, preview: isPreview },
                );
            }
        }),
    );

    // Listen to text editor activation events: capture the .md text editor cursor position that briefly appears during global search navigation
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor) { return; }
            const { uri } = editor.document;
            if (!uri.fsPath.endsWith('.md')) { return; }
            // While switching to the text editor (suppressNavFromTextEditor is set), skip the line-number feedback
            // to avoid reporting the line back to the WebView and triggering an extra scrollToLine when actively switching away
            if (MarkdownEditorProvider.current?.isNavFromTextEditorSuppressed) { return; }
            const line = editor.selection.active.line + 1; // Convert to 1-indexed
            if (line >= 1) {
                MarkdownEditorProvider.current?.setPendingNavigation(uri.fsPath, line);
            }
        }),
    );

    // Intercept the revealLine command: VS Code calls this to navigate to a line when a global search result is clicked.
    // If a .md custom editor tab is currently open (in any group), forward it to the WebView; otherwise fall back to text editor behavior.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'revealLine',
            (args: { lineNumber: number; at?: string }) => {
                debugLog('[revealLine] triggered, lineNumber:', args.lineNumber, 'at:', args.at);
                const targetLine = args.lineNumber + 1; // Convert to 1-indexed
                // Always write the global fallback to ensure onDidChangeViewState (including the delayed check) can consume it
                MarkdownEditorProvider.current?.setGlobalRevealLine(targetLine);
                // Set pending navigation for all registered .md panels
                // Avoid relying solely on tab.isActive (the ordering of tab switch and revealLine firing is not deterministic)
                const mdPaths = MarkdownEditorProvider.current?.getAllMdFsPaths() ?? [];
                if (mdPaths.length > 0) {
                    debugLog('[revealLine] registered .md panel count:', mdPaths.length, 'line:', targetLine);
                    for (const fsPath of mdPaths) {
                        MarkdownEditorProvider.current?.setPendingNavigation(fsPath, targetLine);
                    }
                    return;
                }
                // Fallback: walk through tab groups to find an active .md custom tab
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (tab.input instanceof vscode.TabInputCustom) {
                            const uri = (tab.input as vscode.TabInputCustom).uri;
                            if (uri.fsPath.endsWith('.md') && tab.isActive) {
                                debugLog('[revealLine] found active .md custom tab, fsPath:', uri.fsPath);
                                MarkdownEditorProvider.current?.setPendingNavigation(uri.fsPath, targetLine);
                                return;
                            }
                        }
                    }
                }
                debugLog('[revealLine] no .md panel found, waiting for viewState delayed consumption');
                // Fallback: text editor uses revealRange
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const pos = new vscode.Position(args.lineNumber, 0);
                    const revealType =
                        args.at === 'top' ? vscode.TextEditorRevealType.AtTop
                        : args.at === 'center' ? vscode.TextEditorRevealType.InCenter
                        : vscode.TextEditorRevealType.Default;
                    editor.revealRange(new vscode.Range(pos, pos), revealType);
                }
            },
        ),
    );

    // Debug mode: initialize context variable
    const initialDebug = vscode.workspace
        .getConfiguration("epytor")
        .get<boolean>("debugMode", false);
    vscode.commands.executeCommand(
        "setContext",
        "epytor.debugModeActive",
        initialDebug,
    );

    // Debug mode toggle commands (two mutually exclusive commands, swapped by `when` conditions to produce the ✓ prefix effect)
    const toggleDebugMode = () => {
        const cfg = vscode.workspace.getConfiguration("epytor");
        const next = !cfg.get<boolean>("debugMode", false);
        cfg.update("debugMode", next, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand(
            "setContext",
            "epytor.debugModeActive",
            next,
        );
        MarkdownEditorProvider.current?.postToAll({
            type: "setDebugMode",
            enabled: next,
        });
    };
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "epytor.debugModeEnable",
            toggleDebugMode,
        ),
        vscode.commands.registerCommand(
            "epytor.debugModeDisable",
            toggleDebugMode,
        ),
    );

    // Listen for manual settings changes (synchronize when modified from the VSCode settings UI)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("epytor.defaultMode")) {
                const mode = vscode.workspace
                    .getConfiguration("epytor")
                    .get<string>("defaultMode", "wysiwyg");
                syncEditorAssociation(mode);
            }
            if (e.affectsConfiguration("epytor.debugMode")) {
                const v = vscode.workspace
                    .getConfiguration("epytor")
                    .get<boolean>("debugMode", false);
                vscode.commands.executeCommand(
                    "setContext",
                    "epytor.debugModeActive",
                    v,
                );
                MarkdownEditorProvider.current?.postToAll({
                    type: "setDebugMode",
                    enabled: v,
                });
            }
            if (e.affectsConfiguration("epytor.tableWrapMode")) {
                const wrapMode = vscode.workspace
                    .getConfiguration("epytor")
                    .get<string>("tableWrapMode", "wrap");
                MarkdownEditorProvider.current?.postToAll({
                    type: "setTableWrapMode",
                    wrapMode,
                } as any);
            }
        }),
    );

    // Close preview: WYSIWYG → text editor
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "epytor.switchToTextEditor",
            async (uri?: vscode.Uri) => {
                let target =
                    uri ?? vscode.window.activeTextEditor?.document.uri;
                if (!target) {
                    // activeTextEditor is undefined when a Custom Editor is active; look up the active CustomEditor tab from the tab groups
                    for (const group of vscode.window.tabGroups.all) {
                        const activeTab = group.activeTab;
                        if (activeTab?.input instanceof vscode.TabInputCustom) {
                            target = (activeTab.input as vscode.TabInputCustom).uri;
                            break;
                        }
                    }
                }
                if (!target) { return; }

                const provider = MarkdownEditorProvider.current;
                // Preferred: ask the WebView for the current scroll line; the WebView will report back and trigger the switch itself
                // so that the menu button and the Cmd+Shift+M shortcut behave consistently (both carry the line number and do not actively close the custom editor tab)
                if (provider) {
                    provider.postToPanel(target, { type: "requestSwitchToTextEditor" });
                    return;
                }

                // Fallback: when the panel is gone, open the text editor directly (without a line number)
                await vscode.commands.executeCommand("vscode.openWith", target, "default");
            },
        ),
    );

    // Open preview: text editor → WYSIWYG
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "epytor.switchToPreview",
            async (uri?: vscode.Uri) => {
                const activeEditor = vscode.window.activeTextEditor;
                const target = uri ?? activeEditor?.document.uri;
                if (!target) {
                    return;
                }
                // Save the current cursor line before switching so the WYSIWYG panel can position on activation
                const currentLine = activeEditor?.selection.active.line ?? -1;
                if (currentLine >= 0) {
                    MarkdownEditorProvider.current?.setPendingNavigation(target.fsPath, currentLine + 1);
                }
                // Read the text editor tab's preview state and its column; save them before closing
                let isPreview = false;
                let viewCol: vscode.ViewColumn = vscode.ViewColumn.Active;
                let textTab: vscode.Tab | undefined;
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (
                            tab.input instanceof vscode.TabInputText &&
                            (tab.input as vscode.TabInputText).uri.toString() === target.toString()
                        ) {
                            isPreview = tab.isPreview;
                            viewCol = group.viewColumn;
                            textTab = tab;
                            break;
                        }
                    }
                }
                // Close the text editor tab first, then open WYSIWYG, to avoid the flicker of two tabs coexisting
                if (textTab) {
                    await vscode.window.tabGroups.close(textTab);
                }
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    target,
                    MarkdownEditorProvider.viewType,
                    { viewColumn: viewCol, preview: isPreview },
                );
            },
        ),
    );
}

export function deactivate() {}
