/* eslint-disable @typescript-eslint/naming-convention */

import path from 'node:path';
import process from 'node:process';

export type ActualInitConfig = {
	dataDir: string;
	password?: string;
	serverURL: string;
	sessionToken?: string;
} & Record<string, unknown>;

export type ActualBudgetConfig = {
	password?: string;
	syncId: string;
};

export type ConfigActual = {
	budget: ActualBudgetConfig;
	init: ActualInitConfig;
};

export type ConfigSure = {
	apiKey: string;
	baseUrl: string;
	publishTimeoutMs?: number;
	timeoutMs?: number;
};

export type ConfigImport = {
	dryRun?: boolean;
	effectiveDate?: string;
	importedPayeeConditionTarget?: 'transaction_details' | 'transaction_name';
	maxRuleVariants?: number;
	namePrefix?: string;
	outputDir?: string;
	partialRules?: boolean;
	payeeActionTarget?: 'set_transaction_merchant' | 'set_transaction_name';
	payeeConditionTarget?: 'transaction_merchant' | 'transaction_name';
	publish?: boolean;
};

export type SureAccountReference =
	| string
	| {
		sureAccountId: string;
	}
	| {
		sureAccountName: string;
	};

export type ConfigMappings = {
	accounts?: Record<string, SureAccountReference>;
	categories?: Record<string, string>;
	payees?: Record<string, string>;
};

export type Config = {
	actual: ConfigActual;
	import?: ConfigImport;
	mappings?: ConfigMappings;
	sure: ConfigSure;
};

export type ResolvedConfig = {
	actual: ConfigActual;
	import: {
		dryRun: boolean;
		effectiveDate: string;
		importedPayeeConditionTarget: 'transaction_details' | 'transaction_name';
		maxRuleVariants: number;
		namePrefix: string;
		outputDir: string;
		partialRules: boolean;
		payeeActionTarget: 'set_transaction_merchant' | 'set_transaction_name';
		payeeConditionTarget: 'transaction_merchant' | 'transaction_name';
		publish: boolean;
	};
	mappings: Required<ConfigMappings>;
	sure: {
		apiKey: string;
		baseUrl: string;
		publishTimeoutMs: number;
		timeoutMs: number;
	};
};

export function resolveRuntimeConfig(config: Config): ResolvedConfig {
	return {
		actual: resolveActualConfig(config.actual),
		import: resolveImportConfig(config.import),
		mappings: resolveMappings(config.mappings),
		sure: resolveSureConfig(config.sure),
	};
}

function resolveActualConfig(config: ConfigActual): ResolvedConfig['actual'] {
	return {
		budget: {
			password: normalizeOptionalString(process.env.ACTUAL_BUDGET_PASSWORD) ?? config.budget.password,
			syncId: normalizeRequiredString(process.env.ACTUAL_SYNC_ID) ?? config.budget.syncId,
		},
		init: {
			...config.init,
			password: normalizeOptionalString(process.env.ACTUAL_PASSWORD) ?? config.init.password,
			serverURL: normalizeRequiredString(process.env.ACTUAL_SERVER_URL) ?? config.init.serverURL,
			sessionToken: normalizeOptionalString(process.env.ACTUAL_SESSION_TOKEN) ?? config.init.sessionToken,
		},
	};
}

// This config fan-in is intentionally verbose because it resolves env, file, and defaults in one place.
// eslint-disable-next-line complexity
function resolveImportConfig(config: ConfigImport | undefined): ResolvedConfig['import'] {
	const effectiveDateOverride = process.env.IMPORT_EFFECTIVE_DATE ?? config?.effectiveDate;
	const effectiveDate = effectiveDateOverride === ''
		? ''
		: (effectiveDateOverride ?? new Date().toISOString().slice(0, 10));
	const configuredNamePrefix = config?.namePrefix?.trim();

	return {
		dryRun: parseBoolean(process.env.DRY_RUN, config?.dryRun ?? false),
		effectiveDate,
		importedPayeeConditionTarget: parseImportedPayeeConditionTarget(
			process.env.IMPORT_IMPORTED_PAYEE_CONDITION_TARGET,
			config?.importedPayeeConditionTarget ?? 'transaction_name',
		),
		maxRuleVariants: parsePositiveInteger(process.env.IMPORT_MAX_RULE_VARIANTS) ?? config?.maxRuleVariants ?? 16,
		namePrefix: configuredNamePrefix && configuredNamePrefix !== '' ? configuredNamePrefix : 'Actual Rule',
		outputDir: path.resolve(process.env.OUTPUT_DIR ?? config?.outputDir ?? './output'),
		partialRules: parseBoolean(process.env.IMPORT_PARTIAL_RULES, config?.partialRules ?? false),
		payeeActionTarget: parsePayeeActionTarget(
			process.env.IMPORT_PAYEE_ACTION_TARGET,
			config?.payeeActionTarget ?? 'set_transaction_name',
		),
		payeeConditionTarget: parsePayeeConditionTarget(
			process.env.IMPORT_PAYEE_CONDITION_TARGET,
			config?.payeeConditionTarget ?? 'transaction_name',
		),
		publish: parseBoolean(process.env.IMPORT_PUBLISH, config?.publish ?? true),
	};
}

function resolveMappings(config: ConfigMappings | undefined): ResolvedConfig['mappings'] {
	return {
		accounts: config?.accounts ?? {},
		categories: config?.categories ?? {},
		payees: config?.payees ?? {},
	};
}

function resolveSureConfig(config: ConfigSure): ResolvedConfig['sure'] {
	return {
		apiKey: normalizeRequiredString(process.env.SURE_API_KEY) ?? config.apiKey,
		baseUrl: normalizeBaseUrl(normalizeRequiredString(process.env.SURE_BASE_URL) ?? config.baseUrl),
		publishTimeoutMs: parsePositiveInteger(process.env.SURE_PUBLISH_TIMEOUT_MS) ?? config.publishTimeoutMs ?? 60_000,
		timeoutMs: parsePositiveInteger(process.env.SURE_TIMEOUT_MS) ?? config.timeoutMs ?? 30_000,
	};
}

function normalizeBaseUrl(value: string) {
	const trimmed = value.trim();
	return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizeOptionalString(value: string | undefined) {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

function normalizeRequiredString(value: string | undefined) {
	return normalizeOptionalString(value);
}

function parseBoolean(value: string | undefined, fallback: boolean) {
	if (!value) {
		return fallback;
	}

	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(normalized)) {
		return true;
	}

	if (['0', 'false', 'no', 'off'].includes(normalized)) {
		return false;
	}

	return fallback;
}

function parsePositiveInteger(value: string | undefined) {
	if (!value || value.trim() === '') {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePayeeConditionTarget(
	value: string | undefined,
	fallback: 'transaction_merchant' | 'transaction_name',
) {
	return value === 'transaction_merchant' || value === 'transaction_name' ? value : fallback;
}

function parsePayeeActionTarget(
	value: string | undefined,
	fallback: 'set_transaction_merchant' | 'set_transaction_name',
) {
	return value === 'set_transaction_merchant' || value === 'set_transaction_name' ? value : fallback;
}

function parseImportedPayeeConditionTarget(
	value: string | undefined,
	fallback: 'transaction_details' | 'transaction_name',
) {
	return value === 'transaction_details' || value === 'transaction_name' ? value : fallback;
}
