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

type ActualBudgetFile = {
	cloudFileId?: string;
	groupId?: string;
	id?: string;
};

type ActualApi = {
	downloadBudget(syncId: string, budgetConfig: {password?: string; syncId: string}): Promise<void>;
	getBudgets(): Promise<ActualBudgetFile[]>;
	getAccounts(): Promise<ActualAccount[]>;
	getCategories(): Promise<ActualCategory[]>;
	getPayees(): Promise<ActualPayee[]>;
	getRules(): Promise<ActualRule[]>;
	getServerVersion(): Promise<Record<string, unknown> | ServerVersionResponse>;
	init(config: ConfigActual['init']): Promise<void>;
	loadBudget(budgetId: string): Promise<void>;
	shutdown(): Promise<void>;
};

type ActualClientDependencies = {
	api: ActualApi;
	stdout: {
		mute: () => void;
		unmute: () => void;
	};
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

const defaultDependencies: ActualClientDependencies = {
	api: actualApi,
	stdout: mutedStdout,
};

export class ActualClient {
	constructor(
		private readonly config: ConfigActual,
		private readonly dependencies: ActualClientDependencies = defaultDependencies,
	) {}

	async connect() {
		this.dependencies.stdout.mute();
		await this.dependencies.api.init(this.config.init);
		const serverVersion = await this.assertVersionCompatibility();

		try {
			await this.dependencies.api.downloadBudget(this.config.budget.syncId, this.config.budget);
			const budgets = await this.dependencies.api.getBudgets();
			const budgetId = resolveBudgetId(budgets, this.config.budget.syncId);
			await this.dependencies.api.loadBudget(budgetId);
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
			this.dependencies.stdout.unmute();
		}
	}

	async disconnect() {
		this.dependencies.stdout.mute();
		try {
			await this.dependencies.api.shutdown();
		} finally {
			this.dependencies.stdout.unmute();
		}
	}

	async loadSnapshot() {
		const [rules, accounts, categories, payees] = await Promise.all([
			this.dependencies.api.getRules(),
			this.dependencies.api.getAccounts(),
			this.dependencies.api.getCategories(),
			this.dependencies.api.getPayees(),
		]);

		return {
			accounts,
			categories,
			payees,
			rules,
		};
	}

	private async assertVersionCompatibility() {
		const serverVersion = await this.dependencies.api.getServerVersion();
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

export function resolveBudgetId(budgets: ActualBudgetFile[], syncId: string) {
	const matchingBudget = budgets.find(budget =>
		budget.groupId === syncId
		|| budget.cloudFileId === syncId
		|| budget.id === syncId);

	if (matchingBudget?.id) {
		return matchingBudget.id;
	}

	if (budgets.length === 1 && budgets[0]?.id) {
		return budgets[0].id;
	}

	throw new Error(`Unable to resolve Actual budget for sync ID ${syncId}.`);
}
