/* eslint-disable unicorn/no-process-exit */

import process from 'node:process';
import moment from 'moment';
import cron, {type ScheduledTask, validate} from 'node-cron';
import cronstrue from 'cronstrue';
import {loadConfig, runImporter, summarizeRun} from './importer.js';
import {resolveRuntimeConfig} from './config.js';

let scheduledTask: ScheduledTask | undefined;

async function run() {
	const rawConfig = await loadConfig();
	const config = resolveRuntimeConfig(rawConfig);
	const result = await runImporter();
	console.log(summarizeRun(result, config));
}

async function safeRun() {
	try {
		await run();
	} catch (error) {
		console.error('Error running importer:', error);
		process.exitCode = 1;
	} finally {
		if (scheduledTask) {
			printNextRunTime();
		}
	}
}

function printNextRunTime() {
	if (!scheduledTask) {
		return;
	}

	const nextRun = scheduledTask.getNextRun();
	console.log('Next run:', moment(nextRun).fromNow(), 'at', moment(nextRun).format('YYYY-MM-DD HH:mm:ss'));
}

if (process.env.SCHEDULE) {
	if (!validate(process.env.SCHEDULE)) {
		throw new Error(`Invalid cron schedule: ${process.env.SCHEDULE}`);
	}

	console.log('Started scheduled run:', process.env.SCHEDULE, `(${cronstrue.toString(process.env.SCHEDULE)})`);
	scheduledTask = cron.schedule(process.env.SCHEDULE, safeRun);
	printNextRunTime();
} else {
	await safeRun();
	setTimeout(() => process.exit(process.exitCode ?? 0), moment.duration(5, 'seconds').asMilliseconds());
}
