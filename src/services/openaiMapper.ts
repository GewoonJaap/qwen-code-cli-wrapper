import type { ChatCompletionsBody, UpstreamChatCreate, OpenAIContentItem } from '../types/openai';

function normalizeContent(content: string | OpenAIContentItem[]): string {
	if (typeof content === 'string') {
		return content;
	}

	// For array content, extract text from all text items
	return content
		.filter((item): item is Extract<OpenAIContentItem, { type: 'text' }> => item.type === 'text')
		.map((item) => item.text)
		.join('\n');
}

export function toUpstreamPayload(body: ChatCompletionsBody, model: string): UpstreamChatCreate {
	return {
		model,
		messages: body.messages.map((m) => ({ role: m.role, content: normalizeContent(m.content) })),
		stream: !!body.stream,
		temperature: body.temperature,
		top_p: body.top_p,
		max_tokens: body.max_tokens,
		presence_penalty: body.presence_penalty,
		frequency_penalty: body.frequency_penalty,
		seed: body.seed,
	};
}
