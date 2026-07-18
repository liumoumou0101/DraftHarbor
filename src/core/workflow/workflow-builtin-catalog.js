(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./workflow-capability-registry'));
    } else {
        root.DraftHarborWorkflowBuiltinCatalog = factory(root.DraftHarborWorkflowCapabilityRegistry);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CapabilityRegistry) {
    const ARTIFACT_TYPES = Object.freeze([
        ['workflow-stage', '流程控制', 'json'], ['source-snapshot', '原文快照', 'json'],
        ['workflow-analysis', '原文分析', 'json'], ['creation-brief', '创作 Brief', 'json'],
        ['direction-set', '方向集合', 'json'], ['story-blueprint', '故事蓝图', 'json'],
        ['compendium-draft-bundle', '资料卡草稿包', 'json'], ['scene-plan', '场景计划', 'json'],
        ['draft-batch', '正文批次', 'text'], ['draft-review', '正文审查', 'json'],
        ['rewrite-plan', '重写计划', 'json'], ['rewrite-text', '重写正文', 'text'],
        ['rewrite-review', '重写审查', 'json'], ['transfer-result', '转交结果', 'json']
    ]);

    function input(id, label, artifactTypes, options = {}) {
        return { id, label, artifactTypes, required: options.required === true, multiple: options.multiple === true };
    }

    function output(id, label, artifactTypes) {
        return { id, label, artifactTypes };
    }

    const previous = () => input('previous', '流程输入', ['workflow-stage@1']);
    const next = () => output('next', '流程输出', ['workflow-stage@1']);
    const CAPABILITIES = Object.freeze([
        { id: 'writer.snapshot', title: '写作区快照', category: '输入', inputPorts: [], outputPorts: [next(), output('snapshot', '原文快照', ['source-snapshot@1'])] },
        { id: 'creation.brief', title: '创作 Brief', category: '输入', inputPorts: [], outputPorts: [next(), output('brief', 'Brief', ['creation-brief@1'])] },
        { id: 'analysis.extract', title: '原文分析', category: '分析', inputPorts: [previous(), input('source', '原文', ['source-snapshot@1'])], outputPorts: [next(), output('analysis', '分析', ['workflow-analysis@1'])] },
        { id: 'direction.design', title: '方向设计', category: '策划', inputPorts: [previous(), input('context', '分析或 Brief', ['workflow-analysis@1', 'creation-brief@1'])], outputPorts: [next(), output('directions', '方向', ['direction-set@1'])] },
        { id: 'creation.blueprint', title: '故事蓝图', category: '策划', inputPorts: [previous(), input('directions', '方向', ['direction-set@1'])], outputPorts: [next(), output('blueprint', '蓝图', ['story-blueprint@1'])] },
        { id: 'compendium.draw', title: '人物与世界观', category: '资料', inputPorts: [previous(), input('blueprint', '蓝图', ['story-blueprint@1'])], outputPorts: [next(), output('cards', '资料草稿', ['compendium-draft-bundle@1'])] },
        { id: 'outline.design', title: '场景计划与细纲', category: '策划', inputPorts: [previous(), input('context', '策划输入', ['direction-set@1', 'story-blueprint@1', 'rewrite-plan@1'])], outputPorts: [next(), output('plan', '场景计划', ['scene-plan@1'])] },
        { id: 'draft.batch', title: '分场正文', category: '生成', inputPorts: [previous(), input('plan', '场景计划', ['scene-plan@1'])], outputPorts: [next(), output('draft', '正文', ['draft-batch@1'])] },
        { id: 'review.draft', title: '正文审查', category: '审查', inputPorts: [previous(), input('draft', '正文', ['draft-batch@1'])], outputPorts: [next(), output('review', '审查', ['draft-review@1'])] },
        { id: 'rewrite.plan', title: '重写计划', category: '重写', inputPorts: [previous(), input('source', '原文', ['source-snapshot@1'])], outputPorts: [next(), output('plan', '重写计划', ['rewrite-plan@1'])] },
        { id: 'rewrite.batch', title: '大段重写', category: '重写', inputPorts: [previous(), input('plan', '重写计划', ['rewrite-plan@1'])], outputPorts: [next(), output('text', '重写正文', ['rewrite-text@1'])] },
        { id: 'rewrite.repair', title: '衔接修复', category: '重写', inputPorts: [previous(), input('text', '重写正文', ['rewrite-text@1'])], outputPorts: [next(), output('text', '修复正文', ['rewrite-text@1'])] },
        { id: 'review.rewrite', title: '重写审查', category: '审查', inputPorts: [previous(), input('text', '重写正文', ['rewrite-text@1'])], outputPorts: [next(), output('review', '审查', ['rewrite-review@1'])] },
        { id: 'transfer.apply', title: '转到写作与资料库', category: '转交', inputPorts: [previous(), input('draft', '正文或资料', ['draft-batch@1', 'compendium-draft-bundle@1', 'draft-review@1'])], outputPorts: [output('result', '转交结果', ['transfer-result@1'])] },
        { id: 'transfer.update', title: '更新写作区场景', category: '转交', inputPorts: [previous(), input('text', '重写正文', ['rewrite-text@1', 'rewrite-review@1'])], outputPorts: [output('result', '转交结果', ['transfer-result@1'])] }
    ]);

    function createBuiltinWorkflowRegistry() {
        const registry = CapabilityRegistry.createWorkflowCapabilityRegistry();
        ARTIFACT_TYPES.forEach(([id, title, payloadFormat]) => registry.registerArtifactType({ id, version: 1, title, payloadFormat }));
        CAPABILITIES.forEach((capability) => registry.registerCapability({ ...capability, version: 1 }));
        return registry;
    }

    return { ARTIFACT_TYPES, CAPABILITIES, createBuiltinWorkflowRegistry };
});
