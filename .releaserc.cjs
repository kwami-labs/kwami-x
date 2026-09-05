/**
 * semantic-release configuration — one release line, three channels.
 *
 *   dev  → 3.1.0-dev.1 …   GitHub Pre-release
 *   stg  → 3.1.0-rc.1  …   GitHub Pre-release
 *   main → 3.1.0           GitHub Release
 *
 * Kwami v3 is an application, not a package: nothing is published to npm. The release is the
 * tag, the changelog and the GitHub Release a deploy is cut from — so @semantic-release/npm is
 * present only to write the version into package.json, with publishing off.
 *
 * The release commit carries `[skip actions]` and is pushed with GITHUB_TOKEN, which by design
 * does not trigger workflows — the bump cannot re-run CI or release itself in a loop.
 */

module.exports = {
  branches: [
    'main',
    { name: 'stg', prerelease: 'rc' },
    { name: 'dev', prerelease: 'dev' },
  ],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        // Past 1.0, so the defaults apply: `feat` → minor, `fix`/`perf` → patch, a
        // `BREAKING CHANGE:` footer → major. A change to the vault program is always at
        // least a patch, because it changes what custodies user funds.
        // Order matters: the FIRST matching rule wins, and a matched commit skips the
        // preset's own defaults entirely. `breaking` therefore has to come first — with the
        // `program` rule ahead of it, a `feat(program)!` with a BREAKING CHANGE footer cut a
        // patch instead of a major.
        releaseRules: [
          { breaking: true, release: 'major' },
          { type: 'refactor', release: 'patch' },
          { type: 'revert', release: 'patch' },
          { type: 'build', scope: 'deps', release: 'patch' },
          { scope: 'program', release: 'patch' },
        ],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          types: [
            { type: 'feat', section: 'Features' },
            { type: 'fix', section: 'Bug Fixes' },
            { type: 'perf', section: 'Performance' },
            { type: 'refactor', section: 'Refactoring' },
            { type: 'revert', section: 'Reverts' },
            { type: 'build', section: 'Build & Dependencies' },
            { type: 'docs', section: 'Documentation', hidden: true },
            { type: 'test', section: 'Tests', hidden: true },
            { type: 'ci', section: 'CI', hidden: true },
            { type: 'chore', section: 'Chores', hidden: true },
            { type: 'style', section: 'Styling', hidden: true },
          ],
        },
      },
    ],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
        changelogTitle:
          '# Changelog\n\nAll notable changes to Kwami v3 are documented here. This file is generated\nfrom the commit history by semantic-release — do not edit it by hand.',
      },
    ],
    [
      '@semantic-release/npm',
      {
        // Version the app, publish nothing.
        npmPublish: false,
      },
    ],
    [
      '@semantic-release/exec',
      {
        // Keep the Anchor crate's version in lockstep with the app's.
        prepareCmd: 'node scripts/release/sync-program-version.mjs ${nextRelease.version}',
        // After a stable release, put `stg` and `dev` back on the same baseline. No-ops on
        // the prerelease channels.
        successCmd: 'node scripts/release/sync-branches.mjs',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'programs/kwami-vault/Cargo.toml'],
        message: 'chore(release): ${nextRelease.version} [skip actions]\n\n${nextRelease.notes}',
      },
    ],
    '@semantic-release/github',
  ],
};
