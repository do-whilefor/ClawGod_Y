const { readFileSync, writeFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const imports = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64.exe']
  .map(platform => `clawgod-import-${platform}`);

function prepareInstallers(root, tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) || tag !== tag.trim()) throw new Error(`Invalid release tag: ${tag}`);
  const version = tag.slice(1);
  const files = [['install.sh', /^CLAWGOD_SELF_VERSION="[^"\r\n]*"$/gm, `CLAWGOD_SELF_VERSION="${version}"`],
    ['install.ps1', /^\$ClawSelfVersion = "[^"\r\n]*"$/gm, `$ClawSelfVersion = "${version}"`]];
  const rendered = files.map(([name, pattern, replacement]) => {
    const source = readFileSync(join(root, name), 'utf8');
    if ([...source.matchAll(pattern)].length !== 1) throw new Error(`${name}: expected exactly one self-version assignment`);
    if (source.includes('{{CLAWGOD:')) throw new Error(`${name}: unresolved build placeholder`);
    if (name === 'install.ps1' && (!source.startsWith('#Requires') || /[^\x00-\x7f]/.test(source))) {
      throw new Error('install.ps1 must be BOM-free ASCII');
    }
    return [name, source.replace(pattern, replacement)];
  });
  for (const [name, source] of rendered) writeFileSync(join(root, name), source);
}

function verifyAssets(root) {
  const actual = readdirSync(join(root, 'dist')).filter(name => name.startsWith('clawgod-import-')).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...imports].sort())) throw new Error('Release import assets are missing or unexpected');
  for (const name of ['install.sh', 'install.ps1', ...imports.map(name => join('dist', name))]) {
    const info = statSync(join(root, name));
    if (!info.isFile() || info.size === 0) throw new Error(`Release asset is empty or not a file: ${name}`);
  }
}

module.exports = { prepareInstallers, verifyAssets, imports };
if (require.main === module) {
  prepareInstallers(process.cwd(), process.argv[2]);
  verifyAssets(process.cwd());
}
