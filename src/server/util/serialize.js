'use strict';
/** Serializer DB row -> bentuk JSON kontrak API. */
const { fromMinorUnits } = require('../../../db/canonical');

const AMOUNT_FIELDS = new Set([
  'TSI', 'Premium', 'GrossClaim', 'Indemnity', 'Deductible', 'Salvage', 'Subrogation',
  'TSIAtLoss',
]);

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function bool(value) {
  return value === 1 || value === true;
}

function amount(value) {
  return value === null || value === undefined ? null : fromMinorUnits(value);
}

function isoOrNull(value) {
  return value === null || value === undefined ? null : value;
}

function serializeUser(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    roleKey: row.role_key,
    roleName: row.role_name || null,
    allowedUploadTypes: parseJson(row.allowed_upload_types, []),
    branchScope: parseJson(row.branch_scope, []),
    mustChangePassword: bool(row.must_change_password),
  };
}

function batchFlags(row, options = {}) {
  const status = row.processing_status;
  return {
    canValidate: ['Uploaded', 'Ready for Review', 'Failed'].includes(status),
    canApprove: status === 'Ready for Review',
    canReject: status === 'Ready for Review',
    canPost: status === 'Approved' || (status === 'Ready for Review' && options.approvalRequired === false),
    canCancel: ['Uploaded', 'Ready for Review', 'Approved'].includes(status),
  };
}

function serializeBatch(row, options = {}) {
  if (!row) return null;
  return {
    uploadBatchId: row.upload_batch_id,
    uploadType: row.upload_type,
    originalFileName: row.original_file_name,
    fileContentHash: row.file_content_hash,
    fileSizeBytes: row.file_size_bytes,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name || null,
    uploadedAt: row.uploaded_at,
    totalRows: row.total_rows,
    newRows: row.new_rows,
    duplicateRows: row.duplicate_rows,
    changedRows: row.changed_rows,
    rejectedRows: row.rejected_rows,
    pendingMappingRows: row.pending_mapping_rows,
    postedRows: row.posted_rows,
    processingStatus: row.processing_status,
    processedAt: isoOrNull(row.processed_at),
    approvedBy: isoOrNull(row.approved_by),
    approvedAt: isoOrNull(row.approved_at),
    rejectedBy: isoOrNull(row.rejected_by),
    rejectedAt: isoOrNull(row.rejected_at),
    rejectionReason: isoOrNull(row.rejection_reason),
    cancelledBy: isoOrNull(row.cancelled_by),
    cancelledAt: isoOrNull(row.cancelled_at),
    cancellationReason: isoOrNull(row.cancellation_reason),
    hashConfigVersion: isoOrNull(row.hash_config_version),
    dateFormat: isoOrNull(row.date_format),
    remarks: isoOrNull(row.remarks),
    createdAt: row.created_at,
    ...batchFlags(row, options),
  };
}

function batchSummary(row) {
  return {
    totalRows: row.total_rows || 0,
    newRows: row.new_rows || 0,
    duplicateRows: row.duplicate_rows || 0,
    changedRows: row.changed_rows || 0,
    rejectedRows: row.rejected_rows || 0,
    pendingMappingRows: row.pending_mapping_rows || 0,
    postedRows: row.posted_rows || 0,
  };
}

function serializeUploadRow(row) {
  if (!row) return null;
  const normalized = parseJson(row.normalized_payload, null);
  if (normalized && typeof normalized === 'object') {
    for (const key of Object.keys(normalized)) {
      if (AMOUNT_FIELDS.has(key) && typeof normalized[key] === 'number') {
        normalized[key] = fromMinorUnits(normalized[key]);
      }
    }
  }
  return {
    uploadRowId: row.upload_row_id,
    sourceRowNumber: row.source_row_number,
    businessKey: isoOrNull(row.business_key),
    sourceRowHash: isoOrNull(row.source_row_hash),
    classification: isoOrNull(row.classification) || row.validation_status,
    validationStatus: row.validation_status,
    validationMessage: isoOrNull(row.validation_message),
    duplicateOfRecordId: isoOrNull(row.duplicate_of_record_id),
    postedRecordId: isoOrNull(row.posted_record_id),
    rawPayload: parseJson(row.raw_payload, {}),
    normalizedPayload: normalized,
    createdAt: row.created_at,
  };
}

function serializeAgent(row) {
  if (!row) return null;
  return {
    agentIdInternal: row.agent_id_internal,
    agentKey: row.agent_key,
    kodeagen: row.kodeagen,
    agentIdSource: isoOrNull(row.agent_id_source),
    namaAgent: isoOrNull(row.nama_agent),
    branchCode: isoOrNull(row.branch_code),
    branchName: isoOrNull(row.branch_name),
    statusAgent: isoOrNull(row.status_agent),
    isCurrent: bool(row.is_current),
    currentVersionNo: row.current_version_no,
    sourceRowHash: row.source_row_hash,
    uploadBatchId: isoOrNull(row.upload_batch_id),
    createdAt: row.created_at,
    createdBy: isoOrNull(row.created_by),
    updatedAt: isoOrNull(row.updated_at),
    updatedBy: isoOrNull(row.updated_by),
  };
}

function serializeAgentVersion(row) {
  if (!row) return null;
  return {
    agentVersionId: row.agent_version_id,
    agentIdInternal: row.agent_id_internal,
    versionNo: row.version_no,
    previousVersionId: isoOrNull(row.previous_version_id),
    kodeagen: row.kodeagen,
    agentIdSource: isoOrNull(row.agent_id_source),
    namaAgent: isoOrNull(row.nama_agent),
    branchCode: isoOrNull(row.branch_code),
    statusAgent: isoOrNull(row.status_agent),
    sourceRowHash: row.source_row_hash,
    uploadBatchId: isoOrNull(row.upload_batch_id),
    isCurrent: bool(row.is_current),
    changeReason: isoOrNull(row.change_reason),
    createdAt: row.created_at,
    createdBy: isoOrNull(row.created_by),
  };
}

function serializeProduction(row) {
  if (!row) return null;
  return {
    productionId: row.production_id,
    agentIdInternal: isoOrNull(row.agent_id_internal),
    agentName: isoOrNull(row.agent_name),
    sourceAgentCode: isoOrNull(row.source_agent_code),
    policyNo: row.policy_no,
    policyRiskId: isoOrNull(row.policy_risk_id),
    transactionDate: isoOrNull(row.transaction_date),
    effectiveDate: row.effective_date,
    expiryDate: isoOrNull(row.expiry_date),
    transactionType: row.transaction_type,
    productCode: isoOrNull(row.product_code),
    coverageCode: isoOrNull(row.coverage_code),
    vehicleOrRiskDescription: isoOrNull(row.vehicle_or_risk_description),
    tsi: amount(row.tsi_minor),
    premium: amount(row.premium_minor),
    currency: row.currency,
    branchCode: isoOrNull(row.branch_code),
    branchName: isoOrNull(row.branch_name),
    uwYear: isoOrNull(row.uw_year),
    businessKey: row.business_key,
    sourceRowHash: row.source_row_hash,
    uploadBatchId: isoOrNull(row.upload_batch_id),
    versionNo: row.version_no,
    previousRecordId: isoOrNull(row.previous_record_id),
    isCurrent: bool(row.is_current),
    recordStatus: row.record_status,
    createdAt: row.created_at,
    createdBy: isoOrNull(row.created_by),
    updatedAt: isoOrNull(row.updated_at),
    updatedBy: isoOrNull(row.updated_by),
    cancelledAt: isoOrNull(row.cancelled_at),
    cancelledBy: isoOrNull(row.cancelled_by),
    cancellationReason: isoOrNull(row.cancellation_reason),
  };
}

function serializeSettlement(row) {
  if (!row) return null;
  return {
    claimSettlementId: row.claim_settlement_id,
    claimId: row.claim_id,
    claimNo: isoOrNull(row.claim_no),
    settlementNo: isoOrNull(row.settlement_no),
    dateOfSettlement: row.date_of_settlement,
    grossClaim: amount(row.gross_claim_minor),
    indemnity: amount(row.indemnity_minor),
    deductible: amount(row.deductible_minor),
    salvage: amount(row.salvage_minor),
    subrogation: amount(row.subrogation_minor),
    currency: row.currency,
    sourceRowHash: row.source_row_hash,
    uploadBatchId: isoOrNull(row.upload_batch_id),
    versionNo: row.version_no,
    isCurrent: bool(row.is_current),
    recordStatus: row.record_status,
    createdAt: row.created_at,
    cancelledAt: isoOrNull(row.cancelled_at),
    cancellationReason: isoOrNull(row.cancellation_reason),
  };
}

function serializeClaim(row) {
  if (!row) return null;
  const byCurrency = Array.isArray(row.settlements_by_currency) ? row.settlements_by_currency : [];
  return {
    claimId: row.claim_id,
    claimKey: row.claim_key,
    claimNo: row.claim_no,
    policyNo: row.policy_no,
    policyRiskId: isoOrNull(row.policy_risk_id),
    agentIdInternal: isoOrNull(row.agent_id_internal),
    agentName: isoOrNull(row.agent_name),
    uwYear: isoOrNull(row.uw_year),
    branchCode: isoOrNull(row.branch_code),
    branchName: isoOrNull(row.branch_name),
    productAtLoss: isoOrNull(row.product_at_loss),
    coverageAtLoss: isoOrNull(row.coverage_at_loss),
    tsiAtLoss: amount(row.tsi_at_loss_minor),
    currency: isoOrNull(row.currency),
    causeOfLoss: isoOrNull(row.cause_of_loss),
    lossDate: isoOrNull(row.loss_date),
    claimStatus: isoOrNull(row.claim_status),
    settlementCount: row.settlement_count || 0,
    settledAmount: row.settled_amount === undefined ? 0 : amount(row.settled_amount),
    settlementCurrency: isoOrNull(row.settlement_currency),
    settlementsByCurrency: byCurrency.map((entry) => ({
      currency: entry.currency,
      grossClaim: amount(entry.gross_claim_minor),
      indemnity: amount(entry.indemnity_minor),
      deductible: amount(entry.deductible_minor),
      salvage: amount(entry.salvage_minor),
      subrogation: amount(entry.subrogation_minor),
      settlementCount: entry.settlement_count,
    })),
    createdAt: row.created_at,
    createdBy: isoOrNull(row.created_by),
  };
}

function serializeAudit(row) {
  if (!row) return null;
  return {
    auditId: row.audit_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actorId: isoOrNull(row.actor_id),
    actorName: isoOrNull(row.actor_name),
    actorRole: isoOrNull(row.actor_role),
    occurredAt: row.occurred_at,
    before: parseJson(row.before_json, null),
    after: parseJson(row.after_json, null),
    reason: isoOrNull(row.reason),
    uploadBatchId: isoOrNull(row.upload_batch_id),
  };
}

function serializeDuplicateFile(row) {
  return {
    uploadBatchId: row.upload_batch_id,
    originalFileName: row.original_file_name,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
  };
}

module.exports = {
  AMOUNT_FIELDS,
  parseJson,
  bool,
  amount,
  serializeUser,
  serializeBatch,
  batchSummary,
  serializeUploadRow,
  serializeAgent,
  serializeAgentVersion,
  serializeProduction,
  serializeSettlement,
  serializeClaim,
  serializeAudit,
  serializeDuplicateFile,
};
