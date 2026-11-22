import { llmHandler } from '../../server/llmProxy.js';

/** GET /api/llm/status on a serverless host: whether any provider is configured. */
const handler = llmHandler(process.env, { public: true });
export default handler;
