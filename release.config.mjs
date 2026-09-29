// Only the coordinator invokes this configuration. Version analysis cannot publish
// packages, create release tags, or move stable aliases.
export default Object.freeze({
  branches: ['main'],
  tagFormat: 'v${version}',
  dryRun: true,
  ci: false,
  plugins: [['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }]]
});
