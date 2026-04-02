/* eslint-disable @typescript-eslint/naming-convention */

import assert from 'node:assert/strict';
import test from 'node:test';
import {translateRules} from './translator.js';
import type {ResolvedConfig} from './config.js';
import type {ActualRule, SureAccount} from './types.js';
import {buildRuleImportCsv} from './utils.js';

const resolvedConfig: ResolvedConfig = {
	actual: {
		budget: {
			password: 'budget-password',
			syncId: 'sync-id',
		},
		init: {
			dataDir: './data',
			password: 'server-password',
			serverURL: 'https://actual.example.com',
		},
	},
	import: {
		dryRun: true,
		effectiveDate: '2026-04-03',
		importedPayeeConditionTarget: 'transaction_name',
		maxRuleVariants: 16,
		namePrefix: 'Actual Rule',
		outputDir: '/tmp/output',
		partialRules: false,
		payeeActionTarget: 'set_transaction_name',
		payeeConditionTarget: 'transaction_name',
		publish: false,
	},
	mappings: {
		accounts: {
			'actual-checking': {
				sureAccountId: 'sure-checking',
			},
			'Transfer Account': {
				sureAccountId: 'sure-transfer',
			},
		},
		categories: {},
		payees: {},
	},
	sure: {
		apiKey: 'api-key',
		baseUrl: 'https://sure.example.com/',
		publishTimeoutMs: 60_000,
		timeoutMs: 30_000,
	},
};

const sureAccounts: SureAccount[] = [
	{
		account_type: 'checking',
		balance: '0',
		classification: 'asset',
		currency: 'ILS',
		id: 'sure-checking',
		name: 'Checking',
	},
	{
		account_type: 'credit_card',
		balance: '0',
		classification: 'liability',
		currency: 'ILS',
		id: 'sure-transfer',
		name: 'Transfer Account',
	},
];

void test('translateRules splits OR expansions into multiple Sure rows', () => {
	const rules: ActualRule[] = [{
		actions: [{
			field: 'category',
			op: 'set',
			value: 'cat-groceries',
		}],
		conditions: [{
			field: 'payee',
			op: 'oneOf',
			value: ['payee-amazon', 'payee-super'],
		}],
		conditionsOp: 'and',
		id: 'rule-1',
	}];

	const translation = translateRules({
		config: resolvedConfig,
		lookups: {
			actualAccounts: [],
			actualCategories: [{id: 'cat-groceries', name: 'Groceries'}],
			actualPayees: [
				{id: 'payee-amazon', name: 'Amazon'},
				{id: 'payee-super', name: 'Supermarket'},
			],
			sureAccounts,
		},
		rules,
	});

	assert.equal(translation.translatedRuleCount, 1);
	assert.equal(translation.generatedRuleCount, 2);
	assert.deepEqual(
		translation.rows.map(row => row.name),
		['Actual Rule rule-1 [1/2]', 'Actual Rule rule-1 [2/2]'],
	);
	assert.deepEqual(
		translation.rows.map(row => row.conditions[0]?.value),
		['Amazon', 'Supermarket'],
	);
	assert.equal(translation.rows[0]?.actions[0]?.action_type, 'set_transaction_category');
	assert.equal(translation.rows[0]?.actions[0]?.value, 'Groceries');
});

void test('translateRules maps transfer payees to set_as_transfer_or_payment', () => {
	const rules: ActualRule[] = [{
		actions: [{
			field: 'payee',
			op: 'set',
			value: 'payee-transfer',
		}],
		conditions: [],
		conditionsOp: 'and',
		id: 'rule-2',
	}];

	const translation = translateRules({
		config: resolvedConfig,
		lookups: {
			actualAccounts: [{id: 'actual-checking', name: 'Transfer Account'}],
			actualCategories: [],
			actualPayees: [{
				id: 'payee-transfer',
				name: 'Transfer Payee',
				transfer_acct: 'actual-checking',
			}],
			sureAccounts,
		},
		rules,
	});

	assert.equal(translation.generatedRuleCount, 1);
	assert.equal(translation.rows[0]?.actions[0]?.action_type, 'set_as_transfer_or_payment');
	assert.equal(translation.rows[0]?.actions[0]?.value, 'sure-checking');
});

void test('buildRuleImportCsv escapes JSON payload cells', () => {
	const csv = buildRuleImportCsv([{
		active: true,
		actions: [{
			action_type: 'set_transaction_name',
			value: 'Amazon "Prime"',
		}],
		conditions: [{
			condition_type: 'transaction_name',
			operator: 'like',
			value: 'amazon',
		}],
		effective_date: '2026-04-03',
		name: 'Actual Rule test',
		resource_type: 'transaction',
	}]);

	const expectedBody = [
		'Actual Rule test,transaction,true,2026-04-03,',
		'"[{""condition_type"":""transaction_name"",""operator"":""like"",""value"":""amazon""}]",',
		String.raw`"[{""action_type"":""set_transaction_name"",""value"":""Amazon \u0022Prime\u0022""}]"`,
	].join('');
	const expected = [
		'name,resource_type,active,effective_date,conditions,actions',
		expectedBody,
	].join('\n');

	assert.equal(
		csv,
		expected,
	);
});
