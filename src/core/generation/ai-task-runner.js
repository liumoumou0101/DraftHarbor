(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./ai-task-contract'),
            require('./ai-task-history'),
            require('./generation-result'),
            require('./instruction-stack')
        );
    } else {
        root.DraftHarborAITaskRunner = factory(
            root.DraftHarborAITaskContract,
            root.DraftHarborAITaskHistory,
            root.DraftHarborGenerationResult,
            root.DraftHarborInstructionStack
        );
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (AITaskContract, AITaskHistory, GenerationResult, InstructionStack) {
    function stripJsonFence(value) {
        return String(value || '').trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
    }

    function parseText(raw) {
        const text = String(raw || '');
        if (!text.trim()) throw new Error('AI provider returned an empty response.');
        return text;
    }

    function parseFieldPatch(raw) {
        const parsed = JSON.parse(stripJsonFence(raw));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('AI provider returned an invalid field patch.');
        }
        return parsed;
    }

    function parseCardDrafts(raw) {
        const parsed = JSON.parse(stripJsonFence(raw));
        const drafts = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.cards) ? parsed.cards : null;
        if (!drafts) throw new Error('AI provider returned an invalid card draft list.');
        return drafts;
    }

    function createAITaskRunner(options = {}) {
        const outputContracts = new Map([
            ['text', parseText],
            ['summary', parseText],
            ['field-patch', parseFieldPatch],
            ['card-drafts', parseCardDrafts]
        ]);
        const activeTargets = new Map();
        const hooks = [];
        const defaultStreamGeneration = options.streamGeneration;

        function registerOutputContract(name, parser) {
            if (!AITaskContract.OUTPUT_CONTRACTS.includes(name)) {
                throw new Error(`Unknown AI task output contract: ${name}`);
            }
            if (typeof parser !== 'function') throw new Error('Output contract parser must be a function');
            outputContracts.set(name, parser);
            return api;
        }

        function use(hook) {
            if (!hook || typeof hook !== 'object') throw new Error('AI task hook must be an object');
            hooks.push(hook);
            return api;
        }

        function emitState(callback, state) {
            if (typeof callback === 'function') callback({
                task: state.task,
                status: state.status,
                text: state.text,
                reasoning: state.reasoning,
                output: state.output,
                error: state.error || null
            });
        }

        function normalizeError(error, context = {}) {
            if (GenerationResult && typeof GenerationResult.normalizeGenerationError === 'function') {
                return GenerationResult.normalizeGenerationError(error, context);
            }
            return {
                ok: false,
                code: context.code || (error && error.name === 'AbortError' ? 'aborted' : 'generation_error'),
                provider: context.provider || '',
                model: context.model || '',
                message: error && error.message ? error.message : String(error || 'Unknown generation error')
            };
        }

        function failedResult(task, error, context = {}) {
            const normalized = normalizeError(error, context);
            const status = normalized.code === 'aborted' ? 'cancelled' : 'failed';
            const failedTask = { ...task, status, finishedAt: new Date().toISOString() };
            const record = AITaskHistory.createAITaskRecord({
                task: failedTask,
                status,
                provider: context.provider,
                model: context.model,
                messages: context.messages,
                promptText: context.promptText,
                resultText: context.resultText,
                reasoning: context.reasoning,
                error: normalized,
                startedAt: context.startedAt,
                finishedAt: failedTask.finishedAt
            });
            return { ok: false, status, task: failedTask, error: normalized, record };
        }

        async function run(taskInput, runOptions = {}) {
            let task;
            try {
                task = AITaskContract.createAITask(taskInput);
            } catch (error) {
                const normalizedTask = AITaskContract.normalizeAITask(taskInput);
                return failedResult(normalizedTask, error, { code: 'invalid_task' });
            }

            const targetKey = AITaskContract.taskTargetKey(task);
            if (activeTargets.has(targetKey)) {
                return failedResult(task, new Error('Another AI task is already running for this target.'), {
                    code: 'task_conflict'
                });
            }

            const streamGeneration = runOptions.streamGeneration || defaultStreamGeneration;
            if (typeof streamGeneration !== 'function') {
                return failedResult(task, new Error('AI task stream adapter is required'), {
                    code: 'missing_adapter'
                });
            }

            const controller = runOptions.abortController
                || (typeof AbortController !== 'undefined' ? new AbortController() : null);
            const providerConfig = { ...(runOptions.providerConfig || {}) };
            if (controller && !providerConfig.signal) providerConfig.signal = controller.signal;
            const prompt = runOptions.prompt || { messages: [] };
            providerConfig.aiTask = {
                domain: task.domain,
                action: task.action,
                target: task.target && typeof task.target === 'object'
                    ? { type: task.target.type, id: task.target.id }
                    : {}
            };
            if (!providerConfig.taskKind && InstructionStack
                && typeof InstructionStack.resolveTaskKindFromAITask === 'function') {
                providerConfig.taskKind = InstructionStack.resolveTaskKindFromAITask(task) || 'unknown';
            }
            const messages = Array.isArray(prompt.messages) ? prompt.messages : [];
            const promptText = prompt && typeof prompt.asString === 'function' ? prompt.asString() : '';
            const startedAt = new Date().toISOString();
            const state = {
                task: { ...task, status: 'running' },
                status: 'running',
                text: '',
                reasoning: '',
                output: null,
                error: null
            };
            const context = { task: state.task, prompt, providerConfig, targetKey };
            activeTargets.set(targetKey, { task: state.task, controller });
            emitState(runOptions.onStateChange, state);

            try {
                for (const hook of hooks) {
                    if (typeof hook.beforeRun === 'function') await hook.beforeRun(context);
                }
                await streamGeneration(prompt, (token, meta) => {
                    if (meta && meta.type === 'reasoning') state.reasoning += token;
                    else state.text += token;
                    if (typeof runOptions.onToken === 'function') {
                        runOptions.onToken({
                            token,
                            type: meta && meta.type ? meta.type : 'content',
                            text: state.text,
                            reasoning: state.reasoning,
                            task: state.task
                        });
                    }
                }, providerConfig);

                const parser = outputContracts.get(task.outputContract);
                if (!parser) throw new Error(`No parser registered for output contract ${task.outputContract}`);
                state.output = await parser(state.text, { task: state.task, prompt, reasoning: state.reasoning });
                for (const hook of hooks) {
                    if (typeof hook.afterOutput === 'function') {
                        const nextOutput = await hook.afterOutput({ ...context, output: state.output, text: state.text, reasoning: state.reasoning });
                        if (nextOutput !== undefined) state.output = nextOutput;
                    }
                }

                state.status = 'succeeded';
                state.task = { ...state.task, status: 'succeeded', finishedAt: new Date().toISOString() };
                const record = AITaskHistory.createAITaskRecord({
                    task: state.task,
                    status: state.status,
                    provider: providerConfig.provider || providerConfig.aiProvider || '',
                    model: providerConfig.model || providerConfig.aiModel || task.model || '',
                    messages,
                    promptText,
                    resultText: state.text,
                    resultData: state.output,
                    reasoning: state.reasoning,
                    startedAt,
                    finishedAt: state.task.finishedAt
                });
                emitState(runOptions.onStateChange, state);
                return {
                    ok: true,
                    status: state.status,
                    task: state.task,
                    targetKey,
                    text: state.text,
                    reasoning: state.reasoning,
                    output: state.output,
                    record
                };
            } catch (error) {
                const result = failedResult(task, error, {
                    provider: providerConfig.provider || providerConfig.aiProvider || '',
                    model: providerConfig.model || providerConfig.aiModel || task.model || '',
                    messages,
                    promptText,
                    resultText: state.text,
                    reasoning: state.reasoning,
                    startedAt
                });
                state.status = result.status;
                state.task = result.task;
                state.error = result.error;
                emitState(runOptions.onStateChange, state);
                return { ...result, targetKey, text: state.text, reasoning: state.reasoning };
            } finally {
                const active = activeTargets.get(targetKey);
                if (active && active.task.id === task.id) activeTargets.delete(targetKey);
            }
        }

        function cancel(taskOrTargetKey) {
            const targetKey = typeof taskOrTargetKey === 'string'
                ? taskOrTargetKey
                : AITaskContract.taskTargetKey(taskOrTargetKey || {});
            const active = activeTargets.get(targetKey);
            if (!active || !active.controller || typeof active.controller.abort !== 'function') return false;
            active.controller.abort();
            return true;
        }

        function isRunning(taskOrTargetKey) {
            const targetKey = typeof taskOrTargetKey === 'string'
                ? taskOrTargetKey
                : AITaskContract.taskTargetKey(taskOrTargetKey || {});
            return activeTargets.has(targetKey);
        }

        const api = {
            run,
            cancel,
            isRunning,
            registerOutputContract,
            use
        };
        return api;
    }

    return {
        createAITaskRunner,
        stripJsonFence,
        parseText,
        parseFieldPatch,
        parseCardDrafts
    };
});
