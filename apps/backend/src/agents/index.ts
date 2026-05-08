import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

import "dotenv/config";

type LlmProvider = "deepseek" | "google";

const deepseekApiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const deepseekTemperature = Number(process.env.DEEPSEEK_TEMPERATURE ?? "0.7");
const deepseekMaxTokens = Number(process.env.DEEPSEEK_MAX_TOKENS ?? "1024");
const deepseekTimeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS ?? "1200");

const googleApiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY || "";
const googleModel = process.env.GOOGLE_GENAI_MODEL || "gemini-3.1-pro";
const googleTemperature = Number(process.env.GOOGLE_GENAI_TEMPERATURE ?? "0.7");
const googleMaxOutputTokens = Number(process.env.GOOGLE_GENAI_MAX_OUTPUT_TOKENS ?? "1024");

if (!deepseekApiKey) {
	console.warn("DEEPSEEK_API_KEY is not set; DeepSeek requests will fail.");
}

if (!googleApiKey) {
	console.warn("GOOGLE_API_KEY is not set; Google requests will fail.");
}

const cache: Partial<Record<LlmProvider, ChatOpenAI | ChatGoogleGenerativeAI>> = {};

const normalizeProvider = (value?: string): LlmProvider => {
	const raw = (value || process.env.LLM_PROVIDER || "google").toLowerCase();
	if (raw === "deepseek") {
		return "deepseek";
	}
	return "google";
};

export const getLlm = (provider?: string): ChatOpenAI | ChatGoogleGenerativeAI => {
	const resolved = normalizeProvider(provider);
	if (resolved === "google") {
		if (!cache.google) {
			cache.google = new ChatGoogleGenerativeAI({
				apiKey: googleApiKey,
				model: googleModel,
				temperature: Number.isFinite(googleTemperature) ? googleTemperature : 0.7,
				maxOutputTokens: Number.isFinite(googleMaxOutputTokens) ? googleMaxOutputTokens : 1024,
			});
		}
		return cache.google;
	}

	if (!cache.deepseek) {
		cache.deepseek = new ChatOpenAI({
			apiKey: deepseekApiKey,
			model: deepseekModel,
			temperature: Number.isFinite(deepseekTemperature) ? deepseekTemperature : 0.7,
			maxTokens: Number.isFinite(deepseekMaxTokens) ? deepseekMaxTokens : 1024,
			timeout: Number.isFinite(deepseekTimeoutMs) ? deepseekTimeoutMs : 1200,
			configuration: {
				baseURL: deepseekBaseUrl,
			},
		});
	}

	return cache.deepseek;
};

export const llm = getLlm();
export default llm;
