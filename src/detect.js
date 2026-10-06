// Project detection. Reads files only, never executes anything in the project.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const has = (dir, f) => existsSync(path.join(dir, f));
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const read = (dir, f) => { try { return readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };

// Order matters: the first match wins (Next.js apps often also list express).
const NODE_FRAMEWORKS = [
  ['next', 'nextjs', 'Next.js'],
  ['@nestjs/core', 'nestjs', 'NestJS'],
  ['nuxt', 'nuxt', 'Nuxt'],
  ['@sveltejs/kit', 'sveltekit', 'SvelteKit'],
  ['@remix-run/node', 'remix', 'Remix'],
  ['fastify', 'fastify', 'Fastify'],
  ['hono', 'hono', 'Hono'],
  ['koa', 'koa', 'Koa'],
  ['express', 'express', 'Express'],
];

export function detectPackageManager(dir) {
  if (has(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(dir, 'yarn.lock')) return 'yarn';
  if (has(dir, 'bun.lockb') || has(dir, 'bun.lock')) return 'bun';
  return 'npm';
}

export function detectProject(dir) {
  const result = {
    dir,
    language: 'unknown',
    framework: null,
    frameworkName: null,
    typescript: false,
    esm: false,
    packageManager: null,
    nextRouter: null,
    srcDir: false,
    hasSdk: false,
    notes: [],
  };

  if (has(dir, 'package.json')) {
    let pkg = {};
    try { pkg = JSON.parse(read(dir, 'package.json')); } catch { result.notes.push('package.json could not be parsed'); }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    result.language = 'node';
    result.packageManager = detectPackageManager(dir);
    result.typescript = 'typescript' in deps || has(dir, 'tsconfig.json');
    result.esm = pkg.type === 'module';
    result.hasSdk = '@ultraner/sdk' in deps;
    result.srcDir = isDir(path.join(dir, 'src'));
    for (const [dep, id, name] of NODE_FRAMEWORKS) {
      if (dep in deps) { result.framework = id; result.frameworkName = name; break; }
    }
    if (result.framework === 'nextjs') {
      const appDir = ['app', 'src/app'].find((d) => isDir(path.join(dir, d)));
      const pagesDir = ['pages', 'src/pages'].find((d) => isDir(path.join(dir, d)));
      result.nextRouter = appDir ? 'app' : pagesDir ? 'pages' : 'app';
      result.nextBase = appDir || pagesDir || (result.srcDir ? 'src/app' : 'app');
    }
    return result;
  }

  if (has(dir, 'pyproject.toml') || has(dir, 'requirements.txt') || has(dir, 'manage.py')) {
    result.language = 'python';
    const txt = (read(dir, 'pyproject.toml') + read(dir, 'requirements.txt')).toLowerCase();
    if (has(dir, 'manage.py') || /\bdjango\b/.test(txt)) [result.framework, result.frameworkName] = ['django', 'Django'];
    else if (/\bfastapi\b/.test(txt)) [result.framework, result.frameworkName] = ['fastapi', 'FastAPI'];
    else if (/\bflask\b/.test(txt)) [result.framework, result.frameworkName] = ['flask', 'Flask'];
    return result;
  }
  if (has(dir, 'composer.json')) {
    result.language = 'php';
    if (has(dir, 'artisan') || /laravel\/framework/.test(read(dir, 'composer.json'))) [result.framework, result.frameworkName] = ['laravel', 'Laravel'];
    return result;
  }
  if (has(dir, 'go.mod')) { result.language = 'go'; return result; }
  if (has(dir, 'pubspec.yaml')) { result.language = 'dart'; result.framework = 'flutter'; result.frameworkName = 'Flutter'; return result; }
  return result;
}

export function describeProject(p) {
  const lines = [];
  const lang = { node: 'Node.js', python: 'Python', php: 'PHP', go: 'Go', dart: 'Dart', unknown: 'No known project files' }[p.language];
  lines.push(`Detected ${lang}`);
  if (p.frameworkName) lines.push(`Detected ${p.frameworkName}${p.nextRouter ? ` (${p.nextRouter} router)` : ''}`);
  if (p.language === 'node') {
    lines.push(p.typescript ? 'Detected TypeScript' : 'Detected JavaScript');
    lines.push(`Package manager: ${p.packageManager}`);
    if (p.hasSdk) lines.push('@ultraner/sdk is already installed');
  }
  return lines;
}
