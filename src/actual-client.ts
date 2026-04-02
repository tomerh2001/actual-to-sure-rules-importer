import {createRequire} from 'node:module';
import actual from '@actual-app/api';
import stdout from 'mute-stdout';
import type {
	ActualAccount,
	ActualCategory,
	ActualPayee,
	ActualRule,
} from './types.js';
import type {ConfigActual} from './config.js';

type ServerVersionResponse = {
	version: string;
};

type ActualApi = {
	downloadBudget(syncId: string, budgetConfig: {password?: string; syncId: string}): Promise<void>;
	getAccounts(): Promise<ActualAccount[]>;
	getCategories(): Promise<ActualCategory[]>;
	getPayees(): Promise<ActualPayee[]>;
	getRules(): Promise<ActualRule[]>;
	getServerVersion(): Promise<Record<string, unknown> | ServerVersionResponse>;
	init(config: ConfigActual['init']): Promise<void>;
	shutdown(): Promise<void>;
};

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as {
	dependencies?: Record<string, string>;
};

const actualApi = actual as unknown as ActualApi;
const mutedStdout = stdout as {
	mute: () => void;
	unmute: () => void;
};
const bundledActualApiVersion = packageJson.dependencies?.['@actual-app/api'] ?? 'unknown';

export class ActualClient {
	constructor(private readonly config: ConfigActual) {}

	async connect() {
		mutedStdout.mute();
		await actualApi.init(this.config.init);
		const serverVersion = await this.assertVersionCompatibility();

		try {
			await actualApi.downloadBudget(this.config.budget.syncId, this.config.budget);
		} catch (error) {
			if (error instanceof Error && error.message.includes('out-of-sync-migrations')) {
				const serverVersionNote = hasVersion(serverVersion)
					? ` Server reports ${serverVersion.version}; importer bundles @actual-app/api ${bundledActualApiVersion}.`
					: '';
				throw new Error([
					'Actual failed with "out-of-sync-migrations".',
					'This usually means the Actual server version and the importer bundle do not match.',
					serverVersionNote.trim(),
				].filter(Boolean).join(' '));
			}

			throw error;
		} finally {
			mutedStdout.unmute();
		}
	}

	async disconnect() {
		mutedStdout.mute();
		try {
			await actualApi.shutdown();
		} finally {
			mutedStdout.unmute();
		}
	}

	async loadSnapshot() {
		const [rules, accounts, categories, payees] = await Promise.all([
			actualApi.getRules(),
			actualApi.getAccounts(),
			actualApi.getCategories(),
			actualApi.getPayees(),
		]);

		return {
			accounts,
			categories,
			payees,
			rules,
		};
	}

	private async assertVersionCompatibility() {
		const serverVersion = await actualApi.getServerVersion();
		if (!hasVersion(serverVersion)) {
			return serverVersion;
		}

		if (serverVersion.version !== bundledActualApiVersion) {
			throw new Error([
				`Actual server version mismatch: server reports ${serverVersion.version},`,
				`but this importer bundles @actual-app/api ${bundledActualApiVersion}.`,
				`Update the importer image to a release built against Actual ${serverVersion.version},`,
				`or downgrade Actual to ${bundledActualApiVersion}.`,
			].join(' '));
		}

		return serverVersion;
	}
}

function hasVersion(value: Record<string, unknown> | ServerVersionResponse): value is ServerVersionResponse {
	return typeof value === 'object' && value !== null && typeof value.version === 'string';
}
