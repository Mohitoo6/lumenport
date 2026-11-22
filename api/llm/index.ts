import { llmHandler } from '../../server/llmProxy.js';

/**
 * POST /api/llm on a serverless host (Vercel's Node runtime). Keys come from the host's
 * environment variables (the same names as in .env); the guard is always on here.
 */
const handler = llmHandler(process.env, { public: true });
export default handler;
