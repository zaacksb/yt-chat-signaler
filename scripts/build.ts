import { build, type BuildOptions } from 'esbuild';

const entryFile = 'src/index.ts';

const opts: BuildOptions = {
	bundle: true,
	sourcemap: true,
	sourcesContent: false,
	target: 'es2022',
	tsconfig: 'tsconfig.json',
	outdir: 'dist',

	// minifySyntax: true,
	// minifyIdentifiers: true,
};

const node: BuildOptions = {
	platform: 'node',
	minifySyntax: true,
	packages: 'external',
};

const browser: BuildOptions = {
	platform: 'browser',
	entryPoints: { 'ytChatSignaler': entryFile },
};

const esm: BuildOptions = {
	format: 'esm',
	outExtension: { '.js': '.mjs' },
};

const esm_min: BuildOptions = {
	...esm,
	minify: true,
};

const cjs: BuildOptions = {
	format: 'cjs',
	outExtension: { '.js': '.cjs' },
};

const iife: BuildOptions = {
	format: 'iife',
	globalName: 'ytChatSignaler',
	outExtension: { '.js': '.js' },
};

const iife_min: BuildOptions = {
	...iife,
	minify: true,
};

// Node - ESM & CJS
// ytChatSignaler.node.mjs
build({ ...opts, ...node,    ...esm,      entryPoints: { 'ytChatSignaler.node': entryFile } });
// ytChatSignaler.node.cjs
build({ ...opts, ...node,    ...cjs,      entryPoints: { 'ytChatSignaler.node': entryFile } });

// Browser - ESM & IIFE, with & without minification
// ytChatSignaler.browser.mjs
build({ ...opts, ...browser, ...esm,      entryPoints: { 'ytChatSignaler.browser': entryFile } });
// ytChatSignaler.browser.min.mjs
build({ ...opts, ...browser, ...esm_min,  entryPoints: { 'ytChatSignaler.browser.min': entryFile } });
// ytChatSignaler.browser-global.js
build({ ...opts, ...browser, ...iife,     entryPoints: { 'ytChatSignaler.browser-global': entryFile } });
// ytChatSignaler.browser-global.min.js
build({ ...opts, ...browser, ...iife_min, entryPoints: { 'ytChatSignaler.browser-global.min': entryFile } });