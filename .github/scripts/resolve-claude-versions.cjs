const { execFileSync } = require('node:child_process');

module.exports = function resolveVersions(installer, lookup = channel => execFileSync('npm', [
  'view', `@anthropic-ai/claude-code@${channel}`, 'version',
], { encoding: 'utf8' })) {
  const pinned = installer.match(/^VERSION="(\d+\.\d+\.\d+)"\r?$/m)?.[1];
  if (!pinned) throw new Error('Default Claude version is missing');
  const versions = new Map([[pinned, [pinned]]]);
  for (const channel of ['stable', 'latest']) {
    const version = lookup(channel).trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid ${channel} version: ${version}`);
    if (!versions.has(version)) versions.set(version, []);
    versions.get(version).push(channel);
  }
  return {
    defaultVersion: pinned,
    versions: [...versions].map(([version, channels]) => ({ version, channels: channels.join(', ') })),
  };
};
