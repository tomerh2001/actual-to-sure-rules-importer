import assert from 'node:assert/strict';
import test from 'node:test';

const noop = () => undefined;

Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	value: {platform: 'linux'},
});

const actualClientModule = await import('./actual-client.js');
const actualClientClass = actualClientModule.ActualClient;
const {resolveBudgetId} = actualClientModule;

void test('resolveBudgetId matches a downloaded budget by sync group id', () => {
	assert.equal(
		resolveBudgetId([
			{id: 'budget-file-id', groupId: 'sync-id'},
		], 'sync-id'),
		'budget-file-id',
	);
});

void test('ActualClient.connect downloads and loads the requested budget before reading data', async () => {
	const callLog: string[] = [];

	// eslint-disable-next-line new-cap
	const client = new actualClientClass(
		{
			budget: {
				password: 'budget-password',
				syncId: 'sync-id',
			},
			init: {
				dataDir: './cache',
				password: 'server-password',
				// eslint-disable-next-line @typescript-eslint/naming-convention
				serverURL: 'https://actual.example.com',
			},
		},
		{
			api: {
				async downloadBudget(syncId) {
					callLog.push(`downloadBudget:${syncId}`);
				},
				async getAccounts() {
					callLog.push('getAccounts');
					return [];
				},
				async getBudgets() {
					callLog.push('getBudgets');
					return [{groupId: 'sync-id', id: 'budget-file-id'}];
				},
				async getCategories() {
					callLog.push('getCategories');
					return [];
				},
				async getPayees() {
					callLog.push('getPayees');
					return [];
				},
				async getRules() {
					callLog.push('getRules');
					return [];
				},
				async getServerVersion() {
					callLog.push('getServerVersion');
					return {version: '26.3.0'};
				},
				async init() {
					callLog.push('init');
				},
				async loadBudget(budgetId) {
					callLog.push(`loadBudget:${budgetId}`);
				},
				async shutdown() {
					callLog.push('shutdown');
				},
			},
			stdout: {
				mute: noop,
				unmute: noop,
			},
		},
	);

	await client.connect();
	await client.loadSnapshot();
	await client.disconnect();

	assert.deepEqual(callLog, [
		'init',
		'getServerVersion',
		'downloadBudget:sync-id',
		'getBudgets',
		'loadBudget:budget-file-id',
		'getRules',
		'getAccounts',
		'getCategories',
		'getPayees',
		'shutdown',
	]);
});
