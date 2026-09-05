/**
 * Enforces Conventional Commits, through the husky `commit-msg` hook locally and the `commits`
 * job in .github/workflows/ci.yml on every pull request.
 *
 * semantic-release derives every version, tag, GitHub Release and CHANGELOG entry from this
 * history, so a non-conventional subject is silently unreleasable work.
 *
 * `program` is the scope that matters most: it marks a change to the Anchor vault that
 * custodies user funds, and .releaserc.cjs releases on it regardless of type.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100],
  },
}
