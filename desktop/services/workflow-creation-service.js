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
  if (stage === 'direction') {
    return {
      outputFormat: 'json',
      prompts: [{
        id: 'creation-directions',
        title: '创意方向',
        prompt: jsonPrompt('你是长篇小说策划。基于创作 Brief 设计 2 到 4 个显著不同、能支撑长篇的创意方向。返回 {directions:[{id,title,premise,plotFocus,emotionalArc,risks:[]}]}。', { brief, constraints })
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
        prompt: jsonPrompt('设计可编辑的长篇故事蓝图。返回 {title,logline,themes,centralConflict:{protagonistGoal,opposingForce,stakes,dilemma},acts:[{id,title,purpose,turningPoint,emotionalDirection}],characterArcs:[{character,start,change,end}],worldRules:[],endingDirection}。', { brief, selectedDirection, constraints })
      }]
    };
  }
  const blueprint = CreationSchema.createStoryBlueprint(context.blueprint || {});
  if (stage === 'compendium') {
    return {
      outputFormat: 'json',
      prompts: [{
        id: 'creation-compendium',
        title: '人物与世界观资料草稿',
        prompt: jsonPrompt('基于故事蓝图生成人物与世界观资料草稿。必须复用资料库类型 character、location、organization、item、lore、timeline、note。返回 {cards:[{id,type,title,summary,body,tags,aliases,characterProfile:{role,goal,motivation,conflict,voice,currentState,knowledge,relationshipNotes}}]}；非人物卡省略 characterProfile。', { brief, selectedDirection, blueprint, constraints })
      }]
    };
  }
  const compendium = CreationSchema.createCompendiumDraftBundle(context.compendium || {}, { projectId: context.projectId });
  if (stage === 'plan') {
    const fineOutlineEnabled = context.fineOutlineEnabled !== false;
    return {
      outputFormat: 'json',
      prompts: [{
        id: 'creation-scene-plan',
        title: '节奏与场景计划',
        prompt: jsonPrompt(`设计首批可生成的场景计划。fineOutline 必须是字符串数组，每项是一条可直接执行的情节动作，不得返回对象。返回 {fineOutlineEnabled:${fineOutlineEnabled},scenes:[{id,title,povCharacter,location,goal,conflict,outcome,participants,turningPoint,reveal,hook,emotionalStart,emotionalEnd,emotionalBeat,pace:"slow|medium|fast",conflictIntensity:0,informationDensity:0,targetWords:0,mustInclude:[],avoid:[],continuity,fineOutline:["情节动作"]}]}。`, { brief, selectedDirection, blueprint, compendium, constraints })
      }]
    };
  }
  const scenePlan = PlanningSchema.createScenePlan(context.scenePlan || {});
  if (stage === 'draft') {
    return {
      outputFormat: 'text',
      prompts: scenePlan.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        prompt: textPrompt('你是长篇小说作者。只输出当前场景正文，不解释，不输出标题。严格遵守已确认的故事蓝图、人物与世界观资料、场景节奏和约束。', { brief, selectedDirection, blueprint, compendium, scenePlan, currentScene: scene, constraints })
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
