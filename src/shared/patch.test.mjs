
import { classifierTimeoutFloor as floor } from './runtime-helpers.cjs';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { createServer, request } from 'node:http';
import { scanPentestPatches } from './pentest-patches.mjs';
import { applyAstEdits } from './ast-patches.mjs';

{
  const tool = name => `defineTool({name:"${name}",searchHint:"fixture",get inputSchema(){return{}},create(){return{}}})`;
  const source = `const read=${tool('Read')},write=${tool('Write')},edit=${tool('Edit')};` +
    'function baseTools(){return[read,write,edit]}' +
    'const help={type:"local",name:"help"},compact={type:"local",name:"compact"};' +
    'function commands(){return[help,compact]}' +
    'function decoy(){return[{name:"Read"},{name:"Write"},{name:"Edit"}]}';
  const scan = scanPentestPatches(source)['runtime-table-probe'];
  assert.equal(scan.matches.length, 2, 'both actual factories must be registered');
  const patched = applyAstEdits(source, scan.matches);
  const sandbox = { process: { argv: ['bun', 'cli', '--probe-tools'] }, defineTool: value => value };
  runInNewContext(patched, sandbox);
  assert.equal(sandbox.__clawgodTables.tools.length, 1, 'named-object decoy must not register');
  assert.equal(JSON.stringify(sandbox.__clawgodTables.tools[0]().map(tool => tool.name)), '["Read","Write","Edit"]');
  assert.equal(JSON.stringify(sandbox.__clawgodTables.commands[0]().map(command => command.name)), '["help","compact"]');
  assert.equal(scanPentestPatches(patched)['runtime-table-probe'].matches.length, 0, 'registration is idempotent');
}

assert.equal(floor('200000'), 200000);
assert.equal(floor('5000'), 5000);
assert.equal(floor('-100000'), -100000);
assert.equal(floor('0'), 0);
assert.equal(floor('Infinity'), null);
assert.equal(floor('1e309'), null);
assert.equal(floor('abc'), null);
assert.equal(floor(''), null);
assert.equal(floor('   '), null);
assert.equal(floor(undefined), null);

const patchRes = (env, gateOn, formula) => {
  const _ct = gateOn ? floor(env) : null;
  return _ct === null ? formula : Math.max(formula, _ct);
};
assert.equal(patchRes('200000', true, 100), 200000);
assert.equal(patchRes('5000', true, 80000), 80000);
assert.equal(patchRes('0', true, 80000), 80000);
assert.equal(patchRes('0', true, 0), 0);
assert.equal(patchRes('200000', false, 100), 100);
assert.equal(patchRes('Infinity', true, 80000), 80000);
assert.equal(patchRes('1e309', true, 80000), 80000);
assert.equal(patchRes('', true, 80000), 80000);
assert.equal(patchRes(undefined, true, 80000), 80000);

console.log('[patch.test] classifierTimeoutFloor semantics ok');

const ultraplanFixtures = [
  { label: 'legacy literal', description: 'description:`Draft a plan`', original: '!1' },
  { label: 'getter and flag helper', description: 'get description(){return`Draft a plan (${estimate()})`}', original: '$flag()' },
  { label: '2.1.268 availability', description: 'get description(){return`Draft a plan (${estimate()})`}', original: '$flag()', metadata: 'availability:["claude-ai"],' },
];
const testDir = mkdtempSync(join(tmpdir(), 'clawgod-patch-test-'));
try {
  for (const name of ['patch.mjs', 'patch-registry.mjs', 'ast-patches.mjs', 'acorn.mjs', 'pentest-patches.mjs', 'pentest-scanners.mjs', 'pentest-trimming.mjs', 'pentest-policy-text.mjs', 'pentest-pruner.mjs']) {
    copyFileSync(new URL(`./${name}`, import.meta.url), join(testDir, name));
  }
  writeFileSync(join(testDir, 'pathmap.json'), JSON.stringify(Object.fromEntries(
    ['commands.js', 'mixed.js', 'auto-mode.js'].map(name =>
      [`/$bunfs/root/${name}`, { path: `bunfs/${name}`, loader: 'js' }]),
  )));
  for (const graph of [false, true]) {
    if (graph) mkdirSync(join(testDir, 'bunfs'));
    for (const fixture of ultraplanFixtures) {
      const source = `var command={type:"local-jsx",name:"ultraplan",${fixture.description},argumentHint:"<prompt>",${fixture.metadata || ''}isEnabled:()=>${fixture.original},policyGate:policy,load:()=>load()};var neighbor={name:"other",argumentHint:"<prompt>",isEnabled:()=>!1};`;
      const target = join(testDir, graph ? 'bunfs/commands.js' : 'cli.original.cjs');
      if (graph) writeFileSync(join(testDir, 'cli.original.cjs'), '// entry');
      writeFileSync(target, source);
      const output = execFileSync(process.execPath, [join(testDir, 'patch.mjs')], { encoding: 'utf8' });
      assert.match(output, /Ultraplan enable \(1 replacement in 1 file\)/, fixture.label);
      const patched = readFileSync(target, 'utf8');
      const enabled = `isEnabled:()=>${fixture.original}`;
      assert.equal(patched, source.replace(enabled, `isEnabled:()=>(globalThis.__clawgodPatches?.["ultraplan"]!==!1?!0:(${fixture.original}))`));
      for (const toggle of [undefined, true, false]) {
        for (const upstream of [false, true]) {
          let calls = 0;
          const context = {
            $flag: () => { calls++; return upstream; },
            estimate: () => 'a few minutes', policy: () => false, load: () => 'loaded',
            ...(toggle === undefined ? {} : { __clawgodPatches: { ultraplan: toggle } }),
          };
          const result = runInNewContext(`${patched};[command.isEnabled(),neighbor.isEnabled(),command.description,command.policyGate(),command.load()]`, context);
          const originalValue = fixture.original === '!1' ? false : upstream;
          assert.equal(result[0], toggle === false ? originalValue : true, fixture.label);
          assert.equal(result[1], false);
          assert.match(result[2], /^Draft a plan/);
          assert.equal(result[3], false);
          assert.equal(result[4], 'loaded');
          assert.equal(calls, toggle === false && fixture.original !== '!1' ? 1 : 0);
        }
      }
    }
    for (const body of [
      'description:"Future gate",argumentHint:"<prompt>",newMetadata:!0,isEnabled:futureGate',
      'description:"Cloud command stub"',
    ]) {
      const source = `var command={name:"ultraplan",${body}};var neighbor={name:"other",argumentHint:"<prompt>",isEnabled:()=>!1};`;
      const target = join(testDir, graph ? 'bunfs/commands.js' : 'cli.original.cjs');
      writeFileSync(target, source);
      const result = spawnSync(process.execPath, [join(testDir, 'patch.mjs')], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      if (body.includes('isEnabled:futureGate')) {
        assert.match(result.stderr, /Runtime fallback installed/);
        assert.equal(readFileSync(target, 'utf8'), source.replace('isEnabled:futureGate',
          'isEnabled:globalThis.__clawgodHelpers.enablePredicate(futureGate,"ultraplan")'));
      } else {
        assert.match(result.stdout, /Ultraplan enable — AST matcher stale/);
        assert.equal(readFileSync(target, 'utf8'), source);
      }
    }
    const minimal = 'function userType(){return "external"}';
    const target = join(testDir, graph ? 'bunfs/commands.js' : 'cli.original.cjs');
    writeFileSync(target, minimal);
    const missing = spawnSync(process.execPath, [join(testDir, 'patch.mjs')], { encoding: 'utf8' });
    assert.equal(missing.status, 0, `${graph ? 'graph' : 'legacy'}: absent anchors do not abort the install`);
    assert.match(missing.stdout, /0 failed/);
    assert.match(missing.stdout, /not present in this version/);
    assert.match(missing.stdout, /Patching completed;/);
    const drifted = 'async function decide(a,b,c,d,e,f){return a.checkPermissions("tengu_mcp_server_policy_bypass_exempt")}';
    writeFileSync(target, drifted);
    const strict = spawnSync(process.execPath, [join(testDir, 'patch.mjs')], { encoding: 'utf8' });
    assert.equal(strict.status, 0, strict.stderr);
    assert.match(strict.stdout, /skipped, upstream behavior kept/);
    assert.equal(readFileSync(target, 'utf8'), drifted, 'unmatched patch leaves its source untouched');
  }

  for (const graph of [false, true]) {
    rmSync(join(testDir, 'bunfs'), { recursive: true, force: true });
    if (graph) mkdirSync(join(testDir, 'bunfs'));
    const target = join(testDir, graph ? 'bunfs/mixed.js' : 'cli.original.cjs');
    if (graph) writeFileSync(join(testDir, 'cli.original.cjs'), '// entry');
    const source =
      'var command={name:"ultraplan",description:"Cloud command stub"};' +
      'function isThirdParty(){return provider!=="firstParty"&&!isAws(provider)}' +
      'function isAws(value){return value==="anthropicAws"}' +
      'function supports(model){if(isThirdParty()&&(model==="claude-opus-4-6"||model==="claude-sonnet-4-6"||model.includes("haiku")))return!1;return!0}';
    const layout = graph ? 'graph' : 'legacy';

    writeFileSync(target, source);
    const strict = spawnSync(process.execPath, [join(testDir, 'patch.mjs')], { encoding: 'utf8' });
    assert.equal(strict.status, 0, strict.stderr);
    assert.match(strict.stdout, /Ultraplan enable — AST matcher stale/);
    assert.match(strict.stdout, /skipped, upstream behavior kept/);
    const patched = readFileSync(target, 'utf8');
    assert.match(patched, /name:"ultraplan",description:"Cloud command stub"/, `${layout}: stale patch kept upstream behavior`);
    assert.match(patched, /globalThis\.__clawgodPatches\?\.\["auto-mode-inline-gate"\]/, `${layout}: remaining patches still applied`);
  }

  for (const graph of [false, true]) {
    rmSync(join(testDir, 'bunfs'), { recursive: true, force: true });
    if (graph) mkdirSync(join(testDir, 'bunfs'));
    for (const [label, condition] of [
      ['inline provider', 'provider!=="firstParty"&&!isAws(provider)&&(model==="claude-opus-4-6"||model==="claude-sonnet-4-6"||model.includes("haiku"))'],
      ['provider helper', 'isThirdParty()&&(model==="claude-opus-4-6"||model==="claude-sonnet-4-6"||model.includes("haiku"))'],
      ['provider helper with haiku exemption (v2.1.293+)', 'isThirdParty()&&(model==="claude-opus-4-6"||model==="claude-sonnet-4-6"||model.includes("haiku")&&model!=="claude-haiku-5-5")'],
      ['provider helper with future exclusions', 'isThirdParty()&&(model==="claude-opus-4-6"||model==="claude-sonnet-4-6"||model.includes("haiku")&&model!=="claude-haiku-5-5"&&!isExcluded(model))'],
    ]) {
      const source = `function isThirdParty(){return provider!=="firstParty"&&!isAws(provider)}function isAws(value){return value==="anthropicAws"}function supports(model){if(${condition})return!1;return!0}`;
      const target = join(testDir, graph ? 'bunfs/auto-mode.js' : 'cli.original.cjs');
      if (graph) writeFileSync(join(testDir, 'cli.original.cjs'), '// entry');
      writeFileSync(target, source);
      const output = execFileSync(process.execPath, [join(testDir, 'patch.mjs')], { encoding: 'utf8' });
      assert.match(output, /Auto-mode unlock for third-party API \(inline gate\) \(1 replacement in 1 file\)/, label);
      const patched = readFileSync(target, 'utf8');
      for (const toggle of [false, true]) {
        for (const provider of ['firstParty', 'anthropicAws', 'proxy']) {
          const context = { provider, __clawgodPatches: { 'auto-mode-inline-gate': toggle } };
          const result = runInNewContext(`${patched};supports("claude-sonnet-4-6")`, context);
          assert.equal(result, toggle || provider !== 'proxy', `${label}: ${provider}, toggle ${toggle}`);
        }
      }
    }
  }
} finally {
  rmSync(testDir, { recursive: true, force: true });
}
console.log('[patch.test] ultraplan bundle/graph compatibility and toggle semantics ok');
console.log('[patch.test] auto-mode provider gate compatibility and toggle semantics ok');

const privacyDir = mkdtempSync(join(tmpdir(), 'clawgod-wiggly-dove-test-'));
const fixtures = [
  ['2.1.299', 'rw', 'mm'],
  ['2.1.301', 'tw', 'pm'],
  ['2.1.303', 'aw', '_m'],
  ['renamed', '$flag', '$gate'],
];
function privacyFixture(version, flag, check) {
  return `var ${flag}="tengu_wiggly_dove";var other="tengu_other";` +
    'function neighbor(){if(!isFirstParty())return!1;if(!feature(other,!1))return!1;return routeAllowed()}' +
    `function ${check}(){if(!isFirstParty())return!1;if(!feature(${flag},!1))return!1;return routeAllowed()}` +
    `async function collect(){if(!${check}())return;return 'jy="'+readOrigin()+'", ob="${version}"'}` +
    'function header(value){if(value===void 0)return{};return{"x-claude-code-wiggly-dove":value}}' +
    'async function buildRequest(){return{headers:{"x-unrelated":"preserved",...header(await collect())},body:{messages:[{role:"user",content:"hello"}]}}}';
}
try {
  for (const name of ['patch.mjs', 'patch-registry.mjs', 'ast-patches.mjs', 'acorn.mjs', 'pentest-patches.mjs', 'pentest-scanners.mjs', 'pentest-trimming.mjs', 'pentest-policy-text.mjs', 'pentest-pruner.mjs']) {
    copyFileSync(new URL(`./${name}`, import.meta.url), join(privacyDir, name));
  }
  writeFileSync(join(privacyDir, 'pathmap.json'), JSON.stringify({
    '/$bunfs/root/privacy.js': { path: 'bunfs/privacy.js', loader: 'js' },
  }));
  let lastPatched;
  for (const graph of [false, true]) {
    if (graph) mkdirSync(join(privacyDir, 'bunfs'));
    const target = join(privacyDir, graph ? 'bunfs/privacy.js' : 'cli.original.cjs');
    if (graph) writeFileSync(join(privacyDir, 'cli.original.cjs'), '// graph entry');
    for (const [version, flag, check] of fixtures) {
      const source = privacyFixture(version, flag, check);
      writeFileSync(target, source);
      const output = execFileSync(process.execPath, [join(privacyDir, 'patch.mjs')], { encoding: 'utf8' });
      assert.match(output, /Block wiggly-dove Git\/environment collection \(1 replacement in 1 file\)/);
      const patched = readFileSync(target, 'utf8');
      assert.equal(patched, source.replace(`function ${check}(){`,
        `function ${check}(){;if(globalThis.__clawgodPatches?.["wiggly-dove"]!==!1)return !1;`));
      execFileSync(process.execPath, [join(privacyDir, 'patch.mjs')]);
      assert.equal(readFileSync(target, 'utf8'), patched, 'repatch without a snapshot is idempotent');
      for (const toggle of [undefined, true, false]) {
        for (const firstParty of [false, true]) {
          for (const upstreamFlag of [false, true]) {
            for (const route of [false, true]) {
              let reads = 0, evaluations = 0;
              const result = await runInNewContext(`${patched};buildRequest()`, {
                ...(toggle === undefined ? {} : { __clawgodPatches: { 'wiggly-dove': toggle } }),
                isFirstParty: () => firstParty,
                feature: (key) => { assert.equal(key, 'tengu_wiggly_dove'); evaluations++; return upstreamFlag; },
                routeAllowed: () => route,
                readOrigin: () => { reads++; return 'git.example.test/team/private-repo'; },
              });
              const expected = toggle === false && firstParty && upstreamFlag && route;
              assert.equal(reads, Number(expected), 'blocked before collecting Git metadata');
              assert.equal(evaluations, Number(toggle === false && firstParty), 'does not consult the rollout when blocked');
              assert.equal('x-claude-code-wiggly-dove' in result.headers, expected);
              assert.equal(result.headers['x-unrelated'], 'preserved');
              assert.equal(JSON.stringify(result.body), '{"messages":[{"role":"user","content":"hello"}]}');
            }
          }
        }
      }
      lastPatched = patched;
    }
    writeFileSync(target, '// no wiggly-dove in this version');
    execFileSync(process.execPath, [join(privacyDir, 'patch.mjs')]);
    for (const declaration of ['var', 'let', 'const']) {
      const stale = `function userType(){return"external"}${declaration} flag="tengu_wiggly_dove";function changed(){return feature(flag,!1)}`;
      writeFileSync(target, stale);
      const result = spawnSync(process.execPath, [join(privacyDir, 'patch.mjs')], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Block wiggly-dove Git\/environment collection — AST matcher stale/);
      assert.match(result.stdout, /skipped, upstream behavior kept/);
      const output = readFileSync(target, 'utf8');
      assert.match(output, /return\s*"ant"/);
      assert.ok(output.includes(stale.slice(stale.indexOf(declaration))), 'unmatched collector remains unchanged');
    }
  }

  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { received.push({ headers: req.headers, body }); res.end('ok'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const toggle of [undefined, true, false]) {
      const outgoing = await runInNewContext(`${lastPatched};buildRequest()`, {
        ...(toggle === undefined ? {} : { __clawgodPatches: { 'wiggly-dove': toggle } }),
        isFirstParty: () => true, feature: () => true, routeAllowed: () => true,
        readOrigin: () => 'git.example.test/team/private-repo',
      });
      await new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: server.address().port,
          method: 'POST', headers: outgoing.headers, agent: false }, res => { res.resume(); res.on('end', resolve); });
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('loopback capture timed out')));
        req.end(JSON.stringify(outgoing.body));
      });
      const captured = received.at(-1);
      assert.equal('x-claude-code-wiggly-dove' in captured.headers, toggle === false);
      assert.equal(captured.headers['x-unrelated'], 'preserved');
      assert.equal(captured.body, JSON.stringify(outgoing.body));
      if (toggle === false) assert.match(captured.headers['x-claude-code-wiggly-dove'], /git\.example\.test\/team\/private-repo/);
      else assert.ok(!JSON.stringify(captured).includes('git.example.test'));
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
} finally {
  rmSync(privacyDir, { recursive: true, force: true });
}
console.log('[patch.test] wiggly-dove collection, request capture, toggles, idempotence, and stale gates ok');
