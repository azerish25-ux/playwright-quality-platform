export function createForgeTest(base, options) { return base.extend({ forge: [async ({}, use, workerInfo) => { await use({ runId: options.runId, namespace: options.namespaceFactory(workerInfo), config: options.config }); }, { scope: 'worker' }] }); }
export function forgeId(id) { return { type: 'forgeqa-id', description: id }; }
export function forgeOwner(owner) { return { type: 'forgeqa-owner', description: owner }; }
export function playwrightReporter(configPath = 'forgeqa.config.ts') { return class {
    options;
    constructor(options = {}) { this.options = { configPath, ...options }; }
    onBegin() { }
    onTestBegin() { }
    onTestEnd() { }
    async onEnd() { }
}; }
//# sourceMappingURL=index.js.map