
export type ActualRuleCondition = {
	conditionsOp?: 'and' | 'or';
	customName?: string;
	field: string;
	op: string;
	options?: {
		formula?: string;
		inflow?: boolean;
		month?: boolean;
		outflow?: boolean;
		splitIndex?: number;
		template?: string;
		year?: boolean;
	};
	queryFilter?: Record<string, {$oneof: string[]}>;
	type?: string;
	value: unknown;
};

export type ActualRuleAction = {
	field?: string;
	op: string;
	options?: {
		formula?: string;
		method?: string;
		splitIndex?: number;
		template?: string;
	};
	type?: string;
	value: unknown;
};

export type ActualRule = {
	actions: ActualRuleAction[];
	conditions: ActualRuleCondition[];
	conditionsOp: 'and' | 'or';
	id: string;
	stage?: 'post' | 'pre';
	tombstone?: boolean;
};

export type ActualAccount = {
	id: string;
	name: string;
};

export type ActualCategory = {
	group_id?: string;
	id: string;
	name: string;
};

export type ActualPayee = {
	id: string;
	name: string;
	transfer_acct?: string;
};

export type SureAccount = {
	account_type: string;
	balance: string;
	classification: string;
	currency: string;
	id: string;
	name: string;
};

export type SureRuleCondition = {
	condition_type: string;
	operator: string;
	sub_conditions?: SureRuleCondition[];
	value?: number | string;
};

export type SureRuleAction = {
	action_type: string;
	value?: string;
};

export type SureRuleImportRow = {
	active: boolean;
	actions: SureRuleAction[];
	conditions: SureRuleCondition[];
	effective_date: string;
	name: string;
	resource_type: 'transaction';
};

export type RuleReport = {
	actualRuleId: string;
	generatedRuleNames: string[];
	reason?: string;
	status: 'skipped' | 'translated';
	warnings: string[];
};

export type TranslationReport = {
	actualRuleCount: number;
	generatedRuleCount: number;
	rows: SureRuleImportRow[];
	rules: RuleReport[];
	skippedRuleCount: number;
	translatedRuleCount: number;
};

export type SureImportRecord = {
	account_id?: string;
	created_at: string;
	error?: string;
	id: string;
	rows_count?: number;
	status: string;
	type: string;
	updated_at: string;
};

export type RunArtifacts = {
	csvPath: string;
	reportPath: string;
	timestampedCsvPath: string;
	timestampedReportPath: string;
};
