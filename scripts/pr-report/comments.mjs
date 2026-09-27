import {
  DEFAULT_BOT_LOGIN,
  META_PREFIX,
  REPORT_MARKER,
  SHA_RE,
  SkipPublication,
  assert,
  isObject,
} from './shared.mjs';

export function parseCommentMetadata(body) {
  if (typeof body !== 'string' || !body.includes(REPORT_MARKER)) return undefined;
  const start = body.indexOf(META_PREFIX);
  if (start < 0) return undefined;
  const end = body.indexOf(' -->', start);
  if (end < 0) return undefined;
  try {
    const value = JSON.parse(body.slice(start + META_PREFIX.length, end));
    if (!isObject(value)) return undefined;
    if (!Number.isSafeInteger(value.runId) || !Number.isSafeInteger(value.runAttempt) || !Number.isSafeInteger(value.prNumber)) return undefined;
    if (typeof value.headSha !== 'string' || !SHA_RE.test(value.headSha)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function selectManagedComments(comments, botLogin = DEFAULT_BOT_LOGIN) {
  assert(Array.isArray(comments), 'Issue comments must be an array.');
  return comments
    .filter((comment) => isObject(comment) && Number.isSafeInteger(comment.id) && comment.user?.login === botLogin && typeof comment.body === 'string' && comment.body.includes(REPORT_MARKER))
    .sort((left, right) => left.id - right.id);
}

export function markdownEscape(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('`', '\\`')
    .replaceAll('@', '@\u200b')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
}

function displayConclusion(value) {
  return value.replaceAll('_', ' ').toUpperCase();
}

export function renderComment({ context, jobs, evidence, evidenceError }) {
  const metadata = JSON.stringify({
    runId: context.runId,
    runAttempt: context.runAttempt,
    prNumber: context.prNumber,
    headSha: context.headSha,
    baseSha: context.baseSha,
  });
  const rows = ['verify', 'consumer', 'teamboard', 'ledgerguard', 'hardening', 'action', 'forgeqa-quality'].map((name) => {
    const result = jobs?.[name] ?? 'unavailable';
    return `| ${markdownEscape(name)} | ${markdownEscape(displayConclusion(result))} |`;
  });
  const evidenceLine = evidence
    ? `Validated \`${markdownEscape(context.artifactName)}\` (SHA-256 \`${evidence.sha256.slice(0, 16)}…\`, ${evidence.bytes} bytes).`
    : `Unavailable or invalid: ${markdownEscape(evidenceError ?? 'unknown validation failure')}`;
  const headline = evidenceError ? 'REPORTING INFRASTRUCTURE FAILURE' : displayConclusion(context.workflowConclusion);
  const body = [
    REPORT_MARKER,
    `${META_PREFIX}${metadata} -->`,
    '## ForgeQA quality',
    '',
    `**${headline}** for pull request #${context.prNumber} at \`${context.headSha.slice(0, 12)}\`.`,
    `Upstream CI conclusion: **${displayConclusion(context.workflowConclusion)}**.`,
    '',
    '| Required lane | Result |',
    '|---|---|',
    ...rows,
    '',
    `- Workflow: [CI run ${context.runId}, attempt ${context.runAttempt}](${context.runUrl})`,
    `- Tested merge/revision: \`${context.testedSha.slice(0, 12)}\``,
    `- Evidence: ${evidenceLine}`,
    ...(evidenceError ? [`- Reporting warning: ${markdownEscape(evidenceError)}`] : []),
    '',
    'This comment was produced by the trusted default-branch publisher. Pull-request code was not executed with write credentials.',
  ].join('\n');
  assert(Buffer.byteLength(body, 'utf8') <= 24 * 1024, 'Rendered comment exceeds the size limit.');
  return body;
}

function compareOrder(left, right) {
  if (left.runId !== right.runId) return left.runId - right.runId;
  return left.runAttempt - right.runAttempt;
}

export async function publishComment(api, context, body, botLogin = DEFAULT_BOT_LOGIN) {
  const managed = selectManagedComments(await api.listComments(context.prNumber), botLogin);
  const currentMetadata = { runId: context.runId, runAttempt: context.runAttempt, prNumber: context.prNumber, headSha: context.headSha };
  for (const comment of managed) {
    const metadata = parseCommentMetadata(comment.body);
    if (metadata && compareOrder(metadata, currentMetadata) > 0) {
      throw new SkipPublication(`A newer ForgeQA comment already exists for pull request #${context.prNumber}.`);
    }
  }
  let primary;
  if (managed.length === 0) {
    primary = await api.createComment(context.prNumber, body);
  } else {
    primary = managed[0];
    if (primary.body !== body) primary = await api.updateComment(primary.id, body);
    for (const duplicate of managed.slice(1)) await api.deleteComment(duplicate.id);
  }
  return primary;
}
