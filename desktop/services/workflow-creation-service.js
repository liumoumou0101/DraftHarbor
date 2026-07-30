const CreationSchema = require('../../src/core/workflow/workflow-creation-schema');
const PlanningSchema = require('../../src/core/workflow/workflow-planning-schema');

function clean(value) { return String(value === undefined || value === null ? '' : value).trim(); }

function jsonPrompt(system, payload) {
  return {
    messages: [
      { role: 'system', content: `${system}\n只返回合法 JSON，不要使用 Markdown 代码块。` },
      { role: 'user', content: JSON.stringify(payload) }
    ]
  };
}

function textPrompt(system, payload) {
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }] };
}

function parseJson(value) {
  const text = clean(value).replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('creation output must be a JSON object');
  return parsed;
}

function prepareCreationStage(stage, context = {}) {
  const brief = CreationSchema.createCreationBrief(context.brief || {});
  const constraints = Array.isArray(context.constraints) ? context.constraints : [];
  const writingInstructions = context.writingInstructions && typeof context.writingInstructions === 'object'
    ? context.writingInstructions : {};
  const sourceGlobalContext = context.globalContext && typeof context.globalContext === 'object'
    ? context.globalContext : {};
  const globalContext = {
    globalPrompt: clean(sourceGlobalContext.globalPrompt || context.globalPrompt),
    writingInstructions
  };
  const instructionPriority = '指令优先级固定为：事实与硬约束 > 已批准蓝图和场景计划 > 当前批次用户意见 > 全局写作指令 > 模型默认倾向。若发生冲突，遵守高优先级内容，并在结构化结果的 notes 或 avoid 中明确记录冲突，不得静默覆盖。';
  if (stage === 'direction') {
    return {
      outputFormat: 'json',
      prompts: [{
        id: 'creation-directions',
        title: '创意方向',
        prompt: jsonPrompt('你是长篇小说策划。基于创作 Brief 设计 2 到 4 个显著不同、能支撑长篇的创意方向。返回 {directions:[{id,title,premise,plotFocus,emotionalArc,risks:[]}]}。', { brief, constraints, globalContext })
      }]
    };
  }
  const directions = PlanningSchema.createDirectionSet(context.directions || {});
  const selectedDirection = PlanningSchema.mergeDirections(directions, context.selectedDirectionIds || []);
  if (stage === 'blueprint') {
    return {
      outputFormat: 'json',
      prompts: [{
        id: 'story-blueprint',
        title: '故事蓝图与冲突结构',
        prompt: jsonPrompt('设计可编辑的长篇故事蓝图。返回 {title,logline,themes,centralConflict:{protagonistGoal,opposingForce,stakes,dilemma},acts:[{id,title,purpose,turningPoint,emotionalDirection}],characterArcs:[{character,start,change,end}],worldRules:[],endingDirection}。', { brief, selectedDirection, constraints, globalContext })
      }]
    };
  }
  const blueprint = CreationSchema.createStoryBlueprint(context.blueprint || {});
  if (stage === 'compendium') {
    return {
      outputFormat: 'json',
      prompts: [
        {
          id: 'creation-compendium-characters',
          title: '人物资料草稿',
          prompt: jsonPrompt('基于故事蓝图只生成角色资料。返回 {cards:[{id,type:"character",title,summary,body,tags,aliases,characterProfile:{role,goal,motivation,conflict,voice,currentState,knowledge,relationshipNotes}}]}。覆盖主角、主要对手和推动故事所需的关键配角，不要生成地点或世界设定。', { brief, selectedDirection, blueprint, constraints, globalContext })
        },
        {
          id: 'creation-compendium-world',
          title: '世界观资料草稿',
          prompt: jsonPrompt('基于故事蓝图只生成世界观资料。必须复用资料库类型 location、organization、item、lore、timeline、note。返回 {cards:[{id,type,title,summary,body,tags,aliases}]}。覆盖故事成立所需的关键地点、组织、物件、规则或历史，不要重复生成人物。', { brief, selectedDirection, blueprint, constraints, globalContext })
        }
      ]
    };
  }
  const compendium = CreationSchema.createCompendiumDraftBundle(context.compendium || {}, { projectId: context.projectId });
  if (stage === 'plan') {
    const fineOutlineEnabled = context.fineOutlineEnabled !== false;
    const batchContext = context.batchContext && typeof context.batchContext === 'object' ? context.batchContext : {};
    const batchSequence = Math.max(1, Number(batchContext.sequence) || 1);
    const planningInstruction = batchSequence > 1
      ? `设计第 ${batchSequence} 批可生成的场景计划。承接前批真实结尾与连续性状态，推进尚未覆盖的故事蓝图，不要重写已经完成的场景。`
      : '设计首批可生成的场景计划。';
    return {
      outputFormat: 'json',
      prompts: [{
        id: 'creation-scene-plan',
        title: '节奏与场景计划',
        prompt: jsonPrompt(`${planningInstruction} ${instructionPriority} 若 batchContext.dueThreads 或 mustCloseThreads 非空，本批计划必须推进或明确回收这些未解线索，并在相关场景的 mustInclude/outcome/hook 中体现。fineOutline 必须是字符串数组，每项是一条可直接执行的情节动作，不得返回对象。返回 {fineOutlineEnabled:${fineOutlineEnabled},scenes:[{id,title,povCharacter,location,goal,conflict,outcome,participants,turningPoint,reveal,hook,emotionalStart,emotionalEnd,emotionalBeat,pace:"slow|medium|fast",conflictIntensity:0,informationDensity:0,targetWords:0,mustInclude:[],avoid:[],continuity,fineOutline:["情节动作"]}]}。`, { brief, selectedDirection, blueprint, compendium, constraints, writingInstructions, globalContext, batchContext })
      }]
    };
  }
  const scenePlan = PlanningSchema.createScenePlan(context.scenePlan || {});
  if (stage === 'draft') {
    const batchContext = context.batchContext && typeof context.batchContext === 'object' ? context.batchContext : {};
    return {
      outputFormat: 'text',
      prompts: scenePlan.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        prompt: textPrompt(`你是长篇小说作者。只输出当前场景正文，不解释，不输出标题。严格遵守已确认的故事蓝图、人物与世界观资料、场景节奏和约束。${instructionPriority} 正文长度应尽量接近 currentScene.targetWords 指定的中文字符数；除非场景已经自然完成，不要少于该目标的 80%，也不要用重复、总结或无效描写凑长度。若 batchContext.repairReview 存在，只修复其中与 currentScene.id 对应的问题，保留未被指出有问题的事实和推进结果。若提供了当前批次已经完成的真实正文结尾，必须从其事实、人物状态、情绪和动作结果自然承接，不得重置场景。严格停在 currentScene.outcome 或 currentScene.hook 所界定的场景边界，不得提前完成下一场景的核心转折；若前一场已经意外覆盖当前场景的部分内容，应从最新事实继续推进而不是重演。scenePlan、currentScene、batchContext 中的 id、序号、批次名和“场景”等标签只供内部定位，正文绝不能提及“场景 6-1”“上一批”“计划要求”等创作过程信息。`, { brief, selectedDirection, blueprint, compendium, scenePlan, currentScene: scene, constraints, writingInstructions, globalContext, batchContext })
      }))
    };
  }
  throw new Error(`unsupported creation stage: ${stage}`);
}

function normalizeCreationOutput(stage, output, options = {}) {
  if (stage === 'draft') {
    const text = clean(output);
    if (!text) throw new Error('creation draft output must not be empty');
    return text;
  }
  const parsed = typeof output === 'string' ? parseJson(output) : output;
  if (stage === 'direction') return PlanningSchema.createDirectionSet(parsed);
  if (stage === 'blueprint') return CreationSchema.createStoryBlueprint(parsed);
  if (stage === 'compendium') return CreationSchema.createCompendiumDraftBundle(parsed, options);
  if (stage === 'plan') return PlanningSchema.createScenePlan(parsed);
  throw new Error(`unsupported creation stage: ${stage}`);
}

module.exports = { prepareCreationStage, normalizeCreationOutput, parseJson };
