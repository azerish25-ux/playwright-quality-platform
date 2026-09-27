import {
  MAX_PAGES,
  RETRYABLE_STATUSES,
  ReportingError,
  assert,
  integer,
  isObject,
  safeRepository,
  sha,
  text,
} from './shared.mjs';

export class GitHubApi {
  constructor({ token, repository, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)) }) {
    text(token, 'GITHUB_TOKEN', 4096);
    this.token = token;
    this.repository = safeRepository(repository);
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  async request(path, { method = 'GET', body, expected = [200] } = {}) {
    assert(path.startsWith(`/repos/${this.repository}/`), 'Refusing a GitHub API path outside the expected repository.');
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await this.fetchImpl(`https://api.github.com${path}`, {
          method,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${this.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        lastError = new ReportingError('GitHub API request failed before receiving a response.', { cause: error });
        if (attempt < 2) {
          await this.sleep(100 * 2 ** attempt);
          continue;
        }
        throw lastError;
      }
      const raw = await response.text();
      let payload;
      if (raw) {
        try { payload = JSON.parse(raw); } catch { payload = undefined; }
      }
      if (expected.includes(response.status)) return payload;
      const retryAfter = Number(response.headers.get('retry-after'));
      const rateLimited = response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || Number.isFinite(retryAfter));
      const retryable = RETRYABLE_STATUSES.has(response.status) || rateLimited;
      const apiMessage = isObject(payload) && typeof payload.message === 'string' ? payload.message.slice(0, 300) : `HTTP ${response.status}`;
      lastError = new ReportingError(`GitHub API ${method} ${path.split('?')[0]} failed: ${apiMessage}`, { status: response.status });
      if (!retryable || attempt === 2) throw lastError;
      await this.sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5_000) : 100 * 2 ** attempt);
    }
    throw lastError ?? new ReportingError('GitHub API request failed.');
  }

  async paged(pathFactory, label, maxPages = MAX_PAGES) {
    const output = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await this.request(pathFactory(page));
      assert(Array.isArray(payload), `${label} response is not an array.`);
      output.push(...payload);
      if (payload.length < 100) return output;
    }
    throw new ReportingError(`${label} pagination exceeded ${maxPages} pages.`);
  }

  getPullRequest(number) {
    return this.request(`/repos/${this.repository}/pulls/${integer(number, 'pull request number')}`);
  }

  listPullRequestsForCommit(commitSha) {
    const commit = sha(commitSha, 'commit SHA');
    return this.paged((page) => `/repos/${this.repository}/commits/${commit}/pulls?per_page=100&page=${page}`, 'Commit pull request');
  }

  listPullRequestFiles(number) {
    return this.paged((page) => `/repos/${this.repository}/pulls/${integer(number, 'pull request number')}/files?per_page=100&page=${page}`, 'Pull request file', 30);
  }

  listComments(number) {
    return this.paged((page) => `/repos/${this.repository}/issues/${integer(number, 'pull request number')}/comments?per_page=100&page=${page}`, 'Issue comment');
  }

  createComment(number, body) {
    return this.request(`/repos/${this.repository}/issues/${integer(number, 'pull request number')}/comments`, { method: 'POST', body: { body }, expected: [201] });
  }

  updateComment(commentId, body) {
    return this.request(`/repos/${this.repository}/issues/comments/${integer(commentId, 'comment id')}`, { method: 'PATCH', body: { body } });
  }

  deleteComment(commentId) {
    return this.request(`/repos/${this.repository}/issues/comments/${integer(commentId, 'comment id')}`, { method: 'DELETE', expected: [204] });
  }

  async listArtifacts(runId) {
    const output = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await this.request(`/repos/${this.repository}/actions/runs/${integer(runId, 'run id')}/artifacts?per_page=100&page=${page}`);
      assert(isObject(payload) && Array.isArray(payload.artifacts), 'Artifact response is malformed.');
      output.push(...payload.artifacts);
      if (payload.artifacts.length < 100) return output;
    }
    throw new ReportingError(`Artifact pagination exceeded ${MAX_PAGES} pages.`);
  }

  async listJobs(runId, runAttempt) {
    const output = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await this.request(`/repos/${this.repository}/actions/runs/${integer(runId, 'run id')}/attempts/${integer(runAttempt, 'run attempt')}/jobs?per_page=100&page=${page}`);
      assert(isObject(payload) && Array.isArray(payload.jobs), 'Workflow jobs response is malformed.');
      output.push(...payload.jobs);
      if (payload.jobs.length < 100) return output;
    }
    throw new ReportingError(`Workflow job pagination exceeded ${MAX_PAGES} pages.`);
  }

  async listWorkflowRuns(workflowId) {
    const output = [];
    for (let page = 1; page <= 3; page += 1) {
      const payload = await this.request(`/repos/${this.repository}/actions/workflows/${integer(workflowId, 'workflow id')}/runs?event=pull_request&per_page=100&page=${page}`);
      assert(isObject(payload) && Array.isArray(payload.workflow_runs), 'Workflow runs response is malformed.');
      output.push(...payload.workflow_runs);
      if (payload.workflow_runs.length < 100) return output;
    }
    return output;
  }
}
