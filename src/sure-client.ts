/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable no-await-in-loop */

import {
	delay,
	normalizeLookupKey,
	readString,
	stripUndefined,
} from './utils.js';
import type {ConfigSure, SureAccountReference} from './config.js';
import type {SureAccount, SureImportRecord} from './types.js';

type SurePagination = {
	page: number;
	per_page: number;
	total_count: number;
	total_pages: number;
};

type SureCollectionResponse<CollectionKey extends string, Item> = Record<CollectionKey, Item[]> & {
	pagination: SurePagination;
};

type SureImportEnvelope = {
	data: SureImportRecord;
};

const importPollIntervalMs = 1000;
type SureClientConfig = Required<ConfigSure>;

export class SureClient {
	private accountCache?: SureAccount[];

	constructor(private readonly config: SureClientConfig) {}

	async getAccounts() {
		this.accountCache ??= await this.listPaginatedCollection<SureAccount>('/api/v1/accounts', 'accounts');
		return this.accountCache;
	}

	async resolveAccountId(reference: SureAccountReference, fallbackActualName?: string) {
		const accounts = await this.getAccounts();
		if (typeof reference === 'string') {
			const byId = accounts.find(account => account.id === reference);
			if (byId) {
				return byId.id;
			}

			const byName = accounts.find(account => normalizeLookupKey(account.name) === normalizeLookupKey(reference));
			if (byName) {
				return byName.id;
			}

			throw new Error(`Sure account not found for mapping reference ${reference}`);
		}

		if ('sureAccountId' in reference) {
			const account = accounts.find(candidate => candidate.id === reference.sureAccountId);
			if (!account) {
				throw new Error(`Sure account not found for id ${reference.sureAccountId}`);
			}

			return account.id;
		}

		const account = accounts.find(candidate => normalizeLookupKey(candidate.name) === normalizeLookupKey(reference.sureAccountName));
		if (!account) {
			throw new Error(`Sure account not found for name ${reference.sureAccountName}${fallbackActualName ? ` (mapped from ${fallbackActualName})` : ''}`);
		}

		return account.id;
	}

	async createRuleImport({
		csv,
		publish,
	}: {
		csv: string;
		publish: boolean;
	}) {
		const body = JSON.stringify({
			col_sep: ',',
			publish: publish ? 'true' : 'false',
			raw_file_content: csv,
			type: 'RuleImport',
		});

		const response = await this.request<SureImportEnvelope>('/api/v1/imports', {
			body,
			method: 'POST',
		});

		return response.data;
	}

	async getImport(importId: string) {
		const response = await this.request<SureImportEnvelope>(`/api/v1/imports/${importId}`);
		return response.data;
	}

	async waitForImport(importId: string) {
		const deadline = Date.now() + this.config.publishTimeoutMs;

		while (Date.now() <= deadline) {
			const record = await this.getImport(importId);
			if (record.status === 'complete' || record.status === 'failed') {
				return record;
			}

			await delay(importPollIntervalMs);
		}

		throw new Error(`Sure import ${importId} did not reach a terminal state within ${this.config.publishTimeoutMs}ms.`);
	}

	private async listPaginatedCollection<Item>(pathname: string, collectionKey: string) {
		const items: Item[] = [];
		let page = 1;

		while (true) {
			const pageResponse = await this.request<SureCollectionResponse<string, Item>>(pathname, {
				query: {
					page: String(page),
				},
			});
			const pageItems = pageResponse[collectionKey];
			if (!Array.isArray(pageItems)) {
				throw new TypeError(`Sure API ${pathname} returned an invalid ${collectionKey} collection.`);
			}

			items.push(...pageItems);
			if (page >= pageResponse.pagination.total_pages) {
				break;
			}

			page += 1;
		}

		return items;
	}

	private async request<Response>(
		pathname: string,
		options?: {
			body?: string;
			method?: 'GET' | 'POST';
			query?: Record<string, string | undefined>;
		},
	) {
		const url = new URL(pathname, this.config.baseUrl);
		for (const [key, value] of Object.entries(options?.query ?? {})) {
			if (value !== undefined && value !== '') {
				url.searchParams.set(key, value);
			}
		}

		const response = await fetch(url, {
			body: options?.body,
			headers: stripUndefined({
				'Content-Type': options?.body ? 'application/json' : undefined,
				'X-Api-Key': this.config.apiKey,
			}),
			method: options?.method ?? 'GET',
			signal: AbortSignal.timeout(this.config.timeoutMs),
		});

		const text = await response.text();
		const body = text === '' ? undefined : JSON.parse(text) as Record<string, unknown>;
		if (!response.ok) {
			throw new Error(this.buildErrorMessage(pathname, response.status, body));
		}

		return body as Response;
	}

	private buildErrorMessage(pathname: string, status: number, body: Record<string, unknown> | undefined) {
		const candidates = [
			readString(body?.message),
			readString(body?.error),
			readStringArray(body?.errors)?.join(', '),
		].filter(Boolean);

		return `Sure API ${pathname} failed (${status}): ${candidates.join(' | ') || 'Unknown error'}`;
	}
}

function readStringArray(value: unknown) {
	return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}
