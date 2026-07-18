const SettingsSchema = require('../../src/core/settings/settings-schema');
const ArtifactSchema = require('../../src/core/workflow/workflow-artifact-schema');
const GenerationPolicy = require('../../src/core/workflow/workflow-generation-policy');

function sourcePolicy(input = {}) {
  return input && typeof input === 'object'
    ? (input.generationPolicy || input.providerPolicy || input.provider || input)
    : {};
}

function resolveWorkflowProvider(settingsInput = {}, workflowInput = {}, nodeInput = {}) {
  const settings = SettingsSchema.normalizeDesktopSettings(settingsInput);
  const workflowPolicy = GenerationPolicy.normalizeWorkflowGenerationPolicy(sourcePolicy(workflowInput));
  const nodePolicy = GenerationPolicy.normalizeWorkflowGenerationPolicy(sourcePolicy(nodeInput));
  const policy = GenerationPolicy.mergeWorkflowGenerationPolicy(workflowPolicy, nodePolicy);
  const profileId = policy.providerProfileId === 'inherit' ? '' : policy.providerProfileId;
  let profile = null;
  if (profileId) {
    profile = (settings.providerProfiles || []).find((item) => item.id === profileId) || null;
    if (!profile) throw new Error(`workflow provider profile was not found: ${profileId}`);
  }
  const config = SettingsSchema.providerRuntimeConfig(settings, {
    ...(profile ? { profileId: profile.id } : {}),
    ...(policy.model ? { model: policy.model } : {}),
    ...(policy.temperature !== null ? { temperature: policy.temperature } : {}),
    ...(policy.maxTokens !== null ? { maxTokens: policy.maxTokens } : {}),
    ...(policy.useProviderDefaults !== null ? { useProviderDefaults: policy.useProviderDefaults } : {})
  });
  const source = nodePolicy.providerProfileId !== 'inherit' || nodePolicy.model || nodePolicy.temperature !== null || nodePolicy.maxTokens !== null || nodePolicy.useProviderDefaults !== null
    ? 'node'
    : (workflowPolicy.providerProfileId !== 'inherit' || workflowPolicy.model || workflowPolicy.temperature !== null || workflowPolicy.maxTokens !== null || workflowPolicy.useProviderDefaults !== null
      ? 'workflow'
      : 'writer');
  return {
    source,
    policy,
    config,
    snapshot: ArtifactSchema.normalizeProviderSnapshot({
      providerProfileId: profile ? profile.id : '',
      provider: config.provider,
      model: config.model,
      parameters: {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        useProviderDefaults: config.useProviderDefaults
      }
    })
  };
}

module.exports = { resolveWorkflowProvider };
