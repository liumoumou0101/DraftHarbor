(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DraftHarborPromptBuilder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const CHARACTER_FIELDS = Object.freeze([
        ['role', '角色定位'],
        ['goal', '目标'],
        ['motivation', '动机'],
        ['conflict', '冲突'],
        ['voice', '语气/声音'],
        ['currentState', '当前状态'],
        ['knowledge', '已知信息'],
        ['relationshipNotes', '关系备注']
    ]);

    function text(value) {
        return value === null || value === undefined ? '' : String(value);
    }

    function cleanBeat(value) {
        return text(value)
            .replace(/(?:@|#)\[[^\]]+\]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .join(' ');
    }

    function messagesToChatML(input) {
        const messages = Array.isArray(input) ? input : [];
        const turns = messages.map((message) => {
            return `<|im_start|>${text(message && message.role)}\n${text(message && message.content)}<|im_end|>`;
        });
        turns.push('<|im_start|>assistant\n');
        return turns.join('\n');
    }

    function promptObject(inputMessages, metadata) {
        const messages = Array.isArray(inputMessages) ? inputMessages : [];
        return Object.freeze({
            messages,
            meta: metadata && typeof metadata === 'object' ? metadata : {},
            asString: () => messagesToChatML(messages)
        });
    }

    function fillSystemTemplate(template, variables) {
        return text(template).trim().replace(/\{(povName|tense|pov)\}/gi, (match, key) => {
            const normalized = key.toLowerCase();
            if (normalized === 'povname') return variables.name;
            if (normalized === 'tense') return variables.tense;
            return variables.pov;
        });
    }

    function defaultSystemMessage(voice) {
        return [
            `Act as a fiction co-author. Continue from ${voice.name}'s point of view in ${voice.tense}, using ${voice.pov}.`,
            'Follow the language used by the author in the beat and nearby manuscript.',
            'Turn the requested beat into natural scene prose with concrete action and sensory detail.',
            'Preserve established facts, character intent, narrative voice, and continuity.'
        ].join(' ');
    }

    function renderCharacterProfile(entry) {
        if (!entry || entry.type !== 'character' || !entry.characterProfile) return '';
        const lines = CHARACTER_FIELDS
            .map(([key, label]) => entry.characterProfile[key] ? `${label}: ${entry.characterProfile[key]}` : '')
            .filter(Boolean);
        return lines.length ? `[${entry.title || '人物'} 结构化约束]\n${lines.join('\n')}` : '';
    }

    function renderCompendium(entries) {
        const blocks = (Array.isArray(entries) ? entries : []).map((entry) => {
            const title = entry.title || (entry.id ? `entry ${entry.id}` : 'Untitled entry');
            const body = entry.body || entry.content || entry.description || '';
            return [`-- ${title} --`, body, renderCharacterProfile(entry)].filter(Boolean).join('\n');
        }).filter(Boolean);
        return blocks.length ? ['COMPENDIUM REFERENCES:', ...blocks].join('\n\n') : '';
    }

    function renderSceneSummaries(scenes) {
        const blocks = (Array.isArray(scenes) ? scenes : [])
            .filter((scene) => scene && scene.summary)
            .map((scene) => `-- ${scene.title || 'Untitled Scene'} --\n${scene.summary}`);
        return blocks.length ? ['PREVIOUS SCENES:', ...blocks].join('\n\n') : '';
    }

    const LENGTH_HINTS = Object.freeze({
        brief: '这一拍写紧一点，点到即止，不要铺开。',
        natural: '',
        expanded: '这一拍可以稍展开感官、动作和对话，但仍写完即停。'
    });

    function normalizeLengthHint(value) {
        if (value && typeof value === 'object') {
            if (value.scale) return normalizeLengthHint(value.scale);
            return 'natural';
        }
        const raw = text(value).trim().toLowerCase();
        if (['brief', 'short', 'tight', '短', '紧', '写紧'].includes(raw)) return 'brief';
        if (['expanded', 'long', 'open', '长', '展开', '稍展开'].includes(raw)) return 'expanded';
        return 'natural';
    }

    function resolveOutputCloser(options) {
        const custom = text(options.outputCloser).trim();
        if (custom) return custom;
        const lines = [
            '接着当前正文往下写，语言和文风与已有正文、本拍一致。',
            '只完成本拍（BEAT TO EXPAND）里点到的事，写完即停。',
            '不要用固定段数或具体字数限制篇幅，也不要提前写下一拍或后续情节。'
        ];
        const extra = LENGTH_HINTS[normalizeLengthHint(options.lengthHint)];
        if (extra) lines.push(extra);
        return lines.join('');
    }

    function buildFictionPrompt(input) {
        const source = input && typeof input === 'object' ? input : {};
        const options = source.options && typeof source.options === 'object' ? source.options : {};
        const beat = cleanBeat(source.beat);
        const voice = {
            name: text(options.povCharacter).trim() || 'the protagonist',
            tense: options.tense === 'present' ? 'present tense' : 'past tense',
            pov: text(options.pov).trim() || '3rd person limited'
        };
        const system = text(options.systemPrompt).trim()
            ? fillSystemTemplate(options.systemPrompt, voice)
            : defaultSystemMessage(voice);

        const sections = [];
        if (text(source.sceneContext)) sections.push(`CURRENT SCENE SO FAR:\n${source.sceneContext}`);
        if (text(options.prosePrompt).trim()) {
            const prose = text(options.prosePrompt).trim();
            sections.push(options.preview ? prose : `--- PROMPT TEMPLATE START ---\n${prose}\n--- PROMPT TEMPLATE END ---`);
        }
        const compendium = renderCompendium(options.compendiumEntries);
        if (compendium) sections.push(compendium);
        const priorScenes = renderSceneSummaries(options.sceneSummaries);
        if (priorScenes) sections.push(priorScenes);
        sections.push(`BEAT TO EXPAND:\n${beat}`);
        sections.push(resolveOutputCloser(options));

        return promptObject([
            { role: 'system', content: system },
            { role: 'user', content: sections.join('\n\n') }
        ], {
            task: 'fiction-prose',
            beat,
            povCharacter: voice.name,
            pov: voice.pov,
            tense: voice.tense
        });
    }

    return Object.freeze({
        cleanBeat,
        messagesToChatML,
        promptObject,
        buildFictionPrompt,
        resolveOutputCloser,
        normalizeLengthHint,
        LENGTH_HINTS
    });
});
