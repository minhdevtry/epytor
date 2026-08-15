type ThemeListener = (isDark: boolean) => void;

const listeners = new Set<ThemeListener>();

function isDark(): boolean {
    return document.body.classList.contains("vscode-dark")
        || document.body.classList.contains("vscode-high-contrast");
}

/** Subscribe to theme changes. Invokes the callback immediately with the current value, then on every change. Returns an unsubscribe function. */
export function onThemeChange(fn: ThemeListener): () => void {
    fn(isDark());
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// Singleton Observer watching body class changes
let started = false;
function start(): void {
    if (started) return;
    started = true;
    let prev = isDark();
    new MutationObserver(() => {
        const now = isDark();
        if (now === prev) return;
        prev = now;
        listeners.forEach((fn) => fn(now));
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}
start();
