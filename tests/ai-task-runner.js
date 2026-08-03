const assert = require('assert');

const AITaskContract = require('../src/core/generation/ai-task-contract');
const AITaskHistory = require('../src/core/generation/ai-task-history');
const AITaskRunner = require('../src/core/generation/ai-task-runner');

function proseTask(overrides = {}) {
    return {
        projectId: 'project-1',
        domain: 'prose',
        action: 'rewrite',
        target: { type: 'scene', sceneId: 'scene-1' },
        scope: 'selection',
        instruction: 'Keep the meaning.',
        outputContract: 'text',
        ...overrides
    };
}

(async () => {
    const lifecycle = [];
    const runner = AITaskRunner.createAITaskRunner({
        streamGeneration: async (prompt, onToken, config) => {
            assert.strictEqual(config.model, 'test-model');
            assert.ok(config.signal, 'runner should provide an AbortSignal');
            assert.strictEqual(config.taskKind, 'writer-rewrite', 'runner should normalize task identity for Directive Stack');
            assert.strictEqual(config.aiTask.target.type, 'scene', 'runner should forward a safe task summary');
            onToken('Reasoning', { type: 'reasoning' });
            onToken('Rewritten', { type: 'content' });
            onToken(' text.');
        }
    });
    runner.use({
        beforeRun(context) {
            lifecycle.push(`before:${context.task.action}`);
        },
        afterOutput(context) {
            lifecycle.push(`after:${context.output}`);
        }
    });

    const result = await runner.run(proseTask({
        beforeSnapshot: { originalText: 'Original text.' },
        contextReferences: [{ type: 'scene', id: 'scene-context' }]
    }), {
        prompt: {
            messages: [{ role: 'user', content: 'Rewrite this.' }],
            asString() { return 'prompt text'; }
        },
        providerConfig: {
            mode: 'api',
            provider: 'test-provider',
            model: 'test-model',
            apiKey: 'must-not-be-recorded'
        }
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 'succeeded');
    assert.strictEqual(result.text, 'Rewritten text.');
    assert.strictEqual(result.reasoning, 'Reasoning');
    assert.strictEqual(result.output, 'Rewritten text.');
    assert.strictEqual(result.record.domain, 'prose');
    assert.strictEqual(result.record.action, 'rewrite');
    assert.strictEqual(result.record.outputContract, 'text');
    assert.deepStrictEqual(result.record.beforeSnapshot, { originalText: 'Original text.' });
    assert.deepStrictEqual(result.record.contextReferences, [{ type: 'scene', id: 'scene-context' }]);
    assert.deepStrictEqual(lifecycle, ['before:rewrite', 'after:Rewritten text.']);
    assert.ok(!JSON.stringify(result.record).includes('must-not-be-recorded'), 'task history must not record API keys');

    const legacy = AITaskHistory.toLegacyGenerationRecord(result.record, {
        sceneId: 'scene-1',
        beat: 'Keep the meaning.'
    });
    assert.strictEqual(legacy.sceneId, 'scene-1');
    assert.strictEqual(legacy.task, 'rewrite');
    assert.strictEqual(legacy.resultText, 'Rewritten text.');
    assert.strictEqual(legacy.aiTask.domain, 'prose');
    assert.strictEqual(legacy.aiTask.outputContract, 'text');
    assert.deepStrictEqual(legacy.aiTask.beforeSnapshot, { originalText: 'Original text.' });

    const emptyRunner = AITaskRunner.createAITaskRunner({
        streamGeneration: async () => {}
    });
    const empty = await emptyRunner.run(proseTask(), { prompt: { messages: [] } });
    assert.strictEqual(empty.ok, false);
    assert.strictEqual(empty.status, 'failed');
    assert.ok(empty.error.message.includes('empty response'));

    const cardRunner = AITaskRunner.createAITaskRunner({
        streamGeneration: async (prompt, onToken) => onToken('```json\n{"summary":"Sharper"}\n```')
    });
    const card = await cardRunner.run({
        projectId: 'project-1',
        domain: 'compendium',
        action: 'rewrite',
        target: { type: 'entry', entryId: 'entry-1' },
        scope: 'field',
        outputContract: 'field-patch'
    }, { prompt: { messages: [] } });
    assert.strictEqual(card.ok, true);
    assert.deepStrictEqual(card.output, { summary: 'Sharper' });

    let releaseConflict;
    const conflictRunner = AITaskRunner.createAITaskRunner({
        streamGeneration: async (prompt, onToken) => new Promise((resolve) => {
            releaseConflict = () => {
                onToken('First result');
                resolve();
            };
        })
    });
    const firstPromise = conflictRunner.run(proseTask({ id: 'first-task' }), { prompt: { messages: [] } });
    await Promise.resolve();
    assert.strictEqual(conflictRunner.isRunning(AITaskContract.taskTargetKey(proseTask())), true);
    const conflict = await conflictRunner.run(proseTask({ id: 'second-task' }), { prompt: { messages: [] } });
    assert.strictEqual(conflict.ok, false);
    assert.strictEqual(conflict.error.code, 'task_conflict');
    releaseConflict();
    assert.strictEqual((await firstPromise).ok, true);

    const cancelRunner = AITaskRunner.createAITaskRunner({
        streamGeneration: async (prompt, onToken, config) => new Promise((resolve, reject) => {
            config.signal.addEventListener('abort', () => {
                const error = new Error('Cancelled');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        })
    });
    const cancelTask = proseTask({ id: 'cancel-task' });
    const cancelKey = AITaskContract.taskTargetKey(cancelTask);
    const cancelPromise = cancelRunner.run(cancelTask, { prompt: { messages: [] } });
    await Promise.resolve();
    assert.strictEqual(cancelRunner.cancel(cancelKey), true);
    const cancelled = await cancelPromise;
    assert.strictEqual(cancelled.ok, false);
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual(cancelled.error.code, 'aborted');
    assert.strictEqual(cancelRunner.isRunning(cancelKey), false);

    console.log('AI task runner tests passed.');
})().catch((error) => {
    console.error('AI task runner tests failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
