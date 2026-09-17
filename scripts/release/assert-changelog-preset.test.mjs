import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { generateNotes } from '@semantic-release/release-notes-generator'

const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const writerPkg = JSON.parse(
  readFileSync(
    new URL('../../node_modules/conventional-changelog-writer/package.json', import.meta.url),
    'utf8',
  ),
)

/**
 * semantic-release 25 ships `@semantic-release/release-notes-generator@14`, which
 * depends on `conventional-changelog-writer@8`. The `conventionalcommits` preset
 * 10.x requires writer 9 and throws:
 *
 *   Missing helper: "conventional-changelog-conventionalcommits requires
 *   conventional-changelog-writer@9 or newer"
 *
 * Pin the preset to 9.x until the generator upgrades. This is the failure from
 * release runs 35196168296 / 35196313964 on 2026-09-17.
 */
describe('changelog preset vs semantic-release writer', () => {
  it('pins the preset to the last writer-8 major', () => {
    assert.match(
      root.devDependencies['conventional-changelog-conventionalcommits'],
      /^9\./,
      'preset 10+ needs conventional-changelog-writer@9; semantic-release 25 still ships writer 8',
    )
  })

  it('the writer resolved at the repo root is still major 8', () => {
    assert.equal(writerPkg.version.split('.')[0], '8')
  })

  it('generateNotes can render a conventionalcommits body', async () => {
    const notes = await generateNotes(
      { preset: 'conventionalcommits' },
      {
        commits: [
          {
            message: 'fix(program): drop vulnerable rand 0.7.3 from the vault lockfile\n',
            hash: 'd6dc13e0deadbeefd6dc13e0deadbeefd6dc13e0',
          },
        ],
        lastRelease: { gitTag: 'v3.1.0', gitHead: 'a'.repeat(40), version: '3.1.0' },
        nextRelease: {
          gitTag: 'v3.1.1',
          gitHead: 'b'.repeat(40),
          version: '3.1.1',
          type: 'patch',
        },
        options: { repositoryUrl: 'https://github.com/kwami-labs/kwami-x.git' },
        logger: { log() {}, error() {} },
        cwd: process.cwd(),
      },
    )

    assert.match(notes, /3\.1\.1/)
    assert.match(notes, /drop vulnerable rand/)
  })
})
