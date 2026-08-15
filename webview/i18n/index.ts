declare global {
    interface Window {
        __i18n?: {
            translations: Record<string, string>;
            isMac: boolean;
            debugMode?: boolean;
        };
    }
}

const _t: Record<string, string> = window.__i18n?.translations ?? {};
const _isMac: boolean = window.__i18n?.isMac ?? false;

/** Translate a string; returns the original key (i.e. the English text) when not found */
export function t(key: string): string {
    return _t[key] ?? key;
}

/**
 * Convert a shortcut string to the current platform's display format.
 * Input follows the ProseMirror keymap convention, e.g. 'Mod-b', 'Mod-Shift-z', 'Alt-k'.
 * Mac:  Mod→⌘  Shift→⇧  Alt→⌥  remaining chars uppercased, no separator
 * Win:  Mod→Ctrl  Shift→Shift  Alt→Alt  remaining chars uppercased, joined with '+'
 */
export function kbd(shortcut: string): string {
    const parts = shortcut.split("-");
    if (_isMac) {
        return parts
            .map((p) => {
                if (p === "Mod") {
                    return "⌘";
                }
                if (p === "Shift") {
                    return "⇧";
                }
                if (p === "Alt") {
                    return "⌥";
                }
                return p.toUpperCase();
            })
            .join("");
    } else {
        return parts
            .map((p) => {
                if (p === "Mod") {
                    return "Ctrl";
                }
                if (p === "Shift") {
                    return "Shift";
                }
                if (p === "Alt") {
                    return "Alt";
                }
                return p.toUpperCase();
            })
            .join("+");
    }
}
