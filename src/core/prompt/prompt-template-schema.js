(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborPromptTemplateSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PROMPT_CATEGORIES = Object.freeze(['prose', 'rewrite', 'summary', 'workshop', 'workflow']);
    const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

    function withProseContract(spec) {
        return Object.freeze({
            id: spec.id,
            title: spec.title,
            tags: spec.tags,
            systemContent: [
                '你是小说共写助手。从{povName}的视角，用{tense}、{pov}接着已有正文写。',
                '语言和文风跟随作者本拍与周围正文，除非作者明确要求换语言。',
                spec.systemFocus || '',
                '只输出可直接接入的小说正文，不要标题、提纲、评论或创作说明。'
            ].filter(Boolean).join(''),
            content: spec.content
        });
    }

    const DEFAULT_PROMPT_SPECS = Object.freeze({
        prose: Object.freeze([
            withProseContract({
                id: 'default-prose',
                title: '均衡续写',
                systemFocus: '先接上文口气，再完成本拍该发生的事。',
                content: '把本拍写成可直接接在当前正文后的小说。保留人物关系、视角、时间线和已有口气；动作、感官、对话和心里活动按需要出现。写完本拍就停，不要提前写下一拍或后续情节，也不要用固定段数卡篇幅。',
                tags: ['正文', '续写', '通用']
            }),
            withProseContract({
                id: 'default-prose-scene-forward',
                title: '推进局势',
                systemFocus: '这一拍要让局势往前走，不要原地打转。',
                content: '写清谁想要什么、碰到什么阻力、做了什么、局面因此怎么变。每一段至少留下新的信息、选择或后果。少停在空抒情，不要提前总结整场。',
                tags: ['正文', '剧情', '推进']
            }),
            withProseContract({
                id: 'default-prose-atmosphere',
                title: '感官氛围',
                systemFocus: '用具体感官把气氛写出来，但不要停成风景明信片。',
                content: '光线、声音、气味、温度、触感要经由人物察觉出现，并推动情绪或下一步动作。环境细节为这一拍服务，不要独立成段展览。',
                tags: ['正文', '氛围', '感官']
            }),
            withProseContract({
                id: 'default-prose-action',
                title: '动作场面',
                systemFocus: '空间和先后顺序必须站得住。',
                content: '写清谁在哪、手先碰到什么、危险从哪来、对方怎么反应。句子可以短。少解释动机，不新发明未铺垫的能力或道具。',
                tags: ['动作', '空间', '节奏']
            }),
            withProseContract({
                id: 'default-prose-dialogue',
                title: '对白交锋',
                systemFocus: '用说话推进，而不是用旁白转述谈话。',
                content: '每人开口都要有目的：试探、隐瞒、反击或示弱。口气要能听出是谁。潜台词放在停顿、视线和没说完的话里，不要把信息做成说明书。',
                tags: ['对白', '人物', '潜台词']
            }),
            withProseContract({
                id: 'default-prose-emotion',
                title: '情绪内心',
                systemFocus: '情绪要被看见，不要被贴标签。',
                content: '用身体反应、选择、回避、迟疑或被场景触发的记忆来写心情。欲望和害怕可以打架，但别替角色把心事说透，也别堆“悲伤/愤怒/害怕”。写完要能感到她下一步会怎么动。',
                tags: ['情绪', '内心', '克制']
            }),
            withProseContract({
                id: 'default-prose-romance',
                title: '情感拉扯',
                systemFocus: '关系变化要落在具体动作和没说出口的话上。',
                content: '写距离、视线、触碰、话到嘴边又收回。不要只写外貌和心跳，也不要让角色忽然换性格。亲密可以直，但必须还是这两个人。',
                tags: ['情感', '关系', '拉扯']
            }),
            withProseContract({
                id: 'default-prose-tension',
                title: '加压不安',
                systemFocus: '信息要一点一点放出，先不安，再更糟。',
                content: '先让一个细节不对劲，再让人物判断或环境把它放大。可以是悬疑、惊吓或对峙。少解释来源，不提前揭底，也不要用突然的外力把压力泄掉。',
                tags: ['紧张', '悬疑', '不安']
            }),
            withProseContract({
                id: 'default-prose-opening-hook',
                title: '开场钩子',
                systemFocus: '尽快让读者站住：画面、异常或一个想看下去的问题。',
                content: '当这一拍是场景或章节开头来写。先给能站住的画面、目标或冲突，再补背景。不要从空泛介绍或天气咏叹起笔。',
                tags: ['开场', '钩子']
            }),
            withProseContract({
                id: 'default-prose-afterglow',
                title: '收束留白',
                systemFocus: '这一拍是收尾：余波要清楚，下文只留一口气。',
                content: '收住当前事件的情绪和后果，留下一个变化、决定或未说完的东西。可以留白，但读者得知道这一拍之后局面已经不同。不要另开新冲突。',
                tags: ['结尾', '余韵']
            }),
            withProseContract({
                id: 'default-prose-webnovel',
                title: '网文推进',
                systemFocus: '节奏要能往下翻：目标、阻碍、反击，收在一个小钩子上。',
                content: '目标清楚，反击有力，情绪可以外放，但别中二喊口号。本拍结束时最好留下下一步想看的东西。',
                tags: ['网文', '连载', '爽点']
            }),
            withProseContract({
                id: 'default-prose-literary',
                title: '文学凝练',
                systemFocus: '少形容词，让画面、动作和沉默自己工作。',
                content: '意象要准，句子有收有放。不为文采牺牲谁在做什么。不要堆成语和空比喻。',
                tags: ['文学', '意象', '凝练']
            }),
            withProseContract({
                id: 'default-prose-outline-to-scene',
                title: '提纲成场',
                systemFocus: '本拍若是提纲，把它写成场面，不要改事件顺序。',
                content: '补开端、冲突、关键动作、人物反应和收束。核心事件顺序跟提纲走，只加让场面站得住的细节。',
                tags: ['大纲', '成文']
            })
        ]),
        rewrite: Object.freeze([
            {
                id: 'default-rewrite-balanced',
                key: 'balanced-polish',
                title: '润色',
                hint: '句子更顺、更有画面，事实和视角不动。篇幅差不多。',
                content: '重写选中文段，让句子更顺、更有画面，但事实、人物关系和视角不动。篇幅跟原文差不多。只输出改写后的正文。',
                tags: ['改写', '润色']
            },
            {
                id: 'default-rewrite-tighten',
                key: 'tighten',
                title: '压缩',
                hint: '删重复和注水，明显写短，不砍关键动作。',
                content: '删掉重复、解释和注水，留下动作、信息和情绪。明显写短一截，不要为了短而砍掉关键动作。只输出改写后的正文。',
                tags: ['改写', '压缩']
            },
            {
                id: 'default-rewrite-expand',
                key: 'expand',
                title: '铺开',
                hint: '补动作和用得上的细节，稍铺开，不翻倍。',
                content: '补动作衔接、身体反应和环境里用得上的细节。剧情和意图不变，比原文稍铺开，不要翻倍注水。只输出改写后的正文。',
                tags: ['改写', '扩写']
            },
            {
                id: 'default-rewrite-show-dont-tell',
                key: 'show-dont-tell',
                title: '少说多看',
                hint: '说明改成能看见的动作和反应。',
                content: '把说明、总结和情绪标签改成能看见的动作、感官和反应。原意留下，别改成解说。只输出改写后的正文。',
                tags: ['改写', '呈现']
            },
            {
                id: 'default-rewrite-dialogue',
                key: 'dialogue-natural',
                title: '对白口吻',
                hint: '听得出是谁在说，潜台词放在停顿里。',
                content: '重写对白，让人听得出是谁在说。少书面腔和信息直给，用停顿和动作托住潜台词。信息不丢。只输出改写后的正文。',
                tags: ['改写', '对白']
            },
            {
                id: 'default-rewrite-character-voice',
                key: 'character-voice',
                title: '角色声音',
                hint: '用词和反应像当前这个人。',
                content: '用词、观察重点和反应方式要像当前视角人物，而不是旁白腔。信息保留。只输出改写后的正文。',
                tags: ['改写', '角色']
            },
            {
                id: 'default-rewrite-tension',
                key: 'tension',
                title: '加压',
                hint: '提高紧张感：停顿、距离、没说破的危险。',
                content: '提高紧张感。加快警觉和未知感：停顿、距离、没说破的危险。事件不变，不提前揭底。只输出改写后的正文。',
                tags: ['改写', '紧张']
            },
            {
                id: 'default-rewrite-pace-fast',
                key: 'pace-fast',
                title: '加快',
                hint: '句子更短，动作链更清楚，少解释。',
                content: '句子更短，动作链更清楚，少内心解释。冲突往前推，事件不变。只输出改写后的正文。',
                tags: ['改写', '节奏']
            },
            {
                id: 'default-rewrite-continuity',
                key: 'continuity',
                title: '接上文',
                hint: '修好指代、时间和视角越界。',
                content: '修好代词、时间、动作先后、知情范围和视角越界。不引入新设定。只输出改写后的正文。',
                tags: ['改写', '连续']
            },
            {
                id: 'default-rewrite-literary',
                key: 'literary',
                title: '凝练',
                hint: '去掉套话，意象准一点。',
                content: '去掉套话和空比喻，意象准一点，句子有收。别为了文采改剧情。只输出改写后的正文。',
                tags: ['改写', '文学']
            },
            {
                id: 'default-rewrite-grammar-copyedit',
                key: 'grammar-copyedit',
                title: '校对',
                hint: '只改正字病句标点，口气不动。',
                content: '只改正字、病句、标点和明显不顺的地方。句式、口气和篇幅尽量不动，不扩写，不改剧情。只输出改写后的正文。',
                tags: ['改写', '校对']
            }
        ]),
        summary: Object.freeze([
            {
                id: 'default-summary-scene',
                title: '场景摘要',
                systemContent: '你在为后续续写做检索笔记，不是写书评。只记事实，短，中性。',
                content: '写这一场发生了什么、谁的目标变了、留下哪条线索或未决问题。一小段即可，不要文风评价，不要写成宣传语。',
                tags: ['摘要', '场景']
            },
            {
                id: 'default-summary-chapter',
                title: '章节摘要',
                systemContent: '你在为长篇整理章笔记。结构清楚，只记推进和后果。',
                content: '汇总本章情节推进、人物变化、冲突结果、未收伏笔，以及下一章从哪接。适合放进章节摘要栏。',
                tags: ['摘要', '章节']
            },
            {
                id: 'default-summary-character-arc',
                title: '角色变化',
                systemContent: '你在更新人物卡，不是写读后感。',
                content: '按人物分条：这一段里目标、态度、关系、秘密、损失或获得有什么变化。没写到的不要编。',
                tags: ['摘要', '角色']
            },
            {
                id: 'default-summary-plot-thread',
                title: '线索清单',
                systemContent: '你在跟踪未完成的承诺和伏笔。',
                content: '列出已出现的伏笔、约定、危险、误会和读者会惦记的问题，并标明现在解决了没有。',
                tags: ['摘要', '线索']
            },
            {
                id: 'default-summary-continuity-risk',
                title: '连续性风险',
                systemContent: '你在挑前后对不上的地方，要有依据。',
                content: '检查时间、地点、知情范围、物品去向、伤势/能力、称呼和设定规则。只写风险和文本依据，不改正文。',
                tags: ['摘要', '连续']
            }
        ]),
        workshop: Object.freeze([
            {
                id: 'default-workshop-coach',
                title: '写作顾问',
                systemContent: '你是具体的写作搭档。结合项目上下文说话，少空鼓励。',
                content: '先回答作者眼下的问题，再给可执行的下一步。若有几条路，说明各适合写出什么效果。',
                tags: ['讨论', '顾问']
            },
            {
                id: 'default-workshop-plot-doctor',
                title: '剧情诊断',
                systemContent: '你看病在结构、因果和读者为什么要往下看。',
                content: '看目标清不清、冲突够不够、因果顺不顺、哪里泄压太早。建议要能改成下一场，不要鸡汤。',
                tags: ['讨论', '剧情']
            },
            {
                id: 'default-workshop-character',
                title: '角色问答',
                systemContent: '从动机、害怕、欲望和说话方式看人。',
                content: '建议要能变成一场戏、一句台词或人物卡上的一条。少类型标签，多这个人会怎么做。',
                tags: ['讨论', '角色']
            },
            {
                id: 'default-workshop-scene-plan',
                title: '场景规划',
                systemContent: '开写前先把这一场的职责说清楚。',
                content: '写清：这场要完成什么、谁在场、开场状态、冲突、放出什么信息、情绪怎么转、收在什么状态、下一场从哪接。',
                tags: ['讨论', '场景']
            },
            {
                id: 'default-workshop-dialogue',
                title: '对白会诊',
                systemContent: '看每句话谁想要什么，而不是好不好听。',
                content: '指出谁在要什么、明说了什么、藏了什么、哪里像说明书、哪里没有角色声音。给可替换的台词方向。',
                tags: ['讨论', '对白']
            },
            {
                id: 'default-workshop-revision',
                title: '修订计划',
                systemContent: '按伤害排序，不平均用力。',
                content: '按优先级列出结构、人物、节奏、设定和语言问题。每项写：为什么改、怎么改、改完怎么验收。',
                tags: ['讨论', '修订']
            }
        ]),
        workflow: Object.freeze([
            {
                id: 'default-workflow-brief',
                title: '项目设定',
                systemContent: '整理成作者能勾选确认的笔记，不要写成正文。',
                content: '列出题材、核心冲突、主角要什么、世界里不能破的规则、重要人物、已知限制和还没定的问题。',
                tags: ['工作流', '设定']
            },
            {
                id: 'default-workflow-outline',
                title: '章节大纲',
                systemContent: '只写大纲，结构清楚，方便改。',
                content: '每章写目标、冲突、转折、情绪、伏笔和章末钩子。不写场面正文。',
                tags: ['工作流', '大纲']
            },
            {
                id: 'default-workflow-scene-draft',
                title: '场景草稿',
                systemContent: '按已确认的大纲写一场可审的正文。',
                content: '只写一个场景。冲突、行动和收束要清楚，能直接放进项目里再改。',
                tags: ['工作流', '草稿']
            },
            {
                id: 'default-workflow-character-bible',
                title: '人物小传',
                systemContent: '写能用在后文的人物笔记。',
                content: '每人写：表面身份、真正想要的、怕什么、秘密、能力边界、说话方式、和谁别着劲、此刻状态。',
                tags: ['工作流', '人物']
            },
            {
                id: 'default-workflow-revision-pass',
                title: '修订清单',
                systemContent: '清单要能拿去改稿，不要空评价。',
                content: '按结构、人物、情节、节奏、设定连续性和语言分类。每项给修改目标和怎样算改完。',
                tags: ['工作流', '修订']
            },
            {
                id: 'default-workflow-continuity-audit',
                title: '连续性审计',
                systemContent: '挑对不上的地方，写依据。',
                content: '查时间线、地点、知情范围、物品、伤势、称呼和已埋伏笔。列出问题、依据和建议处理。',
                tags: ['工作流', '连续']
            }
        ])
    });

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function timestamp(value) {
        if (value) {
            const date = new Date(value);
            if (!Number.isNaN(date.getTime())) return date.toISOString();
        }
        return new Date().toISOString();
    }

    function makeId(category = 'prompt') {
        return `${category}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function createPromptTemplate(input = {}) {
        const category = PROMPT_CATEGORIES.includes(input.category) ? input.category : 'prose';
        const now = timestamp(input.createdAt || input.created);
        return {
            id: cleanString(input.id, makeId(category)),
            projectId: cleanString(input.projectId),
            category,
            key: cleanString(input.key),
            title: cleanString(input.title, '新提示词') || '新提示词',
            hint: cleanString(input.hint),
            systemContent: input.systemContent === undefined ? cleanString(input.systemPrompt) : String(input.systemContent || ''),
            content: input.content === undefined ? cleanString(input.prosePrompt || input.userContent) : String(input.content || ''),
            tags: Array.isArray(input.tags) ? input.tags.map(cleanString).filter(Boolean) : [],
            isDefault: !!input.isDefault,
            createdAt: timestamp(input.createdAt || input.created || now),
            updatedAt: timestamp(input.updatedAt || input.modified || now)
        };
    }

    function normalizePromptTemplates(prompts = [], projectId = '') {
        const seen = new Set();
        return (Array.isArray(prompts) ? prompts : [])
            .map((prompt) => createPromptTemplate({
                ...prompt,
                projectId: cleanString(prompt && prompt.projectId, projectId)
            }))
            .filter((prompt) => {
                if (seen.has(prompt.id)) return false;
                seen.add(prompt.id);
                return true;
            })
            .sort((a, b) => {
                const categoryCompare = a.category.localeCompare(b.category);
                if (categoryCompare) return categoryCompare;
                return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
            });
    }

    function defaultPromptTemplates(category = '', projectId = '') {
        const categories = PROMPT_CATEGORIES.includes(category)
            ? [category]
            : PROMPT_CATEGORIES.filter((item) => DEFAULT_PROMPT_SPECS[item]);
        return categories.flatMap((item) => (DEFAULT_PROMPT_SPECS[item] || []).map((spec) => createPromptTemplate({
            ...spec,
            projectId,
            category: item,
            isDefault: true,
            createdAt: DEFAULT_TIMESTAMP,
            updatedAt: DEFAULT_TIMESTAMP
        })));
    }

    function defaultProsePrompt(projectId = '') {
        return defaultPromptTemplates('prose', projectId)[0];
    }

    function isDefaultPromptId(promptId) {
        const id = cleanString(promptId);
        if (!id) return false;
        return defaultPromptTemplates().some((prompt) => prompt.id === id);
    }

    function rewritePresetByKey(key) {
        const wanted = cleanString(key);
        const presets = defaultPromptTemplates('rewrite');
        return presets.find((prompt) => prompt.key === wanted) || presets[0] || null;
    }

    return {
        PROMPT_CATEGORIES,
        createPromptTemplate,
        normalizePromptTemplates,
        defaultPromptTemplates,
        defaultProsePrompt,
        isDefaultPromptId,
        rewritePresetByKey
    };
});
