# Actual Budget -> Sure Rules Importer
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![XO code style](https://shields.io/badge/code_style-5ed9c7?logo=xo&labelColor=gray)](https://github.com/xojs/xo)
[![Snyk Security](../../actions/workflows/snyk-security.yml/badge.svg)](../../actions/workflows/snyk-security.yml)
[![CodeQL](../../actions/workflows/codeql.yml/badge.svg)](../../actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://www.bestpractices.dev/projects/10403/badge)](https://www.bestpractices.dev/projects/10403)

This project mirrors the supported subset of [Actual Budget](https://github.com/actualbudget/actual) transaction rules into [Sure](https://github.com/we-promise/sure) using Sure's public `RuleImport` API.

It is intentionally shaped like the existing Actual/Sure importers:
- one-shot mode by default,
- optional cron scheduling through `SCHEDULE`,
- Docker-first runtime,
- JSON config mounted into the container,
- output artifacts written to `./output`.

## What It Does

1. Connects to Actual through the official `@actual-app/api`.
2. Loads rules, payees, accounts, and categories from a selected budget.
3. Translates the supported subset of Actual rules into Sure `RuleImport` rows.
4. Writes a CSV artifact and a JSON report to `output/`.
5. Optionally uploads the CSV to Sure and waits for the import to complete.

## Important Limitations

- This is a translator, not a byte-for-byte rule engine clone.
- Sure does not expose public rule CRUD under `api/v1/rules`; this project uses `api/v1/imports` with `RuleImport`.
- Deleted rules in Actual are not automatically removed from Sure because Sure's public API does not currently expose rule deletion.
- Some Actual rule features are skipped because there is no safe Sure equivalent.

## Supported Translation Scope

Conditions currently supported:
- `amount` with `is`, `gt`, `gte`, `lt`, `lte`
- `amount` with `isbetween` by expanding into a bounded range
- `notes` with `is`, `contains`, `is_null`
- `payee` with `is` and `oneOf`
- `imported_payee` with `is`, `contains`, `oneOf`
- `category` with `is` and `oneOf`
- `account` with `is` and `oneOf`
- `transfer is true`
- `transfer is false` by expanding to income-or-expense variants

Actions currently supported:
- `set category`
- `set payee` to Sure transaction name or merchant
- `set payee` to a transfer-account payee, translated into `set_as_transfer_or_payment`
- `delete-transaction`, approximated as `exclude_transaction`

Unsupported examples:
- rule `stage` values (`pre` / `post`)
- `date`, `category_group`, `saved`, `cleared`, `reconciled`
- `matches`, `doesNotContain`, `isNot`, `notOneOf`
- `link-schedule`
- `set-split-amount`
- notes prepend/append actions

Skipped rules are listed in the JSON report with reasons.

## Installation

### Docker

```yaml
services:
  actual-to-sure-rules-importer:
    image: ghcr.io/tomerh2001/actual-to-sure-rules-importer:latest
    restart: always
    environment:
      - TZ=Asia/Jerusalem
      - SCHEDULE=0 */6 * * *
    volumes:
      - ./config.json:/app/config.json:ro
      - ./output:/app/output
```

### One-shot example

Remove `SCHEDULE` if you want the container to run once and exit.

## Configuration

The configuration file is `config.json` and has four top-level sections:
- `actual`
- `sure`
- `import`
- `mappings`

There is also a ready-to-edit starter file at [`config.example.json`](./config.example.json).

### `actual`

```json
{
  "actual": {
    "init": {
      "dataDir": "./data",
      "serverURL": "https://actual.example.com",
      "password": "actual-server-password"
    },
    "budget": {
      "syncId": "your-budget-sync-id",
      "password": "your-budget-password"
    }
  }
}
```

`actual.init` is passed directly to `@actual-app/api`.

### `sure`

```json
{
  "sure": {
    "baseUrl": "https://sure.example.com",
    "apiKey": "sure-api-key"
  }
}
```

### `import`

```json
{
  "import": {
    "namePrefix": "Actual Rule",
    "effectiveDate": "2026-04-03",
    "outputDir": "./output",
    "publish": true,
    "partialRules": false,
    "payeeConditionTarget": "transaction_name",
    "payeeActionTarget": "set_transaction_name",
    "importedPayeeConditionTarget": "transaction_name",
    "maxRuleVariants": 16
  }
}
```

Notes:
- `effectiveDate` defaults to today's date in UTC if omitted.
- Set `effectiveDate` to `""` to emit blank effective dates.
- `partialRules: false` is the safe default. If any condition or action in a rule is unsupported, the whole rule is skipped.
- `partialRules: true` keeps the supported subset, but the JSON report will still flag what was dropped.

### `mappings`

Mappings let you bridge Actual IDs/names to Sure equivalents.

```json
{
  "mappings": {
    "accounts": {
      "actual-account-id": {
        "sureAccountId": "sure-account-id"
      },
      "Checking": {
        "sureAccountName": "Bank Hapoalim"
      }
    },
    "categories": {
      "actual-category-id": "Groceries",
      "Fuel": "Car Fuel"
    },
    "payees": {
      "actual-payee-id": "Amazon",
      "AMEX CARD": "American Express"
    }
  }
}
```

Mapping lookup order is:
1. exact Actual ID
2. exact Actual name
3. fallback to the Actual name

Important:
- Category mapping values should be Sure category names, not Sure category IDs.
- Payee mapping values should be merchant or transaction-name text, depending on your chosen translation target.
- Account mapping values can be Sure account IDs or Sure account names.

## Environment Variables

Supported overrides:
- `CONFIG_PATH`
- `SCHEDULE`
- `DRY_RUN`
- `OUTPUT_DIR`
- `IMPORT_PUBLISH`
- `IMPORT_PARTIAL_RULES`
- `IMPORT_EFFECTIVE_DATE`
- `IMPORT_MAX_RULE_VARIANTS`
- `ACTUAL_SERVER_URL`
- `ACTUAL_PASSWORD`
- `ACTUAL_SESSION_TOKEN`
- `ACTUAL_SYNC_ID`
- `ACTUAL_BUDGET_PASSWORD`
- `SURE_BASE_URL`
- `SURE_API_KEY`
- `SURE_TIMEOUT_MS`
- `SURE_PUBLISH_TIMEOUT_MS`

## Output

Each run writes:
- `output/latest-rules.csv`
- `output/latest-report.json`
- timestamped copies for the same run

The report includes:
- how many Actual rules were loaded,
- how many Sure rule rows were generated,
- which rules were skipped,
- warnings for lossy translations,
- Sure import status when publishing is enabled.

## Local Development

```bash
yarn install
yarn test
```

## Runtime Notes

- The importer checks the Actual server version before downloading the budget and fails early if the bundled `@actual-app/api` version does not match.
- After downloading the Actual budget, the importer resolves the downloaded local budget file and explicitly opens it before reading rules, accounts, categories, or payees.
- The Sure upload path uses `RuleImport` through `api/v1/imports`, then polls the import status until it reaches `complete` or `failed`.
