import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import moment from 'moment';
import type {RunArtifacts, SureRuleImportRow} from './types.js';

export function normalizeLookupKey(value: string) {
	return value.trim().toLocaleLowerCase('en-US');
}

export function readString(value: unknown) {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function stripUndefined<T extends Record<string, unknown>>(object: T): T {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}

export function buildRuleImportCsv(rows: SureRuleImportRow[]) {
	const header = ['name', 'resource_type', 'active', 'effective_date', 'conditions', 'actions'];
	const lines = [
		header,
		...rows.map(row => [
			row.name,
			row.resource_type,
			String(row.active),
			row.effective_date,
			stringifyJsonCell(row.conditions),
			stringifyJsonCell(row.actions),
		]),
	];

	return lines.map(cells => cells.map(cell => escapeCsvCell(cell)).join(',')).join('\n');
}

export async function writeRunArtifacts({
	csv,
	outputDir,
	report,
}: {
	csv: string;
	outputDir: string;
	report: unknown;
}): Promise<RunArtifacts> {
	await mkdir(outputDir, {recursive: true});

	const timestamp = moment.utc().format('YYYYMMDD-HHmmss');
	const latestCsvPath = path.join(outputDir, 'latest-rules.csv');
	const latestReportPath = path.join(outputDir, 'latest-report.json');
	const timestampedCsvPath = path.join(outputDir, `${timestamp}-rules.csv`);
	const timestampedReportPath = path.join(outputDir, `${timestamp}-report.json`);
	const reportJson = `${JSON.stringify(report, null, 2)}\n`;

	await Promise.all([
		writeFile(latestCsvPath, `${csv}\n`, 'utf8'),
		writeFile(latestReportPath, reportJson, 'utf8'),
		writeFile(timestampedCsvPath, `${csv}\n`, 'utf8'),
		writeFile(timestampedReportPath, reportJson, 'utf8'),
	]);

	return {
		csvPath: latestCsvPath,
		reportPath: latestReportPath,
		timestampedCsvPath,
		timestampedReportPath,
	};
}

export async function delay(ms: number) {
	await new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

function escapeCsvCell(value: string) {
	if (!/[",\n\r]/.test(value)) {
		return value;
	}

	return `"${value.replaceAll('"', '""')}"`;
}

function stringifyJsonCell(value: unknown) {
	return JSON.stringify(value).replaceAll(String.raw`\"`, String.raw`\u0022`);
}
