import * as esbuild from 'esbuild';
import path from 'path';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

const commonOptions = {
    bundle: true,
    minify: isProduction,
    sourcemap: !isProduction,
    logLevel: 'info',
};

// Extension main process (Node.js)
const extensionBuild = {
    ...commonOptions,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
};

// WebView frontend (Browser)
const webviewBuild = {
    ...commonOptions,
    entryPoints: { webview: 'webview/index.ts' },
    outdir: 'dist',
    platform: 'browser',
    target: 'es2020',
    format: 'esm',
    splitting: true,
    loader: {
        '.ttf': 'empty',
        '.woff': 'empty',
        '.woff2': 'empty',
    },
    alias: {
        '@': path.resolve('./webview'),
    },
};

if (isWatch) {
    const [ctx1, ctx2] = await Promise.all([
        esbuild.context(extensionBuild),
        esbuild.context(webviewBuild),
    ]);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log('Watching for changes...');
} else {
    await Promise.all([
        esbuild.build(extensionBuild),
        esbuild.build(webviewBuild),
    ]);
}
