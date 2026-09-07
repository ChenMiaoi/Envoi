// Verified official sources, 2026-09-06. Unknown/custom endpoints are never guessed.
export const providerHelp: Record<string, { url: string; source: string }> = {
  openai: {
    url: "https://platform.openai.com/api-keys",
    source: "https://developers.openai.com/api/docs/quickstart",
  },
  anthropic: {
    url: "https://console.anthropic.com/",
    source: "https://platform.claude.com/docs/en/api/overview",
  },
  google: {
    url: "https://aistudio.google.com/apikey",
    source: "https://ai.google.dev/gemini-api/docs/api-key",
  },
  deepseek: {
    url: "https://platform.deepseek.com/api_keys",
    source: "https://api-docs.deepseek.com/",
  },
  cerebras: {
    url: "https://cloud.cerebras.ai",
    source: "https://inference-docs.cerebras.ai/console/api-keys",
  },
  groq: {
    url: "https://console.groq.com/keys",
    source: "https://console.groq.com/docs/quickstart",
  },
  mistral: { url: "https://console.mistral.ai", source: "https://docs.mistral.ai/" },
  xai: { url: "https://console.x.ai", source: "https://docs.x.ai/developers/quickstart" },
  huggingface: {
    url: "https://huggingface.co/settings/tokens",
    source: "https://huggingface.co/docs/hub/security-tokens",
  },
  fireworks: {
    url: "https://app.fireworks.ai/settings/users/api-keys",
    source: "https://docs.fireworks.ai/getting-started/quickstart",
  },
  zai: {
    url: "https://z.ai/manage-apikey/apikey-list",
    source: "https://docs.z.ai/api-reference/introduction",
  },
  minimax: {
    url: "https://platform.minimax.io/user-center/basic-information/interface-key",
    source: "https://platform.minimax.io/docs/guides/quickstart-preparation",
  },
  "minimax-cn": {
    url: "https://platform.minimaxi.com/",
    source: "https://platform.minimax.io/docs/token-plan/cursor",
  },
  "kimi-coding": {
    url: "https://www.kimi.com/code/console",
    source: "https://www.kimi.com/code/docs/",
  },
  moonshotai: { url: "https://platform.kimi.ai/", source: "https://platform.moonshot.ai/" },
  "moonshotai-cn": { url: "https://platform.kimi.com/", source: "https://platform.moonshot.cn/" },
  opencode: { url: "https://opencode.ai/auth", source: "https://opencode.ai/docs/zen/" },
  "opencode-go": { url: "https://opencode.ai/auth", source: "https://opencode.ai/docs/zen/" },
  "google-vertex": {
    url: "https://cloud.google.com/vertex-ai/generative-ai/docs/start/gcp-auth",
    source: "https://cloud.google.com/vertex-ai/generative-ai/docs/start/gcp-auth",
  },
  "amazon-bedrock": {
    url: "https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started-api.html",
    source: "https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started-api.html",
  },
  "azure-openai-responses": {
    url: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/quickstart",
    source: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/quickstart",
  },
  "cloudflare-workers-ai": {
    url: "https://developers.cloudflare.com/workers-ai/get-started/rest-api/",
    source: "https://developers.cloudflare.com/workers-ai/get-started/rest-api/",
  },
  "cloudflare-ai-gateway": {
    url: "https://developers.cloudflare.com/workers-ai/get-started/rest-api/",
    source: "https://developers.cloudflare.com/workers-ai/get-started/rest-api/",
  },
  "vercel-ai-gateway": {
    url: "https://vercel.com/docs/ai-gateway/authentication-and-byok",
    source: "https://vercel.com/docs/ai-gateway/authentication-and-byok",
  },
  openrouter: { url: "https://openrouter.ai/", source: "https://openrouter.ai/docs/quickstart" },
  xiaomi: { url: "https://platform.xiaomimimo.com/", source: "https://platform.xiaomimimo.com/" },
  "xiaomi-token-plan-cn": {
    url: "https://platform.xiaomimimo.com/",
    source: "https://platform.xiaomimimo.com/",
  },
  "xiaomi-token-plan-ams": {
    url: "https://platform.xiaomimimo.com/",
    source: "https://platform.xiaomimimo.com/",
  },
  "xiaomi-token-plan-sgp": {
    url: "https://platform.xiaomimimo.com/",
    source: "https://platform.xiaomimimo.com/",
  },
}
