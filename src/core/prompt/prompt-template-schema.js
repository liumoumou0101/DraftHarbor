(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborPromptTemplateSchema = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PROMPT_CATEGORIES = Object.freeze(['prose', 'rewrite', 'summary', 'workshop', 'workflow']);
    const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

    const DEFAULT_PROMPT_SPECS = Object.freeze({
        prose: Object.freeze([
            {
                id: 'default-prose',
                title: '正文续写：均衡扩写',
                systemContent: 'You are a fiction co-writing assistant. Write from {povName}\'s point of view, in {tense}, using {pov}. Use the same language as the author\'s beat and surrounding scene text unless the author explicitly requests another language. Match the author\'s tone and style.',
                content: '把写作指令扩写成自然、可直接接入当前场景的小说正文。保留上下文中的人物关系、叙事视角、时间线和语气；优先写清动作、感受、环境细节和情绪变化。默认输出 2-4 段，不解释创作思路，不写标题。',
                tags: ['正文', '续写', '通用']
            },
            {
                id: 'default-prose-scene-forward',
                title: '正文续写：剧情推进',
                systemContent: 'You are a disciplined fiction drafting assistant. Preserve continuity, character intent, and point of view.',
                content: '根据写作指令继续推进当前场景。优先写清楚角色目标、阻力、行动和结果；让每一段都带来新的信息、选择或局势变化。不要原地抒情太久，不要提前总结，输出可直接接在正文后的小说文本。',
                tags: ['正文', '剧情', '推进']
            },
            {
                id: 'default-prose-atmosphere',
                title: '正文续写：氛围描写',
                systemContent: 'You are a fiction stylist who strengthens atmosphere without losing narrative motion.',
                content: '扩写时加强场景氛围、感官细节和人物细微反应，但不要停在纯描写里。让环境细节服务于情绪、冲突或伏笔；保持动作推进，让氛围从人物观察和场景变化中自然出现。',
                tags: ['正文', '氛围', '感官']
            },
            {
                id: 'default-prose-action',
                title: '动作场面：快速推进',
                systemContent: 'You are an action-scene fiction assistant. Write clear physical motion, spatial logic, and immediate stakes.',
                content: '把指令写成节奏紧凑的动作场面。突出人物位置、动作顺序、危险来源、即时反应和局势变化；句子可以更短，减少解释和内心独白。不要让动作失去空间逻辑，也不要突然引入未铺垫的新能力。',
                tags: ['动作', '战斗', '追逐']
            },
            {
                id: 'default-prose-dialogue',
                title: '对白场景：人物交锋',
                systemContent: 'You write dialogue-driven fiction scenes with distinct character voices and subtext.',
                content: '把指令写成以对白推进的场景。让每个角色说话方式有差异，台词要带目标、试探、隐瞒或反击；用少量动作、停顿和视线变化承载潜台词。不要把信息直接讲成说明书。',
                tags: ['对白', '人物', '潜台词']
            },
            {
                id: 'default-prose-emotion',
                title: '情绪场景：克制内心',
                systemContent: 'You write emotionally precise fiction without melodrama.',
                content: '把指令写成情绪层次清楚但克制的场景。通过身体反应、选择、迟疑、回避、记忆闪回或微小动作表现人物情绪；避免堆砌“悲伤、愤怒、害怕”等标签，也不要替角色把所有心事说透。',
                tags: ['情绪', '内心', '克制']
            },
            {
                id: 'default-prose-suspense',
                title: '悬疑紧张：逐步加压',
                systemContent: 'You write suspense scenes that reveal information gradually and keep causal logic intact.',
                content: '把指令写成逐步加压的悬疑/紧张场景。先建立异常，再扩大不安，最后给出新的线索或更危险的问题。控制信息释放，不提前揭底；让读者能感到人物判断、误判和环境细节之间的联系。',
                tags: ['悬疑', '紧张', '线索']
            },
            {
                id: 'default-prose-romance',
                title: '情感互动：暧昧拉扯',
                systemContent: 'You write intimate character interaction with restraint, chemistry, and believable emotional stakes.',
                content: '把指令写成有情感张力的互动场景。通过距离、眼神、动作、话没说完的部分和彼此试探来表现关系变化；不要只写外貌和心跳，也不要让角色突然失去原本性格。',
                tags: ['情感', '暧昧', '关系']
            },
            {
                id: 'default-prose-comedy',
                title: '轻松日常：幽默节奏',
                systemContent: 'You write light slice-of-life fiction with timing, warmth, and character-based humor.',
                content: '把指令写成轻松、可读、有生活感的日常段落。幽默来自人物性格、误会、反差和节奏，不依赖尴尬堆砌；保持剧情有小目标和小变化，让段落既松弛又不散。',
                tags: ['日常', '轻松', '幽默']
            },
            {
                id: 'default-prose-worldbuilding',
                title: '世界观展开：设定入戏',
                systemContent: 'You integrate worldbuilding into action, conflict, and lived experience instead of exposition dumps.',
                content: '把设定自然写进场景。通过人物使用、遵守、误解或违反规则来展示世界观；让制度、技术、魔法、风俗或历史影响当前冲突。不要整段百科式说明，读者需要先看见设定如何改变人物处境。',
                tags: ['世界观', '设定', '奇幻']
            },
            {
                id: 'default-prose-introspection',
                title: '内心独白：自我拉扯',
                systemContent: 'You write introspective fiction that remains specific, conflicted, and anchored in scene details.',
                content: '把指令写成有内在矛盾的心理段落。让人物在欲望、恐惧、责任、记忆和当下选择之间拉扯；内心活动要被具体场景触发，并反过来影响下一步行动。不要空泛哲理化。',
                tags: ['心理', '独白', '矛盾']
            },
            {
                id: 'default-prose-transition',
                title: '转场衔接：顺滑过渡',
                systemContent: 'You write transitions that connect scenes, time, and emotional continuity clearly.',
                content: '根据指令写一段用于连接前后情节的过渡。交代必要的时间、地点、人物状态和情绪余波，同时尽快把读者带入下一件重要事情。不要流水账式概括太多无关过程。',
                tags: ['转场', '衔接', '过渡']
            },
            {
                id: 'default-prose-opening-hook',
                title: '开场钩子：抓住读者',
                systemContent: 'You write opening paragraphs that establish voice, situation, and reader curiosity quickly.',
                content: '把指令写成章节或场景开头。第一段要给出鲜明画面、异常、目标、冲突或一句有钩子的叙述；尽快建立人物处境和读者疑问。不要从泛泛背景介绍开始。',
                tags: ['开场', '钩子', '章节']
            },
            {
                id: 'default-prose-climax',
                title: '高潮段落：冲突爆发',
                systemContent: 'You write climactic fiction scenes with consequences, reversals, and clear emotional payoff.',
                content: '把指令写成冲突爆发或关键转折段落。让角色必须做选择、付代价或暴露真实立场；动作、对白和心理要共同推向结果。不要让高潮只靠大声喊叫或突然外力解决。',
                tags: ['高潮', '冲突', '转折']
            },
            {
                id: 'default-prose-afterglow',
                title: '余韵收束：留白收尾',
                systemContent: 'You write scene endings that provide emotional aftertaste and forward momentum.',
                content: '把指令写成场景或章节结尾。收束当前事件的情绪余波，留下一个清晰的变化、悬念、决定或回声。可以留白，但要让读者知道这一段之后局势已经不同。',
                tags: ['结尾', '余韵', '留白']
            },
            {
                id: 'default-prose-webnovel',
                title: '网文连载：爽点推进',
                systemContent: 'You write serial fiction with clear momentum, readable emotion, and strong hooks.',
                content: '把指令写成适合中文连载阅读的段落。节奏明确，目标、阻碍、反击和爽点要清楚；情绪外放但不过度中二，结尾尽量带下一步期待或小钩子。',
                tags: ['网文', '连载', '爽点']
            },
            {
                id: 'default-prose-literary',
                title: '文学质感：凝练意象',
                systemContent: 'You write literary fiction with precise imagery, restraint, and narrative clarity.',
                content: '把指令写成更凝练、有余韵的小说段落。使用准确的意象和节奏，不堆砌华丽形容词；让画面、动作和沉默承载意义。保持叙事清楚，不为文风牺牲可读性。',
                tags: ['文学', '意象', '凝练']
            },
            {
                id: 'default-prose-mystery-clue',
                title: '线索铺陈：埋伏笔',
                systemContent: 'You write clue placement for mystery and long-form continuity. Be fair, subtle, and memorable.',
                content: '把指令写成带伏笔的场景。线索要能被读者回头识别，但初读时可以伪装成环境、习惯、对白漏洞或异常选择。不要直接提示“这是伏笔”，也不要让线索完全不可见。',
                tags: ['伏笔', '线索', '悬疑']
            },
            {
                id: 'default-prose-horror',
                title: '惊悚氛围：不安递增',
                systemContent: 'You write horror and unease through implication, sensory distortion, and controlled pacing.',
                content: '把指令写成不安逐渐增强的惊悚段落。先写可疑细节和人物感知偏差，再让环境、声音、温度、光线或他人反应变得不对劲。少解释来源，多保留未知。',
                tags: ['惊悚', '恐怖', '不安']
            },
            {
                id: 'default-prose-outline-to-scene',
                title: '大纲转场景：从提纲成文',
                systemContent: 'You convert outlines into complete fiction scenes while preserving the intended beats.',
                content: '把提纲或简短事件扩写成完整场景。补足开端、冲突推进、关键动作、人物反应和结尾承接；不要改变提纲中的核心事件顺序，但可以增加必要细节让场景成立。',
                tags: ['大纲', '成文', '草稿']
            }
        ]),
        rewrite: Object.freeze([
            {
                id: 'default-rewrite-balanced',
                title: '改写：均衡润色',
                content: '请重写选中文段，使语言更自然、流畅、有画面感，同时保留原意、事实信息、人物关系和叙事视角。不要扩写过多，长度尽量接近原文。',
                tags: ['改写', '润色', '通用']
            },
            {
                id: 'default-rewrite-tighten',
                title: '改写：压缩精炼',
                content: '请压缩并精炼选中文段，删除重复、拖沓、解释过度的句子，让表达更干净有力。保留关键动作、信息和情绪，长度约为原文的 60%-80%。',
                tags: ['改写', '压缩', '精炼']
            },
            {
                id: 'default-rewrite-expand',
                title: '改写：适度扩写',
                content: '请适度扩写选中文段，补足必要的动作衔接、心理反应、环境细节和节奏停顿。不要改变剧情走向和人物意图，长度约为原文的 1.3-1.8 倍。',
                tags: ['改写', '扩写', '细节']
            },
            {
                id: 'default-rewrite-show-dont-tell',
                title: '改写：少解释多呈现',
                content: '请把选中文段中的直白说明、总结性描述和情绪标签，改写成具体动作、感官细节、人物反应和可观察的场景表现。保留原本要表达的情绪和信息。',
                tags: ['改写', '呈现', '动作']
            },
            {
                id: 'default-rewrite-dialogue',
                title: '改写：对白自然化',
                content: '请重写选中文段中的对白，让台词更自然、有角色感，减少书面腔和信息直给。保留原本要传达的信息，并加入适量动作或停顿来承载潜台词。',
                tags: ['改写', '对白', '口语']
            },
            {
                id: 'default-rewrite-cinematic',
                title: '改写：电影镜头感',
                content: '请重写选中文段，增强电影镜头感。用清晰的画面调度、动作顺序、视线移动和环境反应来呈现场景。避免解释镜头术语，直接写成小说正文。',
                tags: ['改写', '画面', '镜头']
            },
            {
                id: 'default-rewrite-sensory',
                title: '改写：增强感官',
                content: '请重写选中文段，增强视觉、声音、触感、气味、温度或空间感等感官细节。细节要服务于人物处境和情绪，不要堆砌形容词，不要偏离原剧情。',
                tags: ['改写', '感官', '氛围']
            },
            {
                id: 'default-rewrite-tension',
                title: '改写：提高紧张感',
                content: '请重写选中文段，提高紧张感和压迫感。加强动作节奏、停顿、未知感、人物警觉或危险暗示。保持原事件不变，不要提前揭示答案。',
                tags: ['改写', '紧张', '冲突']
            },
            {
                id: 'default-rewrite-pace-fast',
                title: '改写：加快节奏',
                content: '请重写选中文段，让节奏更快、更利落。减少解释和内心独白，使用更短的句子、更清晰的动作链和更直接的冲突推进。',
                tags: ['改写', '节奏', '加快']
            },
            {
                id: 'default-rewrite-pace-slow',
                title: '改写：放慢节奏',
                content: '请重写选中文段，放慢叙事节奏，增加停顿、观察、细微动作和情绪层次。让读者更充分感受到这一刻的重要性，但不要重复啰嗦。',
                tags: ['改写', '节奏', '放慢']
            },
            {
                id: 'default-rewrite-subtext',
                title: '改写：增加潜台词',
                content: '请重写选中文段，增加潜台词。让人物少直接说出真实想法，把矛盾、犹豫、亲近或敌意藏在措辞、停顿、动作和反应里。不要改变人物立场。',
                tags: ['改写', '潜台词', '对白']
            },
            {
                id: 'default-rewrite-emotion-deeper',
                title: '改写：加深情绪',
                content: '请重写选中文段，加深人物情绪层次。通过身体反应、记忆闪回、细微动作或自我克制来表现情绪，不要直接堆砌情绪标签。',
                tags: ['改写', '情绪', '内心']
            },
            {
                id: 'default-rewrite-character-voice',
                title: '改写：强化角色声音',
                content: '请重写选中文段，让语言更贴合当前视角人物的性格、身份、年龄、经历和情绪状态。保留原信息，但调整用词、观察重点和反应方式，使角色声音更鲜明。',
                tags: ['改写', '角色', '声音']
            },
            {
                id: 'default-rewrite-literary',
                title: '改写：文学化',
                content: '请将选中文段重写得更文学化：语言更凝练，意象更准确，节奏更有余韵。避免华丽堆砌和空泛比喻，保持叙事清晰。',
                tags: ['改写', '文学', '意象']
            },
            {
                id: 'default-rewrite-webnovel',
                title: '改写：网文爽感',
                content: '请将选中文段重写得更适合中文网文连载：节奏明确，情绪更外放，冲突更清楚，句子更有推进力。保留原剧情，不要过度中二或夸张。',
                tags: ['改写', '网文', '爽感']
            },
            {
                id: 'default-rewrite-clarity',
                title: '改写：理清逻辑',
                content: '请重写选中文段，重点理清句子逻辑、人物指代、动作先后和因果关系。不要改变剧情，只让读者更容易理解正在发生什么。',
                tags: ['改写', '逻辑', '清晰']
            },
            {
                id: 'default-rewrite-continuity',
                title: '改写：贴合上下文',
                content: '请重写选中文段，让它更自然地衔接上下文。注意代词、时间、动作连续性、情绪延续和叙述视角一致性。不要引入新的设定或剧情。',
                tags: ['改写', '上下文', '衔接']
            },
            {
                id: 'default-rewrite-remove-cliche',
                title: '改写：去套路化',
                content: '请重写选中文段，去掉陈词滥调、套路化形容和常见套话，换成更具体、更贴合当前场景和人物的表达。保持自然，不要刻意炫技。',
                tags: ['改写', '去套路', '新鲜']
            },
            {
                id: 'default-rewrite-grammar-copyedit',
                title: '改写：校对修正',
                content: '请只对选中文段做校对级修改：修正错别字、病句、标点、重复和明显不顺的表达。尽量保留原句结构、风格和长度，不要主动扩写或改剧情。',
                tags: ['改写', '校对', '修正']
            },
            {
                id: 'default-rewrite-same-meaning-alt',
                title: '改写：换一种写法',
                content: '请在不改变原意、不增删剧情信息的前提下，把选中文段换一种更自然、更有可读性的写法。长度接近原文。',
                tags: ['改写', '同义', '替换']
            },
            {
                id: 'default-rewrite-pov-consistency',
                title: '改写：视角一致',
                content: '请重写选中文段，修正叙述视角跳跃、信息越界和人物感知不一致的问题。只保留当前视角人物能看见、听见、知道或合理推断的内容。',
                tags: ['改写', 'POV', '视角']
            },
            {
                id: 'default-rewrite-tone-warmer',
                title: '改写：语气更温柔',
                content: '请重写选中文段，让语气更柔和、温暖、有人情味。保留原事件和人物关系，不要把冲突完全抹平，只调整表达的温度和细节选择。',
                tags: ['改写', '语气', '温柔']
            },
            {
                id: 'default-rewrite-tone-colder',
                title: '改写：语气更冷峻',
                content: '请重写选中文段，让语言更冷静、克制、锋利。减少抒情和解释，突出动作、事实、空白和压力。不要改变原剧情。',
                tags: ['改写', '语气', '冷峻']
            },
            {
                id: 'default-rewrite-foreshadowing',
                title: '改写：加入伏笔',
                content: '请在不改变当前剧情结果的前提下重写选中文段，加入一两个自然的伏笔或异常细节。伏笔要能回头解释，但初读时不能显得突兀或刻意。',
                tags: ['改写', '伏笔', '线索']
            }
        ]),
        summary: Object.freeze([
            {
                id: 'default-summary-scene',
                title: '摘要：场景梗概',
                systemContent: 'You summarize fiction scenes for continuity tracking. Be compact, concrete, and neutral.',
                content: '请为当前场景生成可用于后续写作检索的摘要。包括：发生了什么、角色目标与关系变化、关键线索、未解决问题。不要评价文风，不要写成宣传语。',
                tags: ['摘要', '场景', '梗概']
            },
            {
                id: 'default-summary-chapter',
                title: '摘要：章节梗概',
                systemContent: 'You summarize chapters for long-form fiction planning and continuity.',
                content: '请汇总本章节的主要情节推进、人物变化、冲突结果、伏笔与下一章承接点。保持结构清晰，适合放入章节摘要字段。',
                tags: ['摘要', '章节', '梗概']
            },
            {
                id: 'default-summary-compendium',
                title: '摘要：资料提炼',
                systemContent: 'You extract stable story facts for a fiction project bible.',
                content: '请从文本中提炼可沉淀到资料库的信息，包括人物、地点、组织、物品、规则、时间线和关系变化。只记录稳定事实，不把临时猜测写成设定。',
                tags: ['摘要', '资料库', '设定']
            },
            {
                id: 'default-summary-timeline',
                title: '摘要：时间线整理',
                systemContent: 'You extract chronological events from fiction text for continuity management.',
                content: '请按时间顺序整理文本中发生的事件。标出明确时间、相对先后、参与人物、地点、结果和仍不确定的信息。不要补写文本没有给出的事实。',
                tags: ['摘要', '时间线', '连续性']
            },
            {
                id: 'default-summary-character-arc',
                title: '摘要：角色变化',
                systemContent: 'You summarize character arcs and relationship shifts for fiction continuity.',
                content: '请提炼角色在这段内容中的状态变化：目标、情绪、态度、关系、秘密、损失、获得和下一步可能行动。按人物分条输出，适合更新人物卡。',
                tags: ['摘要', '角色', '关系']
            },
            {
                id: 'default-summary-plot-thread',
                title: '摘要：剧情线索',
                systemContent: 'You track open plot threads, clues, promises, and unresolved questions in fiction.',
                content: '请提炼当前文本中的剧情线索和未完成承诺。列出已经出现的伏笔、问题、危险、约定、误会和读者期待，并说明它们当前是否已解决。',
                tags: ['摘要', '伏笔', '线索']
            },
            {
                id: 'default-summary-continuity-risk',
                title: '摘要：连续性风险',
                systemContent: 'You identify continuity risks in fiction drafts with practical notes.',
                content: '请检查文本中可能影响后续写作的连续性风险，包括时间、地点、人物状态、物品去向、信息知情范围、设定规则和前后矛盾。只指出风险和依据。',
                tags: ['摘要', '检查', '连续性']
            },
            {
                id: 'default-summary-next-steps',
                title: '摘要：下一步写作',
                systemContent: 'You turn fiction context into concise next-step writing notes.',
                content: '请根据当前文本整理下一步写作提示：当前局势、下一场景可推进的目标、可利用的冲突、需要回收的伏笔、需要避免的重复。输出给作者作为续写备忘。',
                tags: ['摘要', '下一步', '备忘']
            }
        ]),
        workshop: Object.freeze([
            {
                id: 'default-workshop-coach',
                title: '讨论：写作顾问',
                systemContent: 'You are a creative writing assistant helping brainstorm and develop fiction. Be concrete, useful, and concise unless the author asks for depth.',
                content: '围绕作者的问题给出具体建议。优先结合项目上下文，指出可执行的下一步；需要提出多个方案时，说明各自适合的写作效果。',
                tags: ['讨论', '顾问', '通用']
            },
            {
                id: 'default-workshop-plot-doctor',
                title: '讨论：剧情诊断',
                systemContent: 'You are a fiction plot doctor. Diagnose structure, stakes, causality, and reader momentum.',
                content: '请诊断当前剧情的问题：目标是否清晰、冲突是否足够、因果是否连贯、节奏是否合适、悬念是否有效。给出具体修改建议，不要泛泛鼓励。',
                tags: ['讨论', '剧情', '诊断']
            },
            {
                id: 'default-workshop-character',
                title: '讨论：角色问答',
                systemContent: 'You help develop fictional characters through motivation, contradiction, voice, and behavior.',
                content: '请从角色动机、恐惧、欲望、矛盾、说话方式和行动习惯出发回答。建议要能直接转化为场景、对白或人物卡资料。',
                tags: ['讨论', '角色', '人物卡']
            },
            {
                id: 'default-workshop-worldbuilding',
                title: '讨论：世界观打磨',
                systemContent: 'You help develop coherent fictional worlds through rules, costs, institutions, and everyday consequences.',
                content: '请帮助打磨世界观。重点检查规则是否清楚、代价是否存在、普通人如何生活、制度如何影响角色选择、设定与剧情冲突如何互相推动。',
                tags: ['讨论', '世界观', '设定']
            },
            {
                id: 'default-workshop-scene-plan',
                title: '讨论：场景规划',
                systemContent: 'You help plan fiction scenes before drafting. Focus on purpose, conflict, beats, and exit state.',
                content: '请把这个场景规划清楚：场景目的、出场人物、开场状态、主要冲突、信息释放、情绪转折、结尾状态和下一场承接。输出可执行的写作步骤。',
                tags: ['讨论', '场景', '规划']
            },
            {
                id: 'default-workshop-dialogue',
                title: '讨论：对白打磨',
                systemContent: 'You analyze and improve fictional dialogue through voice, subtext, and scene goals.',
                content: '请分析这段对白或对白设想：每个人想要什么、明说了什么、隐藏了什么、哪里像说明书、哪里缺少角色声音。给出可替换台词方向。',
                tags: ['讨论', '对白', '潜台词']
            },
            {
                id: 'default-workshop-pacing',
                title: '讨论：节奏检查',
                systemContent: 'You diagnose pacing in fiction drafts and suggest concrete cuts, expansions, and rearrangements.',
                content: '请检查当前情节节奏。指出哪里拖、哪里跳、哪里缺少铺垫或余韵；给出压缩、扩写、换序或拆分场景的建议。',
                tags: ['讨论', '节奏', '结构']
            },
            {
                id: 'default-workshop-romance',
                title: '讨论：关系张力',
                systemContent: 'You help design believable relationship tension through desire, obstacle, vulnerability, and choice.',
                content: '请分析人物关系张力：双方想靠近还是逃开，阻碍是什么，误解或秘密在哪里，哪个动作能让关系发生小变化。建议要能写成具体场景。',
                tags: ['讨论', '关系', '情感']
            },
            {
                id: 'default-workshop-mystery',
                title: '讨论：悬疑线索',
                systemContent: 'You help design fair-play mystery clues, red herrings, reveals, and reader questions.',
                content: '请帮助设计或检查悬疑线索。列出读者应该注意到什么、会误解什么、真正答案如何被公平铺垫、哪些线索太明显或太隐蔽。',
                tags: ['讨论', '悬疑', '线索']
            },
            {
                id: 'default-workshop-revision',
                title: '讨论：修订计划',
                systemContent: 'You create practical revision plans for fiction drafts. Prioritize high-impact changes.',
                content: '请根据当前问题制定修订计划。按优先级列出需要改的结构、人物、节奏、设定、语言和连续性问题；每项说明为什么改、怎么改、改完如何检查。',
                tags: ['讨论', '修订', '计划']
            }
        ]),
        workflow: Object.freeze([
            {
                id: 'default-workflow-brief',
                title: '工作流：项目设定整理',
                systemContent: 'You are a semi-automatic fiction workflow assistant. Produce reviewable planning artifacts.',
                content: '请把当前项目整理成可人工确认的项目设定：题材、核心卖点、主角目标、主要冲突、世界规则、重要角色、已知限制和待确认问题。',
                tags: ['工作流', '项目', '设定']
            },
            {
                id: 'default-workflow-outline',
                title: '工作流：章节大纲',
                systemContent: 'You are a fiction outlining assistant. Keep the result structured and editable.',
                content: '请生成可人工确认的章节大纲。每章包含目标、冲突、转折、情绪推进、伏笔和结尾钩子。只写大纲，不写正文。',
                tags: ['工作流', '大纲', '章节']
            },
            {
                id: 'default-workflow-scene-draft',
                title: '工作流：场景草稿',
                systemContent: 'You are a fiction drafting assistant. Output reviewable prose that can be accepted or revised.',
                content: '请根据已确认的大纲生成一个场景草稿。只写一个场景，保持明确冲突、行动推进和结尾承接。输出可直接写入项目的正文草稿。',
                tags: ['工作流', '草稿', '场景']
            },
            {
                id: 'default-workflow-conflict-map',
                title: '工作流：冲突设计',
                systemContent: 'You design fiction conflict systems that can sustain multiple scenes.',
                content: '请整理当前故事的冲突系统：主冲突、人物内在冲突、关系冲突、外部阻力、资源限制、误会与秘密。说明每条冲突如何推动下一组场景。',
                tags: ['工作流', '冲突', '结构']
            },
            {
                id: 'default-workflow-character-bible',
                title: '工作流：人物小传',
                systemContent: 'You create compact character bibles for long-form fiction continuity.',
                content: '请为主要人物整理小传：公开身份、真实欲望、恐惧、秘密、能力边界、说话方式、与他人的关系、当前状态和后续可用矛盾。',
                tags: ['工作流', '人物', '资料']
            },
            {
                id: 'default-workflow-world-bible',
                title: '工作流：世界观档案',
                systemContent: 'You turn scattered fictional worldbuilding into coherent project bible notes.',
                content: '请整理世界观档案：核心规则、地点、组织、资源、技术/魔法限制、社会习俗、历史矛盾和对剧情有影响的设定。标出仍需确认的问题。',
                tags: ['工作流', '世界观', '资料']
            },
            {
                id: 'default-workflow-revision-pass',
                title: '工作流：修订清单',
                systemContent: 'You produce actionable revision passes for fiction manuscripts.',
                content: '请生成一份修订清单，按结构、人物、情节、节奏、设定连续性、语言风格、错漏校对分类。每项给出修改目标和验收标准。',
                tags: ['工作流', '修订', '清单']
            },
            {
                id: 'default-workflow-continuity-audit',
                title: '工作流：连续性审计',
                systemContent: 'You audit long-form fiction continuity and produce precise, reviewable notes.',
                content: '请做连续性审计：检查时间线、地点、人物知情范围、物品状态、伤势/能力限制、称呼关系、设定规则和已埋伏笔。列出问题、依据和建议处理方式。',
                tags: ['工作流', '连续性', '审计']
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
            title: cleanString(input.title, '新提示词') || '新提示词',
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

    return {
        PROMPT_CATEGORIES,
        createPromptTemplate,
        normalizePromptTemplates,
        defaultPromptTemplates,
        defaultProsePrompt,
        isDefaultPromptId
    };
});
