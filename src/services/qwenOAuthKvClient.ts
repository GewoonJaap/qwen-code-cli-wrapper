import type { QwenCredentials } from '../types/qwen';
import { KV_CREDENTIALS_KEY, isTokenValid } from '../types/common';
import { QWEN_CONFIG } from '../config/constants';

function toForm(data: Record<string, string>) {
	return Object.entries(data)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
}

export class QwenOAuthKvClient {
	private kv: KVNamespace;
	private cached: QwenCredentials | null = null;

	constructor(kv: KVNamespace) {
		this.kv = kv;
	}

	async loadInitialCredentials(json?: string) {
		console.log('loadInitialCredentials called with json:', json ? 'present' : 'missing');
		if (!json) return;
		try {
			const parsed = JSON.parse(json) as QwenCredentials;
			console.log('Parsed credentials:', {
				hasAccessToken: !!parsed.access_token,
				hasRefreshToken: !!parsed.refresh_token,
				hasExpiry: !!parsed.expiry_date,
			});

			// Require at least a refresh_token to be useful
			if (!parsed.refresh_token) {
				console.warn('QWEN_CLI_AUTH missing refresh_token; skipping bootstrap');
				return;
			}
			await this.setCredentials(parsed);
			this.cached = parsed;
			console.log('Bootstrapped Qwen credentials from QWEN_CLI_AUTH');
		} catch (e) {
			console.error('Failed parsing QWEN_CLI_AUTH JSON:', e);
		}
	}

	async getCredentials(): Promise<QwenCredentials | null> {
		if (this.cached) return this.cached;
		const str = await this.kv.get(KV_CREDENTIALS_KEY);
		if (!str) return null;
		try {
			const creds = JSON.parse(str) as QwenCredentials;
			this.cached = creds;
			return creds;
		} catch {
			return null;
		}
	}

	async setCredentials(creds: QwenCredentials) {
		this.cached = creds;
		await this.kv.put(KV_CREDENTIALS_KEY, JSON.stringify(creds));
	}

	async clearCredentials() {
		this.cached = null;
		await this.kv.delete(KV_CREDENTIALS_KEY);
	}

	async getValidAccessToken(): Promise<{ token?: string; creds?: QwenCredentials }> {
		console.log('getValidAccessToken called');
		const creds = await this.getCredentials();
		console.log('Retrieved credentials from KV:', !!creds);

		if (!creds) {
			console.log('No credentials found in KV');
			return {};
		}

		const tokenValid = creds.access_token && isTokenValid(creds.expiry_date);
		console.log('Token validity check:', {
			hasAccessToken: !!creds.access_token,
			expiryDate: creds.expiry_date,
			tokenValid,
		});

		if (tokenValid) {
			console.log('Using existing valid token');
			return { token: creds.access_token, creds };
		}

		console.log('Token expired or missing, attempting refresh');
		const refreshed = await this.refreshAccessToken(creds);
		return { token: refreshed.access_token, creds: refreshed };
	}

	async refreshAccessToken(creds: QwenCredentials): Promise<QwenCredentials> {
		if (!creds.refresh_token) {
			await this.clearCredentials();
			throw new Error('No refresh_token; cannot refresh');
		}
		const body = toForm({
			grant_type: 'refresh_token',
			refresh_token: creds.refresh_token,
			client_id: QWEN_CONFIG.clientId,
		});
		const resp = await fetch(QWEN_CONFIG.tokenEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body,
		});
		if (!resp.ok) {
			const text = await resp.text();
			if (resp.status === 400) {
				await this.clearCredentials();
			}
			throw new Error(`Qwen token refresh failed: ${resp.status} ${resp.statusText} ${text}`);
		}
		const data = (await resp.json()) as {
			access_token: string;
			token_type: string;
			expires_in: number;
			refresh_token?: string;
			resource_url?: string;
		};
		const updated: QwenCredentials = {
			access_token: data.access_token,
			token_type: data.token_type,
			refresh_token: data.refresh_token || creds.refresh_token,
			resource_url: data.resource_url ?? creds.resource_url,
			expiry_date: Date.now() + (data.expires_in ?? 0) * 1000,
		};
		await this.setCredentials(updated);
		return updated;
	}
}
