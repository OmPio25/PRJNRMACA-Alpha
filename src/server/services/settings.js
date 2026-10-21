'use strict';
/** Pembacaan business_rules (nilai JSON) dengan default yang aman. */
const { queryAll } = require('../../../db/database');
const { parseJson } = require('../util/serialize');

const DEFAULTS = {
  batchApprovalRequired: true,
  unmappedAgentAction: 'PENDING_MAPPING',
  claimNoGloballyUnique: true,
  defaultDateFormat: 'DD/MM/YYYY',
  rejectUnknownProduct: true,
  netClaimFormula: '',
  reportRateMethod: 'RATE_AS_OF_PERIOD_END',
  productionBusinessKeyColumns: ['PolicyNo', 'PolicyRiskID', 'EffectiveDate', 'TransactionType'],
  productionHashColumns: ['PolicyNo', 'PolicyRiskID', 'EffectiveDate', 'TransactionType', 'Product', 'Coverage', 'TSI', 'Premium', 'Currency'],
  claimHashColumns: ['ClaimNo', 'PolicyNo', 'SettlementDate', 'Currency', 'GrossClaim', 'Indemnity', 'Deductible', 'Salvage', 'Subrogation'],
  agentHashColumns: ['KODEAGEN', 'AgentIDSource', 'NamaAgent', 'Cabang', 'StatusAgent'],
};

const CAMEL = {
  batch_approval_required: 'batchApprovalRequired',
  unmapped_agent_action: 'unmappedAgentAction',
  claim_no_globally_unique: 'claimNoGloballyUnique',
  default_date_format: 'defaultDateFormat',
  reject_unknown_product: 'rejectUnknownProduct',
  net_claim_formula: 'netClaimFormula',
  report_rate_method: 'reportRateMethod',
  production_business_key_columns: 'productionBusinessKeyColumns',
  production_hash_columns: 'productionHashColumns',
  claim_hash_columns: 'claimHashColumns',
  agent_hash_columns: 'agentHashColumns',
};

function decodeRule(row) {
  const value = parseJson(row.rule_value, row.rule_value);
  return value;
}

function loadRuleRows() {
  return queryAll(
    `SELECT rule_key, rule_value, data_type, description, status, version_no,
            approved_by, approved_at, updated_at, updated_by
       FROM business_rules ORDER BY rule_key`,
  );
}

function loadRules() {
  const rules = { ...DEFAULTS };
  for (const row of loadRuleRows()) {
    const key = CAMEL[row.rule_key];
    if (key) rules[key] = decodeRule(row);
  }
  if (!['PENDING_MAPPING', 'REJECT'].includes(rules.unmappedAgentAction)) {
    rules.unmappedAgentAction = 'PENDING_MAPPING';
  }
  return rules;
}

function hashConfigFromRules(uploadType, rules) {
  if (uploadType === 'PRODUCTION') {
    return {
      version: 'RULES',
      columns: rules.productionHashColumns,
      businessKeyColumns: rules.productionBusinessKeyColumns,
    };
  }
  if (uploadType === 'CLAIM') {
    return { version: 'RULES', columns: rules.claimHashColumns, businessKeyColumns: ['ClaimNo'] };
  }
  return { version: 'RULES', columns: rules.agentHashColumns, businessKeyColumns: ['KODEAGEN'] };
}

module.exports = { DEFAULTS, CAMEL, loadRuleRows, loadRules, hashConfigFromRules, decodeRule };
