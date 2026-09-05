#!/usr/bin/env node
/**
 * Mirror the released version into the Anchor crate.
 *
 * `programs/kwami-vault/Cargo.toml` declares its own `version`, and a program that custodies
 * funds should say which release it belongs to. semantic-release owns package.json; this keeps
 * the crate from drifting away from it.
 *
 * Invoked from the `prepare` step in .releaserc.cjs, which runs after the version is decided
 * and before @semantic-release/git commits the release assets.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const CARGO = 'programs/kwami-vault/Cargo.toml'
const version = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version

if (!version) {
  console.error('No version supplied and package.json has none.')
  process.exit(1)
}

const cargo = readFileSync(CARGO, 'utf8')
// Only the [package] version — never a dependency's. It is the first `version = "..."` after
// the [package] header, and dependencies live further down under their own tables.
const updated = cargo.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]*)(")/,
  (_match, before, previous, after) => {
    if (previous === version) console.log(`${CARGO}: already ${version}`)
    else console.log(`${CARGO}: ${previous} -> ${version}`)
    return `${before}${version}${after}`
  },
)

if (updated === cargo) {
  console.log(`${CARGO}: unchanged`)
} else {
  writeFileSync(CARGO, updated)
}
