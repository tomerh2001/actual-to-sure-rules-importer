/* eslint-disable @typescript-eslint/naming-convention */

import type {ConfigMappings, ResolvedConfig} from './config.js';
import type {
	ActualAccount,
	ActualCategory,
	ActualPayee,
	ActualRule,
	ActualRuleAction,
	ActualRuleCondition,
	RuleReport,
	SureAccount,
	SureRuleAction,
	SureRuleCondition,
	SureRuleImportRow,
	TranslationReport,
} from './types.js';
import {normalizeLookupKey, readString} from './utils.js';

type TranslationContext = {
	config: ResolvedConfig;
	lookups: {
		actualAccounts: ActualAccount[];
		actualCategories: ActualCategory[];
		actualPayees: ActualPayee[];
		sureAccounts: SureAccount[];
	};
};

type SimpleCondition = Omit<SureRuleCondition, 'sub_conditions'>;

type ConditionExpansion = {
	conditions: SimpleCondition[];
	join: 'and' | 'or';
};

type ResolvedPayee = {
	name: string;
	payee?: ActualPayee;
};

export function translateRules({
	config,
	lookups,
	rules,
}: TranslationContext & {
	rules: ActualRule[];
}): TranslationReport {
	const rows: SureRuleImportRow[] = [];
	const reports: RuleReport[] = [];

	for (const rule of rules) {
		const result = translateRule({config, lookups, rule});
		reports.push(result.report);
		rows.push(...result.rows);
	}

	return {
		actualRuleCount: rules.length,
		generatedRuleCount: rows.length,
		rows,
		rules: reports,
		skippedRuleCount: reports.filter(report => report.status === 'skipped').length,
		translatedRuleCount: reports.filter(report => report.status === 'translated').length,
	};
}

function translateRule({
	config,
	lookups,
	rule,
}: TranslationContext & {
	rule: ActualRule;
}) {
	const warnings: string[] = [];
	const failures: string[] = [];

	if (rule.tombstone) {
		return {
			report: buildSkippedReport(rule, 'Rule is tombstoned in Actual.'),
			rows: [],
		};
	}

	if (rule.stage) {
		return {
			report: buildSkippedReport(rule, `Rule stage ${rule.stage} is not supported by Sure.`),
			rows: [],
		};
	}

	const actionResult = translateActions({
		actions: rule.actions,
		config,
		lookups,
	});
	warnings.push(...actionResult.warnings);
	failures.push(...actionResult.failures);

	const conditionResult = translateConditions({
		conditions: rule.conditions,
		config,
		lookups,
		topJoin: rule.conditionsOp,
	});
	warnings.push(...conditionResult.warnings);
	failures.push(...conditionResult.failures);

	if (actionResult.actions.length === 0) {
		failures.push('No supported actions remained after translation.');
	}

	if (!config.import.partialRules && failures.length > 0) {
		return {
			report: buildSkippedReport(rule, failures.join(' '), warnings),
			rows: [],
		};
	}

	if (actionResult.actions.length === 0) {
		return {
			report: buildSkippedReport(rule, failures.join(' '), warnings),
			rows: [],
		};
	}

	const variants = expandConditions({
		config,
		expansions: conditionResult.expansions,
		topJoin: rule.conditionsOp,
	});
	if (!variants.ok) {
		return {
			report: buildSkippedReport(rule, variants.reason, warnings),
			rows: [],
		};
	}

	if (variants.variants.length === 0) {
		variants.variants.push([]);
	}

	const rows = variants.variants.map((variant, index) => {
		const rowName = variants.variants.length === 1
			? `${config.import.namePrefix} ${rule.id}`
			: `${config.import.namePrefix} ${rule.id} [${index + 1}/${variants.variants.length}]`;

		return {
			active: true,
			actions: actionResult.actions,
			conditions: variant,
			effective_date: config.import.effectiveDate,
			name: rowName,
			resource_type: 'transaction' as const,
		};
	});

	if (failures.length > 0) {
		warnings.push(`Partial translation kept the supported subset and dropped: ${failures.join(' ')}`);
	}

	return {
		report: {
			actualRuleId: rule.id,
			generatedRuleNames: rows.map(row => row.name),
			status: 'translated' as const,
			warnings,
		},
		rows,
	};
}

function translateConditions({
	config,
	conditions,
	lookups,
	topJoin,
}: TranslationContext & {
	conditions: ActualRuleCondition[];
	topJoin: 'and' | 'or';
}) {
	const expansions: ConditionExpansion[] = [];
	const warnings: string[] = [];
	const failures: string[] = [];

	for (const condition of conditions) {
		const translated = translateCondition({
			config, condition, lookups, topJoin,
		});
		warnings.push(...translated.warnings);
		if (!translated.expansion) {
			failures.push(translated.reason);
			continue;
		}

		expansions.push(translated.expansion);
	}

	return {
		expansions,
		failures,
		warnings,
	};
}

function translateCondition({
	config,
	condition,
	lookups,
	topJoin,
}: TranslationContext & {
	condition: ActualRuleCondition;
	topJoin: 'and' | 'or';
}): {
		expansion?: ConditionExpansion;
		reason: string;
		warnings: string[];
	} {
	const {field, op} = condition;
	const warnings: string[] = [];

	switch (field) {
		case 'amount': {
			return translateAmountCondition(condition);
		}

		case 'notes': {
			return translateTextCondition({
				condition,
				conditionType: 'transaction_notes',
				label: 'notes',
			});
		}

		case 'imported_payee': {
			warnings.push(`Actual imported_payee condition is translated to ${config.import.importedPayeeConditionTarget}.`);
			return translateTextCondition({
				condition,
				conditionType: config.import.importedPayeeConditionTarget,
				label: 'imported_payee',
			}, warnings);
		}

		case 'payee': {
			const resolvedPayeeNames = resolvePayeeConditionValues(condition.value, lookups.actualPayees, config.mappings.payees);
			if (resolvedPayeeNames.length === 0) {
				return unsupported(`Actual payee condition ${op} could not resolve a payee name.`, warnings);
			}

			warnings.push(`Actual payee condition is translated to ${config.import.payeeConditionTarget}.`);
			return translateTextOrSelectCondition({
				label: 'payee',
				op,
				targetType: config.import.payeeConditionTarget,
				value: resolvedPayeeNames.length === 1 ? resolvedPayeeNames[0] : resolvedPayeeNames,
			}, warnings, topJoin);
		}

		case 'category': {
			const categoryNames = resolveCategoryNames(condition.value, lookups.actualCategories, config.mappings.categories);
			if (categoryNames.length === 0) {
				return unsupported(`Actual category condition ${op} could not resolve a category name.`, warnings);
			}

			return translateSelectCondition({
				conditionType: 'transaction_category',
				label: 'category',
				op,
				value: categoryNames.length === 1 ? categoryNames[0] : categoryNames,
			}, warnings, topJoin);
		}

		case 'account': {
			const sureAccountIds = resolveSureAccountIds(condition.value, lookups.actualAccounts, lookups.sureAccounts, config.mappings);
			if (sureAccountIds.length === 0) {
				return unsupported(`Actual account condition ${op} could not resolve a Sure account mapping.`, warnings);
			}

			return translateSelectCondition({
				conditionType: 'transaction_account',
				label: 'account',
				op,
				value: sureAccountIds,
			}, warnings, topJoin);
		}

		case 'transfer': {
			if (condition.value === true && op === 'is') {
				return {
					expansion: {
						conditions: [{
							condition_type: 'transaction_type',
							operator: '=',
							value: 'transfer',
						}],
						join: 'and',
					},
					reason: '',
					warnings,
				};
			}

			if (condition.value === false && op === 'is') {
				warnings.push('Actual transfer=false is expanded to income-or-expense variants.');
				return {
					expansion: {
						conditions: [
							{condition_type: 'transaction_type', operator: '=', value: 'income'},
							{condition_type: 'transaction_type', operator: '=', value: 'expense'},
						],
						join: 'or',
					},
					reason: '',
					warnings,
				};
			}

			return unsupported(`Actual transfer condition with op ${op} is not supported.`, warnings);
		}

		default: {
			return unsupported(`Actual condition field ${field} is not supported.`, warnings);
		}
	}
}

function translateAmountCondition(condition: ActualRuleCondition) {
	const {op, value: rawValue} = condition;
	if (op === 'isbetween' && isBetweenValue(rawValue)) {
		return {
			expansion: {
				conditions: [
					{condition_type: 'transaction_amount', operator: '>=', value: rawValue.num1},
					{condition_type: 'transaction_amount', operator: '<=', value: rawValue.num2},
				],
				join: 'and' as const,
			},
			reason: '',
			warnings: [],
		};
	}

	const numericValue = toFiniteNumber(rawValue);
	if (numericValue === undefined) {
		return unsupported(`Actual amount condition ${op} has a non-numeric value.`, []);
	}

	const translatedOperator = mapAmountOperator(op);
	if (!translatedOperator) {
		return unsupported(`Actual amount operator ${op} is not supported.`, []);
	}

	return {
		expansion: {
			conditions: [{
				condition_type: 'transaction_amount',
				operator: translatedOperator,
				value: numericValue,
			}],
			join: 'and' as const,
		},
		reason: '',
		warnings: [],
	};
}

function translateTextCondition(
	{
		condition,
		conditionType,
		label,
	}: {
		condition: ActualRuleCondition;
		conditionType: string;
		label: string;
	},
	baseWarnings: string[] = [],
) {
	const {op} = condition;
	const value = readString(condition.value);
	if (op === 'is' && value) {
		return {
			expansion: {
				conditions: [{
					condition_type: conditionType,
					operator: '=',
					value,
				}],
				join: 'and' as const,
			},
			reason: '',
			warnings: baseWarnings,
		};
	}

	if (op === 'contains' && value) {
		return {
			expansion: {
				conditions: [{
					condition_type: conditionType,
					operator: 'like',
					value,
				}],
				join: 'and' as const,
			},
			reason: '',
			warnings: baseWarnings,
		};
	}

	if (op === 'oneOf' && Array.isArray(condition.value) && condition.value.every(item => readString(item) !== undefined)) {
		return {
			expansion: {
				conditions: condition.value.map(item => ({
					condition_type: conditionType,
					operator: '=',
					value: readString(item)!,
				})),
				join: 'or' as const,
			},
			reason: '',
			warnings: baseWarnings,
		};
	}

	return unsupported(`Actual ${label} operator ${op} is not supported.`, baseWarnings);
}

function translateTextOrSelectCondition(
	{
		label,
		op,
		targetType,
		value,
	}: {
		label: string;
		op: string;
		targetType: 'transaction_merchant' | 'transaction_name';
		value: string | string[];
	},
	baseWarnings: string[],
	topJoin: 'and' | 'or',
) {
	if (targetType === 'transaction_name') {
		return translateTextCondition({
			condition: {field: label, op, value},
			conditionType: targetType,
			label,
		}, baseWarnings);
	}

	return translateSelectCondition({
		conditionType: targetType,
		label,
		op,
		value,
	}, baseWarnings, topJoin);
}

function translateSelectCondition(
	{
		conditionType,
		label,
		op,
		value,
	}: {
		conditionType: string;
		label: string;
		op: string;
		value: string | string[];
	},
	baseWarnings: string[],
	topJoin: 'and' | 'or',
) {
	const values = Array.isArray(value) ? value : [value];
	if (op === 'is') {
		const first = values[0];
		if (!first) {
			return unsupported(`Actual ${label} condition is missing a value.`, baseWarnings);
		}

		return {
			expansion: {
				conditions: [{
					condition_type: conditionType,
					operator: '=',
					value: first,
				}],
				join: 'and' as const,
			},
			reason: '',
			warnings: baseWarnings,
		};
	}

	if (op === 'oneOf' && values.length > 0) {
		return {
			expansion: {
				conditions: values.map(currentValue => ({
					condition_type: conditionType,
					operator: '=',
					value: currentValue,
				})),
				join: 'or' as const,
			},
			reason: '',
			warnings: baseWarnings,
		};
	}

	if (op === 'isNot' || op === 'notOneOf') {
		return unsupported(`Actual ${label} operator ${op} cannot be represented with Sure's public rule import operators.`, baseWarnings);
	}

	if (topJoin === 'or' && op === 'is') {
		return {
			expansion: {
				conditions: [{
					condition_type: conditionType,
					operator: '=',
					value: values[0],
				}],
				join: 'and' as const,
			},
			reason: '',
			warnings: baseWarnings,
		};
	}

	return unsupported(`Actual ${label} operator ${op} is not supported.`, baseWarnings);
}

function translateActions({
	actions,
	config,
	lookups,
}: TranslationContext & {
	actions: ActualRuleAction[];
}) {
	const sureActions: SureRuleAction[] = [];
	const warnings: string[] = [];
	const failures: string[] = [];

	for (const action of actions) {
		const translated = translateAction({action, config, lookups});
		warnings.push(...translated.warnings);
		if (!translated.action) {
			failures.push(translated.reason);
			continue;
		}

		sureActions.push(translated.action);
	}

	return {
		actions: dedupeActions(sureActions),
		failures,
		warnings,
	};
}

function translateAction({
	action,
	config,
	lookups,
}: TranslationContext & {
	action: ActualRuleAction;
}): {
		action?: SureRuleAction;
		reason: string;
		warnings: string[];
	} {
	const warnings: string[] = [];

	if (action.op === 'delete-transaction') {
		warnings.push('Actual delete-transaction is approximated as exclude_transaction in Sure.');
		return {
			action: {
				action_type: 'exclude_transaction',
			},
			reason: '',
			warnings,
		};
	}

	if (action.op !== 'set') {
		return unsupportedAction(`Actual action ${action.op} is not supported.`, warnings);
	}

	switch (action.field) {
		case 'category': {
			const categoryName = resolveCategoryName(action.value, lookups.actualCategories, config.mappings.categories);
			if (!categoryName) {
				return unsupportedAction('Actual category action could not resolve a category name.', warnings);
			}

			return {
				action: {
					action_type: 'set_transaction_category',
					value: categoryName,
				},
				reason: '',
				warnings,
			};
		}

		case 'payee':
		case 'payee_name': {
			const resolved = resolvePayeeValue(action.value, lookups.actualPayees, config.mappings.payees);
			if (!resolved.name) {
				return unsupportedAction('Actual payee action could not resolve a payee name.', warnings);
			}

			if (resolved.payee?.transfer_acct) {
				const targetAccount = resolveSureAccountIds(
					resolved.payee.transfer_acct,
					lookups.actualAccounts,
					lookups.sureAccounts,
					config.mappings,
				)[0];
				if (targetAccount) {
					warnings.push('Actual transfer payee action is translated to set_as_transfer_or_payment.');
					return {
						action: {
							action_type: 'set_as_transfer_or_payment',
							value: targetAccount,
						},
						reason: '',
						warnings,
					};
				}
			}

			warnings.push(`Actual payee action is translated to ${config.import.payeeActionTarget}.`);
			return {
				action: {
					action_type: config.import.payeeActionTarget,
					value: resolved.name,
				},
				reason: '',
				warnings,
			};
		}

		case undefined: {
			return unsupportedAction('Actual set action is missing a field.', warnings);
		}

		default: {
			return unsupportedAction(`Actual set action for field ${action.field} is not supported.`, warnings);
		}
	}
}

function expandConditions({
	config,
	expansions,
	topJoin,
}: {
	config: ResolvedConfig;
	expansions: ConditionExpansion[];
	topJoin: 'and' | 'or';
}): {
		ok: boolean;
		reason: string;
		variants: SureRuleCondition[][];
	} {
	if (expansions.length === 0) {
		return {ok: true, reason: '', variants: [[]]};
	}

	if (topJoin === 'and') {
		let variants: SimpleCondition[][] = [[]];
		for (const expansion of expansions) {
			if (expansion.join === 'and' || expansion.conditions.length === 1) {
				variants = variants.map(variant => [...variant, ...expansion.conditions]);
				continue;
			}

			const nextVariants: SimpleCondition[][] = [];
			for (const variant of variants) {
				for (const condition of expansion.conditions) {
					nextVariants.push([...variant, condition]);
				}
			}

			if (nextVariants.length > config.import.maxRuleVariants) {
				return {
					ok: false,
					reason: `Rule expansion exceeded the maxRuleVariants limit of ${config.import.maxRuleVariants}.`,
					variants: [],
				};
			}

			variants = nextVariants;
		}

		return {
			ok: true,
			reason: '',
			variants: variants.map(variant => variant.map(condition => ({...condition}))),
		};
	}

	const variants: SureRuleCondition[][] = [];
	for (const expansion of expansions) {
		if (expansion.join === 'or' || expansion.conditions.length === 1) {
			for (const condition of expansion.conditions) {
				variants.push([{...condition}]);
			}
		} else {
			variants.push(expansion.conditions.map(condition => ({...condition})));
		}
	}

	if (variants.length > config.import.maxRuleVariants) {
		return {
			ok: false,
			reason: `Rule expansion exceeded the maxRuleVariants limit of ${config.import.maxRuleVariants}.`,
			variants: [],
		};
	}

	return {ok: true, reason: '', variants};
}

function resolveCategoryName(
	value: unknown,
	actualCategories: ActualCategory[],
	mappings: ConfigMappings['categories'],
) {
	const raw = readString(value);
	if (!raw) {
		return undefined;
	}

	const category = actualCategories.find(candidate => candidate.id === raw) ?? actualCategories.find(candidate => candidate.name === raw);
	if (category) {
		return mappings?.[category.id] ?? mappings?.[category.name] ?? category.name;
	}

	return mappings?.[raw] ?? raw;
}

function resolveCategoryNames(
	value: unknown,
	actualCategories: ActualCategory[],
	mappings: ConfigMappings['categories'],
) {
	const rawValues = Array.isArray(value)
		? value.map(item => readString(item)).filter(Boolean)
		: [readString(value)].filter(Boolean);

	return rawValues.flatMap(rawValue => {
		if (!rawValue) {
			return [];
		}

		const resolved = resolveCategoryName(rawValue, actualCategories, mappings);
		return resolved ? [resolved] : [];
	});
}

function resolvePayeeValue(
	value: unknown,
	actualPayees: ActualPayee[],
	mappings: ConfigMappings['payees'],
): ResolvedPayee {
	const raw = readString(value);
	if (!raw) {
		return {name: ''};
	}

	const payee = actualPayees.find(candidate => candidate.id === raw) ?? actualPayees.find(candidate => candidate.name === raw);
	if (payee) {
		return {
			name: mappings?.[payee.id] ?? mappings?.[payee.name] ?? payee.name,
			payee,
		};
	}

	return {
		name: mappings?.[raw] ?? raw,
	};
}

function resolvePayeeConditionValues(
	value: unknown,
	actualPayees: ActualPayee[],
	mappings: ConfigMappings['payees'],
) {
	const rawValues = Array.isArray(value)
		? value.map(item => readString(item)).filter(Boolean)
		: [readString(value)].filter(Boolean);

	return rawValues.flatMap(rawValue => {
		if (!rawValue) {
			return [];
		}

		const resolved = resolvePayeeValue(rawValue, actualPayees, mappings);
		return resolved.name ? [resolved.name] : [];
	});
}

function resolveSureAccountIds(
	value: unknown,
	actualAccounts: ActualAccount[],
	sureAccounts: SureAccount[],
	mappings: ConfigMappings,
) {
	const rawValues = Array.isArray(value)
		? value.map(item => readString(item)).filter(Boolean)
		: [readString(value)].filter(Boolean);
	return rawValues.flatMap(rawValue => {
		if (!rawValue) {
			return [];
		}

		const actualAccount = actualAccounts.find(candidate => candidate.id === rawValue) ?? actualAccounts.find(candidate => candidate.name === rawValue);
		const mappedReference = actualAccount
			? mappings.accounts?.[actualAccount.id] ?? mappings.accounts?.[actualAccount.name] ?? actualAccount.name
			: mappings.accounts?.[rawValue] ?? rawValue;

		const resolved = resolveSureAccountReference(mappedReference, sureAccounts);
		return resolved ? [resolved] : [];
	});
}

function resolveSureAccountReference(reference: string | undefined | {
	sureAccountId: string;
} | {
	sureAccountName: string;
}, sureAccounts: SureAccount[]) {
	if (!reference) {
		return undefined;
	}

	if (typeof reference === 'string') {
		const byId = sureAccounts.find(account => account.id === reference);
		if (byId) {
			return byId.id;
		}

		const byName = sureAccounts.find(account => normalizeLookupKey(account.name) === normalizeLookupKey(reference));
		return byName?.id;
	}

	if ('sureAccountId' in reference) {
		const account = sureAccounts.find(candidate => candidate.id === reference.sureAccountId);
		return account?.id;
	}

	const account = sureAccounts.find(candidate => normalizeLookupKey(candidate.name) === normalizeLookupKey(reference.sureAccountName));
	return account?.id;
}

function dedupeActions(actions: SureRuleAction[]) {
	const seen = new Set<string>();
	return actions.filter(action => {
		const key = JSON.stringify(action);
		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
}

function buildSkippedReport(rule: ActualRule, reason: string, warnings: string[] = []): RuleReport {
	return {
		actualRuleId: rule.id,
		generatedRuleNames: [],
		reason,
		status: 'skipped',
		warnings,
	};
}

function unsupported(reason: string, warnings: string[]) {
	return {
		expansion: undefined,
		reason,
		warnings,
	};
}

function unsupportedAction(reason: string, warnings: string[]) {
	return {
		action: undefined,
		reason,
		warnings,
	};
}

function mapAmountOperator(op: string) {
	switch (op) {
		case 'is': {
			return '=';
		}

		case 'gt': {
			return '>';
		}

		case 'gte': {
			return '>=';
		}

		case 'lt': {
			return '<';
		}

		case 'lte': {
			return '<=';
		}

		default: {
			return undefined;
		}
	}
}

function isBetweenValue(value: unknown): value is {num1: number; num2: number} {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as {num1?: unknown; num2?: unknown};
	return toFiniteNumber(candidate.num1) !== undefined && toFiniteNumber(candidate.num2) !== undefined;
}

function toFiniteNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	return undefined;
}
