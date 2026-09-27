import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const exec = promisify(execFile);
// Release smoke tests must not inherit a developer's model or cloud credentials.
const smokeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BANH_|banh_)/.test(key)));
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'banh-alpha-'));
const destination = process.argv.slice(2).find(arg => arg !== '--');
const artifacts = destination ? resolve(destination) : join(temp, 'artifacts');
const packages = ['dsl', 'runtime', 'typesafe', 'laya', 'providers', 'cli'];
let server;
async function run(command, args, cwd) {
  try {
    return await exec(command, args, { cwd, timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...smokeEnv, ONNXRUNTIME_NODE_INSTALL: 'skip' } });
  } catch (error) {
    throw new Error(command + ' failed: ' + (error.stderr || error.stdout || error.message));
  }
}
try {
  await mkdir(artifacts, { recursive: true });
  const tarballs = [];
  for (const name of packages) {
    const dir = join(root, 'packages', name);
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.equal(manifest.version, '0.1.0-alpha.0');
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.publishConfig.tag, 'alpha');
    assert.notEqual(manifest.private, true);
    await run('pnpm', ['pack', '--pack-destination', artifacts], dir);
    tarballs.push(join(artifacts, manifest.name.replace('@', '').replace('/', '-') + '-' + manifest.version + '.tgz'));
  }
  const consumer = join(temp, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await run('npm', ['install', '--no-audit', '--no-fund', ...tarballs], consumer);
  for (const name of ['banh', ...packages.filter(p => p !== 'cli').map(p => '@banh/' + p)]) {
    const dir = join(consumer, 'node_modules', name);
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.equal(manifest.version, '0.1.0-alpha.0');
    assert.ok((await readFile(join(dir, 'LICENSE'), 'utf8')).startsWith('MIT License'));
    assert.ok((await readFile(join(dir, 'README.md'), 'utf8')).length);
    for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
      assert.ok(!version.startsWith('workspace:'));
      if (dependency.startsWith('@banh/')) assert.equal(version, '0.1.0-alpha.0');
    }
  }
  await run('node', ['--input-type=module', '-e',
    'await Promise.all(["@banh/dsl","@banh/runtime","@banh/laya","@banh/providers","@banh/typesafe"].map(p => import(p)))'], consumer);
  const cli = join(consumer, 'node_modules', '.bin', 'banh');
  const help = await run(cli, ['--help'], consumer);
  assert.match(help.stdout, /https:\/\/api.banh.dev/);
  assert.equal((await run(cli, ['--version'], consumer)).stdout.trim(), '0.1.0-alpha.0');
  const workflow = join(consumer, 'smoke.yaml');
  await writeFile(workflow, 'version: 1\nprocess: smoke\ninput:\n  type: text\ndecisions:\n  urgent:\n    decide: whether\n    question: Urgent?\nflow:\n  - else:\n      do: return\n      value: "{{ urgent.value }}"\n');
  await run(cli, ['validate', workflow], consumer);
  const requests = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ path: req.url, method: req.method, body: JSON.parse(body) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ answers: { urgent: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 10 } }));
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  const result = await run(cli, ['run', workflow, '--text', 'urgent ticket', '--provider', 'http',
    '--model', 'kev', '--base-url', endpoint, '--json'], consumer);
  assert.equal(JSON.parse(result.stdout).output, true);
  assert.deepEqual(requests, [{ path: '/v1/systemone', method: 'POST', body: {
    state: 'urgent ticket', questions: { urgent: { type: 'noul', instructions: 'Urgent?' } }, model: 'kev-latest',
  } }]);
  console.log('PASS: six packed packages, clean npm install, exports, executable, version, validation, and HTTP workflow.');
  if (destination) console.log('Artifacts: ' + artifacts);
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(temp, { recursive: true, force: true });
}
