import process from 'node:process';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {ActualClient} from './actual-client.js';
import {resolveRuntimeConfig, type Config, type ResolvedConfig} from './config.js';
import {SureClient} from './sure-client.js';
import {translateRules} from './translator.js';
import {buildRuleImportCsv, writeRunArtifacts} from './utils.js';

export async function loadConfig() {
	const configPath = path.resolve(process.env.CONFIG_PATH ?? 'config.json');
	const rawConfig = await readFile(configPath, 'utf8');
	return JSON.parse(rawConfig) as Config;
}

export async function runImporter() {
	const rawConfig = await loadConfig();
	const config = resolveRuntimeConfig(rawConfig);
	await mkdir(config.import.outputDir, {recursive: true});

	const actual = new ActualClient(config.actual);
	const sure = new SureClient(config.sure);

	await actual.connect();
	try {
		const snapshot = await actual.loadSnapshot();
		const sureAccounts = await sure.getAccounts();
		const translation = translateRules({
			config,
			lookups: {
				actualAccounts: snapshot.accounts,
				actualCategories: snapshot.categories,
				actualPayees: snapshot.payees,
				sureAccounts,
			},
			rules: snapshot.rules,
		});
		const csv = buildRuleImportCsv(translation.rows);

		let importRecord:
			| {
				error?: string;
				id?: string;
				status: 'dry_run' | 'not_published' | string;
			}
			| undefined;

		if (config.import.dryRun) {
			importRecord = {status: 'dry_run'};
		} else if (translation.rows.length === 0) {
			importRecord = {status: 'not_published'};
		} else {
			const createdImport = await sure.createRuleImport({
				csv,
				publish: config.import.publish,
			});

			importRecord = {
				id: createdImport.id,
				status: createdImport.status,
			};

			if (config.import.publish) {
				const finalImport = await sure.waitForImport(createdImport.id);
				importRecord = {
					error: finalImport.error,
					id: finalImport.id,
					status: finalImport.status,
				};

				if (finalImport.status === 'failed') {
					throw new Error(`Sure rule import ${finalImport.id} failed: ${finalImport.error ?? 'Unknown error'}`);
				}
			}
		}

		const report = {
			actualAccountsLoaded: snapshot.accounts.length,
			actualCategoriesLoaded: snapshot.categories.length,
			actualPayeesLoaded: snapshot.payees.length,
			actualRulesLoaded: snapshot.rules.length,
			import: importRecord,
			outputDir: config.import.outputDir,
			publishEnabled: config.import.publish,
			translation,
		};

		const artifacts = await writeRunArtifacts({
			csv,
			outputDir: config.import.outputDir,
			report,
		});

		return {
			artifacts,
			import: importRecord,
			translation,
		};
	} finally {
		await actual.disconnect();
	}
}

export function summarizeRun(result: Awaited<ReturnType<typeof runImporter>>, config: ResolvedConfig) {
	const {translation} = result;
	return [
		`Translated ${translation.translatedRuleCount}/${translation.actualRuleCount} Actual rules into ${translation.generatedRuleCount} Sure rule row(s).`,
		`Skipped ${translation.skippedRuleCount} rule(s).`,
		`Publish: ${config.import.dryRun ? 'dry-run only' : (result.import?.status ?? 'not requested')}.`,
		`Artifacts: ${result.artifacts.csvPath}, ${result.artifacts.reportPath}.`,
	].join(' ');
}
