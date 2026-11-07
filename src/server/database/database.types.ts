export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "private": {
          Tables: {
            "account_guard": {
                  Row: {
                    "id": boolean,"revision": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: boolean,"revision"?: number
                  }
                  Update: {
                    "id"?: boolean,"revision"?: number
                  }
                  Relationships: [

                  ]
                },"account_operations": {
                  Row: {
                    "actor_id": string,"created_at": string,"id": string,"kind": string,"payload": NonNullable<Json>,"result": Json | null,"state": string,"target_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"id": string,"kind": string,"payload": NonNullable<Json>,"result"?: Json | null,"state": string,"target_id": string,"updated_at"?: string
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"result"?: Json | null,"state"?: string,"target_id"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"accounting_operations": {
                  Row: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"request_id": string,"result": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"request_id": string,"result": NonNullable<Json>
                  }
                  Update: {
                    "actor_id"?: string,"id"?: string,"payload"?: NonNullable<Json>,"request_id"?: string,"result"?: NonNullable<Json>
                  }
                  Relationships: [

                  ]
                },"audit_events": {
                  Row: {
                    "action": string,"actor_name": string,"actor_role": string,"actor_user_id": string,"details": NonNullable<Json>,"entity_id": string,"entity_type": string,"id": string,"occurred_at": string,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_name": string,"actor_role": string,"actor_user_id": string,"details"?: NonNullable<Json>,"entity_id": string,"entity_type": string,"id"?: string,"occurred_at"?: string,"request_id": string
                  }
                  Update: {
                    "action"?: string,"actor_name"?: string,"actor_role"?: string,"actor_user_id"?: string,"details"?: NonNullable<Json>,"entity_id"?: string,"entity_type"?: string,"id"?: string,"occurred_at"?: string,"request_id"?: string
                  }
                  Relationships: [

                  ]
                },"budget_commitment_entries": {
                  Row: {
                    "actor": NonNullable<Json>,"amount": number,"approval_id": string,"created_at": string,"id": string,"kind": string,"project_id": string,"scope_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"amount": number,"approval_id": string,"created_at"?: string,"id"?: string,"kind": string,"project_id": string,"scope_id": string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"amount"?: number,"approval_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"project_id"?: string,"scope_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_commitment_entries_approval_id_fkey"
      columns: ["approval_id"]
isOneToOne: false
      referencedRelation: "po_approvals"
      referencedColumns: ["id"]
    }
                  ]
                },"comparison_archives": {
                  Row: {
                    "artifact_id": string,"completed_at": string,"file_id": string,"folder_mapping_id": string,"sha256": string,"size": number
                  }
                  ComputedFields: never
                  Insert: {
                    "artifact_id": string,"completed_at"?: string,"file_id": string,"folder_mapping_id": string,"sha256": string,"size": number
                  }
                  Update: {
                    "artifact_id"?: string,"completed_at"?: string,"file_id"?: string,"folder_mapping_id"?: string,"sha256"?: string,"size"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "comparison_archives_artifact_id_fkey"
      columns: ["artifact_id"]
isOneToOne: true
      referencedRelation: "comparison_artifacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comparison_archives_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    }
                  ]
                },"comparison_artifacts": {
                  Row: {
                    "actor": NonNullable<Json>,"attempts": NonNullable<Json>,"checkpoint": NonNullable<Json>,"dispatched_at": string | null,"folder_mapping_id": string,"format": string,"id": string,"lease": string | null,"lease_until": string | null,"message": string | null,"original_actor": NonNullable<Json>,"report_id": string,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"attempts"?: NonNullable<Json>,"checkpoint"?: NonNullable<Json>,"dispatched_at"?: string | null,"folder_mapping_id": string,"format": string,"id"?: string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor": NonNullable<Json>,"report_id": string,"state"?: string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"attempts"?: NonNullable<Json>,"checkpoint"?: NonNullable<Json>,"dispatched_at"?: string | null,"folder_mapping_id"?: string,"format"?: string,"id"?: string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor"?: NonNullable<Json>,"report_id"?: string,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comparison_artifacts_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comparison_artifacts_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "comparison_reports"
      referencedColumns: ["id"]
    }
                  ]
                },"comparison_reports": {
                  Row: {
                    "actor": NonNullable<Json>,"created_at": string,"id": string,"request_id": string,"snapshot": NonNullable<Json>,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"created_at"?: string,"id": string,"request_id": string,"snapshot": NonNullable<Json>,"version": number
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"request_id"?: string,"snapshot"?: NonNullable<Json>,"version"?: number
                  }
                  Relationships: [

                  ]
                },"demand_claims": {
                  Row: {
                    "id": string,"item_id": string,"owner_id": string,"owner_kind": string,"owner_line_id": string,"quantity": number,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id": string,"item_id": string,"owner_id": string,"owner_kind": string,"owner_line_id": string,"quantity": number,"request_id": string
                  }
                  Update: {
                    "id"?: string,"item_id"?: string,"owner_id"?: string,"owner_kind"?: string,"owner_line_id"?: string,"quantity"?: number,"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "demand_claims_item_id_request_id_fkey"
      columns: ["item_id","request_id"]
isOneToOne: false
      referencedRelation: "demand_requirements"
      referencedColumns: ["item_id","request_id"]
    }
                  ]
                },"demand_events": {
                  Row: {
                    "actor_id": string,"actor_name": string,"actor_role": string,"after_state": NonNullable<Json>,"before_state": NonNullable<Json>,"occurred_at": string,"operation_id": string,"reason": string,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"actor_name": string,"actor_role": string,"after_state": NonNullable<Json>,"before_state": NonNullable<Json>,"occurred_at"?: string,"operation_id": string,"reason": string,"request_id": string
                  }
                  Update: {
                    "actor_id"?: string,"actor_name"?: string,"actor_role"?: string,"after_state"?: NonNullable<Json>,"before_state"?: NonNullable<Json>,"occurred_at"?: string,"operation_id"?: string,"reason"?: string,"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "demand_events_operation_id_fkey"
      columns: ["operation_id"]
isOneToOne: true
      referencedRelation: "demand_operations"
      referencedColumns: ["id"]
    }
                  ]
                },"demand_heads": {
                  Row: {
                    "request_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "request_id": string,"version"?: number
                  }
                  Update: {
                    "request_id"?: string,"version"?: number
                  }
                  Relationships: [

                  ]
                },"demand_operations": {
                  Row: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"request_id": string,"result": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"request_id": string,"result": NonNullable<Json>
                  }
                  Update: {
                    "actor_id"?: string,"id"?: string,"payload"?: NonNullable<Json>,"request_id"?: string,"result"?: NonNullable<Json>
                  }
                  Relationships: [

                  ]
                },"demand_requirements": {
                  Row: {
                    "archive_id": string,"item_id": string,"quantity": number,"request_id": string,"unit": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archive_id": string,"item_id": string,"quantity": number,"request_id": string,"unit": string
                  }
                  Update: {
                    "archive_id"?: string,"item_id"?: string,"quantity"?: number,"request_id"?: string,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "demand_requirements_archive_id_fkey"
      columns: ["archive_id"]
isOneToOne: false
      referencedRelation: "mrf_archive_snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "demand_requirements_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "demand_heads"
      referencedColumns: ["request_id"]
    }
                  ]
                },"document_counters": {
                  Row: {
                    "last_value": number,"project_id": string,"series": string
                  }
                  ComputedFields: never
                  Insert: {
                    "last_value": number,"project_id": string,"series": string
                  }
                  Update: {
                    "last_value"?: number,"project_id"?: string,"series"?: string
                  }
                  Relationships: [

                  ]
                },"document_folder_owners": {
                  Row: {
                    "folder_id": string,"project_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "folder_id": string,"project_id": string
                  }
                  Update: {
                    "folder_id"?: string,"project_id"?: string
                  }
                  Relationships: [

                  ]
                },"document_jobs": {
                  Row: {
                    "actor": NonNullable<Json>,"attempts": number,"checkpoint": NonNullable<Json>,"created_at": string,"dispatch_after": string,"id": string,"kind": string,"lease": string | null,"lease_until": string | null,"message": string | null,"original_actor": NonNullable<Json>,"payload": NonNullable<Json>,"project_id": string,"request_id": string | null,"resource_id": string | null,"state": string,"updated_at": string,"workflow_run_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"attempts"?: number,"checkpoint"?: NonNullable<Json>,"created_at"?: string,"dispatch_after"?: string,"id"?: string,"kind": string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor": NonNullable<Json>,"payload"?: NonNullable<Json>,"project_id": string,"request_id"?: string | null,"resource_id"?: string | null,"state"?: string,"updated_at"?: string,"workflow_run_id"?: string | null
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"attempts"?: number,"checkpoint"?: NonNullable<Json>,"created_at"?: string,"dispatch_after"?: string,"id"?: string,"kind"?: string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor"?: NonNullable<Json>,"payload"?: NonNullable<Json>,"project_id"?: string,"request_id"?: string | null,"resource_id"?: string | null,"state"?: string,"updated_at"?: string,"workflow_run_id"?: string | null
                  }
                  Relationships: [

                  ]
                },"document_operations": {
                  Row: {
                    "actor_id": string,"created_at": string,"id": string,"payload": NonNullable<Json>,"result": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"id": string,"payload": NonNullable<Json>,"result": NonNullable<Json>
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"id"?: string,"payload"?: NonNullable<Json>,"result"?: NonNullable<Json>
                  }
                  Relationships: [

                  ]
                },"document_uploads": {
                  Row: {
                    "actor": NonNullable<Json>,"base_revision": number,"created_at": string,"drive_file_id": string | null,"encrypted_session": string | null,"expires_at": string,"folder_mapping_id": string,"id": string,"lease": string | null,"lease_until": string | null,"name": string,"offset_bytes": number,"original_actor": NonNullable<Json>,"request_id": string,"sha256": string,"size": number,"state": string,"uploader_id": string,"uploader_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"base_revision": number,"created_at"?: string,"drive_file_id"?: string | null,"encrypted_session"?: string | null,"expires_at"?: string,"folder_mapping_id": string,"id": string,"lease"?: string | null,"lease_until"?: string | null,"name": string,"offset_bytes"?: number,"original_actor": NonNullable<Json>,"request_id": string,"sha256": string,"size": number,"state"?: string,"uploader_id": string,"uploader_name": string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"base_revision"?: number,"created_at"?: string,"drive_file_id"?: string | null,"encrypted_session"?: string | null,"expires_at"?: string,"folder_mapping_id"?: string,"id"?: string,"lease"?: string | null,"lease_until"?: string | null,"name"?: string,"offset_bytes"?: number,"original_actor"?: NonNullable<Json>,"request_id"?: string,"sha256"?: string,"size"?: number,"state"?: string,"uploader_id"?: string,"uploader_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_uploads_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    }
                  ]
                },"issuance_operations": {
                  Row: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"po_id": string,"result": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"po_id": string,"result": NonNullable<Json>
                  }
                  Update: {
                    "actor_id"?: string,"id"?: string,"payload"?: NonNullable<Json>,"po_id"?: string,"result"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "issuance_operations_po_id_fkey"
      columns: ["po_id"]
isOneToOne: false
      referencedRelation: "purchasing_records"
      referencedColumns: ["id"]
    }
                  ]
                },"mrf_archive_files": {
                  Row: {
                    "id": string,"kind": string,"size": number,"snapshot_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"kind": string,"size": number,"snapshot_id": string
                  }
                  Update: {
                    "id"?: string,"kind"?: string,"size"?: number,"snapshot_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mrf_archive_files_snapshot_id_fkey"
      columns: ["snapshot_id"]
isOneToOne: false
      referencedRelation: "mrf_archive_snapshots"
      referencedColumns: ["id"]
    }
                  ]
                },"mrf_archive_snapshots": {
                  Row: {
                    "approved_at": string,"approved_by": string,"approved_name": string,"attachment_revision": number,"created_at": string,"id": string,"request_id": string,"request_version": number,"snapshot": NonNullable<Json>,"source_document": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at": string,"approved_by": string,"approved_name": string,"attachment_revision": number,"created_at"?: string,"id": string,"request_id": string,"request_version": number,"snapshot": NonNullable<Json>,"source_document": string,"version": number
                  }
                  Update: {
                    "approved_at"?: string,"approved_by"?: string,"approved_name"?: string,"attachment_revision"?: number,"created_at"?: string,"id"?: string,"request_id"?: string,"request_version"?: number,"snapshot"?: NonNullable<Json>,"source_document"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "mrf_archive_snapshots_source_document_fkey"
      columns: ["source_document"]
isOneToOne: false
      referencedRelation: "request_documents"
      referencedColumns: ["id"]
    }
                  ]
                },"mrf_archives": {
                  Row: {
                    "completed_at": string,"folder_mapping_id": string,"form_file_id": string,"form_sha256": string,"snapshot_id": string,"supporting_file_id": string,"supporting_sha256": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string,"folder_mapping_id": string,"form_file_id": string,"form_sha256": string,"snapshot_id": string,"supporting_file_id": string,"supporting_sha256": string
                  }
                  Update: {
                    "completed_at"?: string,"folder_mapping_id"?: string,"form_file_id"?: string,"form_sha256"?: string,"snapshot_id"?: string,"supporting_file_id"?: string,"supporting_sha256"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mrf_archives_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mrf_archives_snapshot_id_fkey"
      columns: ["snapshot_id"]
isOneToOne: true
      referencedRelation: "mrf_archive_snapshots"
      referencedColumns: ["id"]
    }
                  ]
                },"mrf_downstream_references": {
                  Row: {
                    "kind": string,"record_id": string,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"record_id": string,"request_id": string
                  }
                  Update: {
                    "kind"?: string,"record_id"?: string,"request_id"?: string
                  }
                  Relationships: [

                  ]
                },"mrf_review_events": {
                  Row: {
                    "action": string,"actor_id": string,"actor_name": string,"actor_role": string,"created_at": string,"id": string,"reason": string,"request_id": string,"submission_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"actor_name": string,"actor_role": string,"created_at"?: string,"id"?: string,"reason"?: string,"request_id": string,"submission_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"actor_name"?: string,"actor_role"?: string,"created_at"?: string,"id"?: string,"reason"?: string,"request_id"?: string,"submission_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "mrf_review_events_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "mrf_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"mrf_submissions": {
                  Row: {
                    "actor_id": string,"actor_name": string,"attachment_revision": number,"created_at": string,"id": string,"request_id": string,"request_version": number,"snapshot": NonNullable<Json>,"source_document": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"actor_name": string,"attachment_revision": number,"created_at"?: string,"id": string,"request_id": string,"request_version": number,"snapshot": NonNullable<Json>,"source_document": string
                  }
                  Update: {
                    "actor_id"?: string,"actor_name"?: string,"attachment_revision"?: number,"created_at"?: string,"id"?: string,"request_id"?: string,"request_version"?: number,"snapshot"?: NonNullable<Json>,"source_document"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mrf_submissions_source_document_fkey"
      columns: ["source_document"]
isOneToOne: false
      referencedRelation: "request_documents"
      referencedColumns: ["id"]
    }
                  ]
                },"po_approvals": {
                  Row: {
                    "actor": NonNullable<Json>,"approved_at": string,"id": string,"po_id": string,"project_id": string,"request_id": string,"scope_id": string,"snapshot": NonNullable<Json>,"submission_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"approved_at"?: string,"id"?: string,"po_id": string,"project_id": string,"request_id": string,"scope_id": string,"snapshot": NonNullable<Json>,"submission_id": string,"version": number
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"approved_at"?: string,"id"?: string,"po_id"?: string,"project_id"?: string,"request_id"?: string,"scope_id"?: string,"snapshot"?: NonNullable<Json>,"submission_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_approvals_po_id_fkey"
      columns: ["po_id"]
isOneToOne: false
      referencedRelation: "purchasing_records"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_approvals_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "po_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"po_archive_jobs": {
                  Row: {
                    "actor": NonNullable<Json>,"approval_id": string,"attempts": NonNullable<Json>,"checkpoint": NonNullable<Json>,"dispatched_at": string | null,"folder_mapping_id": string,"id": string,"lease": string | null,"lease_until": string | null,"message": string | null,"original_actor": NonNullable<Json>,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"approval_id": string,"attempts"?: NonNullable<Json>,"checkpoint"?: NonNullable<Json>,"dispatched_at"?: string | null,"folder_mapping_id": string,"id"?: string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor": NonNullable<Json>,"state"?: string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"approval_id"?: string,"attempts"?: NonNullable<Json>,"checkpoint"?: NonNullable<Json>,"dispatched_at"?: string | null,"folder_mapping_id"?: string,"id"?: string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor"?: NonNullable<Json>,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_archive_jobs_approval_id_fkey"
      columns: ["approval_id"]
isOneToOne: true
      referencedRelation: "po_approvals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_archive_jobs_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    }
                  ]
                },"po_archives": {
                  Row: {
                    "completed_at": string,"file_id": string,"folder_mapping_id": string,"job_id": string,"sha256": string,"size": number
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string,"file_id": string,"folder_mapping_id": string,"job_id": string,"sha256": string,"size": number
                  }
                  Update: {
                    "completed_at"?: string,"file_id"?: string,"folder_mapping_id"?: string,"job_id"?: string,"sha256"?: string,"size"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_archives_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_archives_job_id_fkey"
      columns: ["job_id"]
isOneToOne: true
      referencedRelation: "po_archive_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"po_issuance_corrections": {
                  Row: {
                    "actor": NonNullable<Json>,"before_details": NonNullable<Json>,"details": NonNullable<Json>,"id": string,"issuance_id": string,"reason": string,"recorded_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"before_details": NonNullable<Json>,"details": NonNullable<Json>,"id"?: string,"issuance_id": string,"reason": string,"recorded_at"?: string,"version": number
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"before_details"?: NonNullable<Json>,"details"?: NonNullable<Json>,"id"?: string,"issuance_id"?: string,"reason"?: string,"recorded_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_issuance_corrections_issuance_id_fkey"
      columns: ["issuance_id"]
isOneToOne: false
      referencedRelation: "po_issuances"
      referencedColumns: ["id"]
    }
                  ]
                },"po_issuances": {
                  Row: {
                    "actor": NonNullable<Json>,"blockers": NonNullable<Json>,"details": NonNullable<Json>,"id": string,"po_id": string,"preparation_id": string,"recorded_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"blockers": NonNullable<Json>,"details": NonNullable<Json>,"id"?: string,"po_id": string,"preparation_id": string,"recorded_at"?: string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"blockers"?: NonNullable<Json>,"details"?: NonNullable<Json>,"id"?: string,"po_id"?: string,"preparation_id"?: string,"recorded_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_issuances_po_id_fkey"
      columns: ["po_id"]
isOneToOne: true
      referencedRelation: "purchasing_records"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_issuances_preparation_id_fkey"
      columns: ["preparation_id"]
isOneToOne: true
      referencedRelation: "po_send_preparations"
      referencedColumns: ["id"]
    }
                  ]
                },"po_preparers": {
                  Row: {
                    "actor": NonNullable<Json>,"actor_id": string,"first_prepared_at": string,"po_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"actor_id": string,"first_prepared_at"?: string,"po_id": string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"actor_id"?: string,"first_prepared_at"?: string,"po_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_preparers_po_id_fkey"
      columns: ["po_id"]
isOneToOne: false
      referencedRelation: "purchasing_records"
      referencedColumns: ["id"]
    }
                  ]
                },"po_review_events": {
                  Row: {
                    "action": string,"actor": NonNullable<Json>,"approval_id": string | null,"created_at": string,"id": string,"mrf_archive_id": string | null,"po_id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor": NonNullable<Json>,"approval_id"?: string | null,"created_at"?: string,"id"?: string,"mrf_archive_id"?: string | null,"po_id": string,"reason": string
                  }
                  Update: {
                    "action"?: string,"actor"?: NonNullable<Json>,"approval_id"?: string | null,"created_at"?: string,"id"?: string,"mrf_archive_id"?: string | null,"po_id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_review_events_approval_id_fkey"
      columns: ["approval_id"]
isOneToOne: false
      referencedRelation: "po_approvals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_review_events_mrf_archive_id_fkey"
      columns: ["mrf_archive_id"]
isOneToOne: false
      referencedRelation: "mrf_archive_snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_review_events_po_id_fkey"
      columns: ["po_id"]
isOneToOne: false
      referencedRelation: "purchasing_records"
      referencedColumns: ["id"]
    }
                  ]
                },"po_send_cancellations": {
                  Row: {
                    "actor": NonNullable<Json>,"preparation_id": string,"reason": string,"recorded_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"preparation_id": string,"reason": string,"recorded_at"?: string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"preparation_id"?: string,"reason"?: string,"recorded_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_send_cancellations_preparation_id_fkey"
      columns: ["preparation_id"]
isOneToOne: true
      referencedRelation: "po_send_preparations"
      referencedColumns: ["id"]
    }
                  ]
                },"po_send_preparations": {
                  Row: {
                    "actor": NonNullable<Json>,"approval_id": string,"files": NonNullable<Json>,"id": string,"mrf_archive_id": string,"po_archive_id": string,"po_id": string,"prepared_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"approval_id": string,"files": NonNullable<Json>,"id"?: string,"mrf_archive_id": string,"po_archive_id": string,"po_id": string,"prepared_at"?: string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"approval_id"?: string,"files"?: NonNullable<Json>,"id"?: string,"mrf_archive_id"?: string,"po_archive_id"?: string,"po_id"?: string,"prepared_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_send_preparations_approval_id_fkey"
      columns: ["approval_id"]
isOneToOne: false
      referencedRelation: "po_approvals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_send_preparations_mrf_archive_id_fkey"
      columns: ["mrf_archive_id"]
isOneToOne: false
      referencedRelation: "mrf_archive_snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_send_preparations_po_archive_id_fkey"
      columns: ["po_archive_id"]
isOneToOne: false
      referencedRelation: "po_archives"
      referencedColumns: ["job_id"]
    },{
      foreignKeyName: "po_send_preparations_po_id_fkey"
      columns: ["po_id"]
isOneToOne: false
      referencedRelation: "purchasing_records"
      referencedColumns: ["id"]
    }
                  ]
                },"po_submissions": {
                  Row: {
                    "actor": NonNullable<Json>,"actor_id": string,"created_at": string,"id": string,"mrf_archive_id": string,"po_id": string,"request_id": string,"snapshot": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"actor_id": string,"created_at"?: string,"id"?: string,"mrf_archive_id": string,"po_id": string,"request_id": string,"snapshot": NonNullable<Json>
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"actor_id"?: string,"created_at"?: string,"id"?: string,"mrf_archive_id"?: string,"po_id"?: string,"request_id"?: string,"snapshot"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "po_submissions_mrf_archive_id_fkey"
      columns: ["mrf_archive_id"]
isOneToOne: false
      referencedRelation: "mrf_archive_snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "po_submissions_po_id_fkey"
      columns: ["po_id"]
isOneToOne: false
      referencedRelation: "purchasing_records"
      referencedColumns: ["id"]
    }
                  ]
                },"project_document_folders": {
                  Row: {
                    "created_at": string,"current": boolean,"folder_id": string,"id": string,"name": string,"project_id": string,"root_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"current"?: boolean,"folder_id": string,"id"?: string,"name": string,"project_id": string,"root_id": string
                  }
                  Update: {
                    "created_at"?: string,"current"?: boolean,"folder_id"?: string,"id"?: string,"name"?: string,"project_id"?: string,"root_id"?: string
                  }
                  Relationships: [

                  ]
                },"project_operations": {
                  Row: {
                    "actor_id": string,"created_at": string,"id": string,"payload": NonNullable<Json>,"project_id": string,"result": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"id": string,"payload": NonNullable<Json>,"project_id": string,"result"?: Json | null
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"id"?: string,"payload"?: NonNullable<Json>,"project_id"?: string,"result"?: Json | null
                  }
                  Relationships: [

                  ]
                },"purchasing_claims": {
                  Row: {
                    "id": string,"item_id": string,"line_id": string,"record_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id": string,"item_id": string,"line_id": string,"record_id": string
                  }
                  Update: {
                    "id"?: string,"item_id"?: string,"line_id"?: string,"record_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchasing_claims_id_fkey"
      columns: ["id"]
isOneToOne: true
      referencedRelation: "demand_claims"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchasing_claims_record_id_fkey"
      columns: ["record_id"]
isOneToOne: false
      referencedRelation: "purchasing_records"
      referencedColumns: ["id"]
    }
                  ]
                },"purchasing_heads": {
                  Row: {
                    "request_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "request_id": string,"version"?: number
                  }
                  Update: {
                    "request_id"?: string,"version"?: number
                  }
                  Relationships: [

                  ]
                },"purchasing_operations": {
                  Row: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"request_id": string,"result": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"request_id": string,"result": NonNullable<Json>
                  }
                  Update: {
                    "actor_id"?: string,"id"?: string,"payload"?: NonNullable<Json>,"request_id"?: string,"result"?: NonNullable<Json>
                  }
                  Relationships: [

                  ]
                },"purchasing_records": {
                  Row: {
                    "approval_id": string | null,"body": NonNullable<Json>,"calculation": Json | null,"checked": Json | null,"id": string,"kind": string,"po_status": string,"project_id": string,"quote_id": string,"ref": string | null,"request_id": string,"revision_id": string,"state": string,"submission_id": string | null,"supplier_id": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_id"?: string | null,"body": NonNullable<Json>,"calculation"?: Json | null,"checked"?: Json | null,"id": string,"kind": string,"po_status"?: string,"project_id": string,"quote_id": string,"ref"?: string | null,"request_id": string,"revision_id": string,"state"?: string,"submission_id"?: string | null,"supplier_id": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "approval_id"?: string | null,"body"?: NonNullable<Json>,"calculation"?: Json | null,"checked"?: Json | null,"id"?: string,"kind"?: string,"po_status"?: string,"project_id"?: string,"quote_id"?: string,"ref"?: string | null,"request_id"?: string,"revision_id"?: string,"state"?: string,"submission_id"?: string | null,"supplier_id"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchasing_records_approval_id_fkey"
      columns: ["approval_id"]
isOneToOne: false
      referencedRelation: "po_approvals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchasing_records_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotation_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchasing_records_revision_id_fkey"
      columns: ["revision_id"]
isOneToOne: false
      referencedRelation: "quotation_revisions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchasing_records_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "po_submissions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchasing_records_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_archive_jobs": {
                  Row: {
                    "actor": NonNullable<Json>,"attempts": NonNullable<Json>,"checkpoint": NonNullable<Json>,"dispatched_at": string | null,"folder_mapping_id": string,"id": string,"lease": string | null,"lease_until": string | null,"message": string | null,"original_actor": NonNullable<Json>,"revision_id": string,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"attempts"?: NonNullable<Json>,"checkpoint"?: NonNullable<Json>,"dispatched_at"?: string | null,"folder_mapping_id": string,"id"?: string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor": NonNullable<Json>,"revision_id": string,"state"?: string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"attempts"?: NonNullable<Json>,"checkpoint"?: NonNullable<Json>,"dispatched_at"?: string | null,"folder_mapping_id"?: string,"id"?: string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor"?: NonNullable<Json>,"revision_id"?: string,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_archive_jobs_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_archive_jobs_revision_id_fkey"
      columns: ["revision_id"]
isOneToOne: true
      referencedRelation: "quotation_revisions"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_archives": {
                  Row: {
                    "completed_at": string,"file_id": string,"folder_mapping_id": string,"manifest": NonNullable<Json>,"revision_id": string,"sha256": string,"size": number
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string,"file_id": string,"folder_mapping_id": string,"manifest": NonNullable<Json>,"revision_id": string,"sha256": string,"size": number
                  }
                  Update: {
                    "completed_at"?: string,"file_id"?: string,"folder_mapping_id"?: string,"manifest"?: NonNullable<Json>,"revision_id"?: string,"sha256"?: string,"size"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_archives_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_archives_revision_id_fkey"
      columns: ["revision_id"]
isOneToOne: true
      referencedRelation: "quotation_revisions"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_drafts": {
                  Row: {
                    "body": NonNullable<Json>,"checked": Json | null,"content_version": number,"copied_from_revision": string | null,"created_at": string,"creator_id": string,"creator_name": string,"current_files": (string)[],"family_id": string,"file_version": number,"id": string,"matches": NonNullable<Json>,"request_id": string,"state": string,"supplier_id": string,"version": number,"quotation_ready_files": boolean | null
                  }
                  ComputedFields: "quotation_ready_files"
                  Insert: {
                    "body": NonNullable<Json>,"checked"?: Json | null,"content_version"?: number,"copied_from_revision"?: string | null,"created_at"?: string,"creator_id": string,"creator_name": string,"current_files"?: (string)[],"family_id": string,"file_version"?: number,"id": string,"matches"?: NonNullable<Json>,"request_id": string,"state"?: string,"supplier_id": string,"version"?: number
                  }
                  Update: {
                    "body"?: NonNullable<Json>,"checked"?: Json | null,"content_version"?: number,"copied_from_revision"?: string | null,"created_at"?: string,"creator_id"?: string,"creator_name"?: string,"current_files"?: (string)[],"family_id"?: string,"file_version"?: number,"id"?: string,"matches"?: NonNullable<Json>,"request_id"?: string,"state"?: string,"supplier_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_drafts_copied_from_revision_fkey"
      columns: ["copied_from_revision"]
isOneToOne: false
      referencedRelation: "quotation_revisions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_drafts_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "quotation_families"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_drafts_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_families": {
                  Row: {
                    "current_quote_id": string | null,"id": string,"pending_quote_id": string | null,"request_id": string,"supplier_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "current_quote_id"?: string | null,"id"?: string,"pending_quote_id"?: string | null,"request_id": string,"supplier_id": string,"version"?: number
                  }
                  Update: {
                    "current_quote_id"?: string | null,"id"?: string,"pending_quote_id"?: string | null,"request_id"?: string,"supplier_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_families_current_quote_id_fkey"
      columns: ["current_quote_id"]
isOneToOne: false
      referencedRelation: "quotation_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_families_pending_quote_id_fkey"
      columns: ["pending_quote_id"]
isOneToOne: false
      referencedRelation: "quotation_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_families_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_files": {
                  Row: {
                    "created_at": string,"drive_file_id": string | null,"encrypted_session": string | null,"expires_at": string,"folder_mapping_id": string,"group_id": string,"id": string,"lease": string | null,"lease_until": string | null,"mime": string,"name": string,"offset_bytes": number,"quote_id": string,"retained": boolean,"sha256": string,"size": number,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"drive_file_id"?: string | null,"encrypted_session"?: string | null,"expires_at"?: string,"folder_mapping_id": string,"group_id": string,"id": string,"lease"?: string | null,"lease_until"?: string | null,"mime": string,"name": string,"offset_bytes"?: number,"quote_id": string,"retained"?: boolean,"sha256": string,"size": number,"state"?: string
                  }
                  Update: {
                    "created_at"?: string,"drive_file_id"?: string | null,"encrypted_session"?: string | null,"expires_at"?: string,"folder_mapping_id"?: string,"group_id"?: string,"id"?: string,"lease"?: string | null,"lease_until"?: string | null,"mime"?: string,"name"?: string,"offset_bytes"?: number,"quote_id"?: string,"retained"?: boolean,"sha256"?: string,"size"?: number,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_files_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_files_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "quotation_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_files_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotation_drafts"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_financial_reviews": {
                  Row: {
                    "calculation": NonNullable<Json>,"checked": Json | null,"file_version": number,"quote_id": string,"review": NonNullable<Json>,"source_version": number,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "calculation": NonNullable<Json>,"checked"?: Json | null,"file_version": number,"quote_id": string,"review": NonNullable<Json>,"source_version": number,"version"?: number
                  }
                  Update: {
                    "calculation"?: NonNullable<Json>,"checked"?: Json | null,"file_version"?: number,"quote_id"?: string,"review"?: NonNullable<Json>,"source_version"?: number,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_financial_reviews_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: true
      referencedRelation: "quotation_drafts"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_groups": {
                  Row: {
                    "actor": NonNullable<Json>,"created_at": string,"expected_version": number,"files": (string)[],"id": string,"original_actor": NonNullable<Json>,"quote_id": string,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"created_at"?: string,"expected_version": number,"files"?: (string)[],"id": string,"original_actor": NonNullable<Json>,"quote_id": string,"state"?: string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"created_at"?: string,"expected_version"?: number,"files"?: (string)[],"id"?: string,"original_actor"?: NonNullable<Json>,"quote_id"?: string,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_groups_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotation_drafts"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_jobs": {
                  Row: {
                    "actor": NonNullable<Json>,"attempts": number,"checkpoint": NonNullable<Json>,"dispatched_at": string | null,"file_id": string,"id": string,"kind": string,"lease": string | null,"lease_until": string | null,"message": string | null,"original_actor": NonNullable<Json>,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"attempts"?: number,"checkpoint"?: NonNullable<Json>,"dispatched_at"?: string | null,"file_id": string,"id"?: string,"kind": string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor": NonNullable<Json>,"state"?: string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"attempts"?: number,"checkpoint"?: NonNullable<Json>,"dispatched_at"?: string | null,"file_id"?: string,"id"?: string,"kind"?: string,"lease"?: string | null,"lease_until"?: string | null,"message"?: string | null,"original_actor"?: NonNullable<Json>,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_jobs_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "quotation_files"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_operations": {
                  Row: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"result": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"result"?: Json | null
                  }
                  Update: {
                    "actor_id"?: string,"id"?: string,"payload"?: NonNullable<Json>,"result"?: Json | null
                  }
                  Relationships: [

                  ]
                },"quotation_revision_events": {
                  Row: {
                    "actor": NonNullable<Json>,"created_at": string,"id": string,"kind": string,"mrf_archive_id": string | null,"reason": string,"revision_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": NonNullable<Json>,"created_at"?: string,"id"?: string,"kind": string,"mrf_archive_id"?: string | null,"reason"?: string,"revision_id": string
                  }
                  Update: {
                    "actor"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"kind"?: string,"mrf_archive_id"?: string | null,"reason"?: string,"revision_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_revision_events_mrf_archive_id_fkey"
      columns: ["mrf_archive_id"]
isOneToOne: false
      referencedRelation: "mrf_archive_snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_revision_events_revision_id_fkey"
      columns: ["revision_id"]
isOneToOne: false
      referencedRelation: "quotation_revisions"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_revision_files": {
                  Row: {
                    "file_id": string,"metadata": NonNullable<Json>,"revision_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "file_id": string,"metadata": NonNullable<Json>,"revision_id": string
                  }
                  Update: {
                    "file_id"?: string,"metadata"?: NonNullable<Json>,"revision_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_revision_files_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "quotation_files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_revision_files_revision_id_fkey"
      columns: ["revision_id"]
isOneToOne: false
      referencedRelation: "quotation_revisions"
      referencedColumns: ["id"]
    }
                  ]
                },"quotation_revisions": {
                  Row: {
                    "family_id": string,"file_version": number,"finalized_at": string,"finalized_by": string,"finalized_name": string,"financial_version": number,"id": string,"mrf_archive_id": string,"number": number,"quote_id": string,"snapshot": NonNullable<Json>,"source_version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "family_id": string,"file_version": number,"finalized_at"?: string,"finalized_by": string,"finalized_name": string,"financial_version": number,"id"?: string,"mrf_archive_id": string,"number": number,"quote_id": string,"snapshot": NonNullable<Json>,"source_version": number
                  }
                  Update: {
                    "family_id"?: string,"file_version"?: number,"finalized_at"?: string,"finalized_by"?: string,"finalized_name"?: string,"financial_version"?: number,"id"?: string,"mrf_archive_id"?: string,"number"?: number,"quote_id"?: string,"snapshot"?: NonNullable<Json>,"source_version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotation_revisions_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "quotation_families"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_revisions_mrf_archive_id_fkey"
      columns: ["mrf_archive_id"]
isOneToOne: false
      referencedRelation: "mrf_archive_snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotation_revisions_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: true
      referencedRelation: "quotation_drafts"
      referencedColumns: ["id"]
    }
                  ]
                },"request_document_state": {
                  Row: {
                    "current_document": string | null,"request_id": string,"revision": number
                  }
                  ComputedFields: never
                  Insert: {
                    "current_document"?: string | null,"request_id": string,"revision"?: number
                  }
                  Update: {
                    "current_document"?: string | null,"request_id"?: string,"revision"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "request_document_state_current_document_fkey"
      columns: ["current_document"]
isOneToOne: false
      referencedRelation: "request_documents"
      referencedColumns: ["id"]
    }
                  ]
                },"request_documents": {
                  Row: {
                    "created_at": string,"drive_file_id": string,"folder_mapping_id": string,"id": string,"name": string,"request_id": string,"sha256": string,"size": number,"trashed_at": string | null,"uploader_id": string,"uploader_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"drive_file_id": string,"folder_mapping_id": string,"id": string,"name": string,"request_id": string,"sha256": string,"size": number,"trashed_at"?: string | null,"uploader_id": string,"uploader_name": string
                  }
                  Update: {
                    "created_at"?: string,"drive_file_id"?: string,"folder_mapping_id"?: string,"id"?: string,"name"?: string,"request_id"?: string,"sha256"?: string,"size"?: number,"trashed_at"?: string | null,"uploader_id"?: string,"uploader_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "request_documents_folder_mapping_id_fkey"
      columns: ["folder_mapping_id"]
isOneToOne: false
      referencedRelation: "project_document_folders"
      referencedColumns: ["id"]
    }
                  ]
                },"request_operations": {
                  Row: {
                    "actor_id": string,"created_at": string,"id": string,"payload": NonNullable<Json>,"request_id": string,"result": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"id": string,"payload": NonNullable<Json>,"request_id": string,"result"?: Json | null
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"id"?: string,"payload"?: NonNullable<Json>,"request_id"?: string,"result"?: Json | null
                  }
                  Relationships: [

                  ]
                },"session_bindings": {
                  Row: {
                    "access_revision": number,"bound_at": string,"session_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_revision": number,"bound_at"?: string,"session_id": string,"user_id": string
                  }
                  Update: {
                    "access_revision"?: number,"bound_at"?: string,"session_id"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"stock_accounts": {
                  Row: {
                    "description": string,"description_key": string | null,"id": string,"project_id": string,"unit": string,"unit_key": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "description": string,"description_key"?: never,"id": string,"project_id": string,"unit": string,"unit_key"?: never,"version"?: number
                  }
                  Update: {
                    "description"?: string,"description_key"?: never,"id"?: string,"project_id"?: string,"unit"?: string,"unit_key"?: never,"version"?: number
                  }
                  Relationships: [

                  ]
                },"stock_events": {
                  Row: {
                    "actor_id": string,"actor_name": string,"actor_role": string,"after_state": NonNullable<Json>,"before_state": NonNullable<Json>,"occurred_at": string,"operation_id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"actor_name": string,"actor_role": string,"after_state": NonNullable<Json>,"before_state": NonNullable<Json>,"occurred_at"?: string,"operation_id": string,"reason": string
                  }
                  Update: {
                    "actor_id"?: string,"actor_name"?: string,"actor_role"?: string,"after_state"?: NonNullable<Json>,"before_state"?: NonNullable<Json>,"occurred_at"?: string,"operation_id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_events_operation_id_fkey"
      columns: ["operation_id"]
isOneToOne: true
      referencedRelation: "stock_operations"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_movements": {
                  Row: {
                    "account_id": string,"id": string,"operation_id": string,"posted_at": string,"posting_kind": string,"quantity": number,"reservation_id": string | null,"source_id": string,"source_kind": string,"source_line_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"id"?: string,"operation_id": string,"posted_at"?: string,"posting_kind": string,"quantity": number,"reservation_id"?: string | null,"source_id": string,"source_kind": string,"source_line_id": string
                  }
                  Update: {
                    "account_id"?: string,"id"?: string,"operation_id"?: string,"posted_at"?: string,"posting_kind"?: string,"quantity"?: number,"reservation_id"?: string | null,"source_id"?: string,"source_kind"?: string,"source_line_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "stock_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_operation_id_fkey"
      columns: ["operation_id"]
isOneToOne: false
      referencedRelation: "stock_operations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_reservation_id_fkey"
      columns: ["reservation_id"]
isOneToOne: false
      referencedRelation: "stock_reservations"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_operations": {
                  Row: {
                    "actor_id": string,"effect": NonNullable<Json>,"id": string,"payload": NonNullable<Json>,"result": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"effect": NonNullable<Json>,"id": string,"payload": NonNullable<Json>,"result": NonNullable<Json>
                  }
                  Update: {
                    "actor_id"?: string,"effect"?: NonNullable<Json>,"id"?: string,"payload"?: NonNullable<Json>,"result"?: NonNullable<Json>
                  }
                  Relationships: [

                  ]
                },"stock_reservations": {
                  Row: {
                    "account_id": string,"id": string,"owner_id": string,"owner_kind": string,"owner_line_id": string,"quantity": number
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"id": string,"owner_id": string,"owner_kind": string,"owner_line_id": string,"quantity": number
                  }
                  Update: {
                    "account_id"?: string,"id"?: string,"owner_id"?: string,"owner_kind"?: string,"owner_line_id"?: string,"quantity"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_reservations_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "stock_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"supplier_operations": {
                  Row: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"result": Json | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"id": string,"payload": NonNullable<Json>,"result"?: Json | null,"supplier_id": string
                  }
                  Update: {
                    "actor_id"?: string,"id"?: string,"payload"?: NonNullable<Json>,"result"?: Json | null,"supplier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_operations_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "id": string,"is_active": boolean,"name_key": string,"profile": NonNullable<Json>,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"is_active"?: boolean,"name_key": string,"profile": NonNullable<Json>,"version"?: number
                  }
                  Update: {
                    "id"?: string,"is_active"?: boolean,"name_key"?: string,"profile"?: NonNullable<Json>,"version"?: number
                  }
                  Relationships: [

                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "account_actor":
{ Args: { "actor": Json,"writing"?: boolean }; Returns: string
                           },
"account_audit":
{ Args: { "actor_id": string,"details"?: Json,"event": string,"operation": string,"target": string }; Returns: undefined
                           },
"account_complete":
{ Args: { "actor": Json,"operation": string }; Returns: Json
                           },
"account_message":
{ Args: { "actor": Json,"expected_version": string,"message_kind": string,"operation": string,"outcome"?: string,"target": string }; Returns: Json
                           },
"account_reserve":
{ Args: { "actor": Json,"draft": Json,"operation": string }; Returns: Json
                           },
"account_save":
{ Args: { "actor": Json,"draft": Json,"expected_version": string,"operation": string,"target": string }; Returns: Json
                           },
"account_validate":
{ Args: { "draft": Json }; Returns: undefined
                           },
"account_view":
{ Args: { "target": string }; Returns: Json
                           },
"accounting_command":
{ Args: { "actor": Json,"command": Json,"snapshot"?: Json }; Returns: Json
                           },
"accounts_directory":
{ Args: { "actor": Json }; Returns: Json
                           },
"approved_po_blockers":
{ Args: { "target": string }; Returns: Json
                           },
"bind_session":
{ Args: { "expected_credential": string,"expected_revision": string,"target_session": string,"target_user": string }; Returns: boolean
                           },
"bootstrap_administrator":
{ Args: { "display_name": string,"request_id": string,"target_user": string }; Returns: string
                           },
"can_read_financials":
{ Args: { "target_project": string }; Returns: boolean
                           },
"can_read_project":
{ Args: { "target_project": string }; Returns: boolean
                           },
"comparison_dispatch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"comparison_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"current_user_authorized":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"demand_apply":
{ Args: { "actor": Json,"changes": Json,"expected_version": string,"operation": string,"reason": string,"target": string }; Returns: Json
                           },
"demand_snapshot":
{ Args: { "target": string }; Returns: Json
                           },
"document_actor_snapshot":
{ Args: { "actor": Json }; Returns: Json
                           },
"document_audit":
{ Args: { "action": string,"actor": Json,"details"?: Json,"operation": string,"target": string }; Returns: undefined
                           },
"document_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"document_job_allowed":
{ Args: { "actor": Json,"kind": string,"target": string }; Returns: boolean
                           },
"document_notify":
{ Args: { "target": string }; Returns: undefined
                           },
"document_transfer":
{ Args: { "action": string,"actor": Json,"lease_id"?: string,"patch"?: Json,"upload_id": string }; Returns: Json
                           },
"document_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"documents_before_review":
{ Args: { "actor": Json,"target_project"?: string,"target_request"?: string }; Returns: Json
                           },
"documents_read":
{ Args: { "actor": Json,"target_project"?: string,"target_request"?: string }; Returns: Json
                           },
"foundation_topic":
{ Args: { "revision": number,"target_session": string,"target_user": string }; Returns: string
                           },
"foundation_topic_allowed":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"foundation_write":
{ Args: { "args": Json,"kind": string }; Returns: Json
                           },
"has_role":
{ Args: { "required_role": string }; Returns: boolean
                           },
"issuance_actor":
{ Args: { "actor": Json }; Returns: string
                           },
"issuance_details":
{ Args: { "preparation": Omit<Database["private"]['Tables']["po_send_preparations"]['Row'], Database["private"]['Tables']["po_send_preparations"]['ComputedFields']>,"value": Json }; Returns: Json
                           },
"issuance_files":
{ Args: { "target": string }; Returns: Json
                           },
"login_preflight":
{ Args: { "login_email": string }; Returns: Json
                           },
"mrf_editable":
{ Args: { "target": string }; Returns: boolean
                           },
"mrf_ready":
{ Args: { "target": string }; Returns: boolean
                           },
"mrf_register_downstream":
{ Args: { "kind": string,"record_id": string,"target": string }; Returns: undefined
                           },
"po_active_preparation":
{ Args: { "target": string }; Returns: string
                           },
"po_archive_allowed":
{ Args: { "actor": Json }; Returns: boolean
                           },
"po_archive_dispatch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"po_archive_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"po_budget_position":
{ Args: { "target": string }; Returns: Json
                           },
"po_cannot_approve":
{ Args: { "caller": string,"target": string }; Returns: boolean
                           },
"po_issuance_view":
{ Args: { "target": string }; Returns: Json
                           },
"po_review_view":
{ Args: { "target": string }; Returns: Json
                           },
"po_terms_ready":
{ Args: { "body": Json }; Returns: boolean
                           },
"project_actor":
{ Args: { "actor": Json,"writing"?: boolean }; Returns: string
                           },
"project_allocation_summary":
{ Args: { "financial": boolean,"target": string }; Returns: Json
                           },
"project_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"project_command_before_documents":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"project_history":
{ Args: { "target"?: string }; Returns: Json
                           },
"project_money":
{ Args: { "value": Json }; Returns: number
                           },
"project_snapshot":
{ Args: { "target": string }; Returns: Json
                           },
"project_summary":
{ Args: { "financial": boolean,"target": string }; Returns: Json
                           },
"projects_allocation_read":
{ Args: { "actor": Json,"target_project"?: string }; Returns: Json
                           },
"projects_read":
{ Args: { "actor": Json,"target_project"?: string }; Returns: Json
                           },
"purchasing_apply_claims":
{ Args: { "actor": Json,"expected": string,"operation": string,"reason": string,"target": string }; Returns: Json
                           },
"purchasing_before_issuance_view":
{ Args: { "target": string }; Returns: Json
                           },
"purchasing_blockers":
{ Args: { "target": string }; Returns: Json
                           },
"purchasing_command":
{ Args: { "actor": Json,"calculation"?: Json,"command": Json,"snapshot"?: Json }; Returns: Json
                           },
"purchasing_po_body":
{ Args: { "body": Json,"quote": string,"target": string }; Returns: Json
                           },
"purchasing_preparation_command":
{ Args: { "actor": Json,"calculation"?: Json,"command": Json,"snapshot"?: Json }; Returns: Json
                           },
"purchasing_preparation_view":
{ Args: { "target": string }; Returns: Json
                           },
"purchasing_read":
{ Args: { "actor": Json,"target_request"?: string }; Returns: Json
                           },
"purchasing_record_view":
{ Args: { "target": string }; Returns: Json
                           },
"purchasing_validate_body":
{ Args: { "body": Json,"previous"?: Json,"quote": string,"target": string }; Returns: Json
                           },
"purchasing_without_payment_review_body":
{ Args: { "body": Json,"previous"?: Json,"quote": string,"target": string }; Returns: Json
                           },
"quotation_actor":
{ Args: { "actor": Json,"writing"?: boolean }; Returns: string
                           },
"quotation_archive_allowed":
{ Args: { "actor": Json }; Returns: boolean
                           },
"quotation_archive_dispatch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"quotation_archive_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"quotation_audit":
{ Args: { "actor": Json,"details": Json,"kind": string,"operation": string,"target": string }; Returns: undefined
                           },
"quotation_body":
{ Args: { "parent": string,"value": Json }; Returns: Json
                           },
"quotation_capture_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"quotation_capture_view":
{ Args: { "target": string }; Returns: Json
                           },
"quotation_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"quotation_commit_group":
{ Args: { "target": string }; Returns: undefined
                           },
"quotation_decimal":
{ Args: { "mode"?: string,"value": Json }; Returns: string
                           },
"quotation_dispatch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"quotation_enqueue":
{ Args: { "actor": Json,"file": string,"kind": string }; Returns: undefined
                           },
"quotation_file":
{ Args: { "actor": Json,"file_id": string }; Returns: Json
                           },
"quotation_files_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"quotation_financial_command":
{ Args: { "actor": Json,"calculation"?: Json,"command": Json }; Returns: Json
                           },
"quotation_financial_source":
{ Args: { "actor": Json,"quote_id": string }; Returns: Json
                           },
"quotation_job_allowed":
{ Args: { "actor": Json,"target": string }; Returns: boolean
                           },
"quotation_lock":
{ Args: { "editing"?: boolean,"target": string }; Returns: {
              "body": NonNullable<Json>,
"checked": Json | null,
"content_version": number,
"copied_from_revision": string | null,
"created_at": string,
"creator_id": string,
"creator_name": string,
"current_files": (string)[],
"family_id": string,
"file_version": number,
"id": string,
"matches": NonNullable<Json>,
"request_id": string,
"state": string,
"supplier_id": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "quotation_drafts"
        isOneToOne: true
        isSetofReturn: false
      } },
"quotation_mrf_archive":
{ Args: { "target": string }; Returns: string
                           },
"quotation_notify":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"quotation_ready_files":
{ Args: { "q": Omit<Database["private"]['Tables']["quotation_drafts"]['Row'], Database["private"]['Tables']["quotation_drafts"]['ComputedFields']> }; Returns: boolean
                           },
"quotation_review_pdf":
{ Args: { "actor": Json,"revision_id": string }; Returns: Json
                           },
"quotation_revision_blockers":
{ Args: { "target": string }; Returns: Json
                           },
"quotation_transfer":
{ Args: { "action": string,"actor": Json,"file_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"quotation_try_activate":
{ Args: { "actor": Json,"reason"?: string,"target": string }; Returns: boolean
                           },
"quotation_view":
{ Args: { "target": string }; Returns: Json
                           },
"quotation_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"quotations_read":
{ Args: { "actor": Json,"target_request": string }; Returns: Json
                           },
"request_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"request_date":
{ Args: { "value": Json }; Returns: string
                           },
"request_draft":
{ Args: { "value": Json }; Returns: Json
                           },
"request_draft_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"request_draft_snapshot":
{ Args: { "target": string }; Returns: Json
                           },
"request_project_allowed":
{ Args: { "actor": Json,"target": string }; Returns: boolean
                           },
"request_snapshot":
{ Args: { "target": string }; Returns: Json
                           },
"request_without_commitments_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"requests_read":
{ Args: { "actor": Json,"target_request"?: string }; Returns: Json
                           },
"scope_committed":
{ Args: { "target": string }; Returns: number
                           },
"scope_snapshot":
{ Args: { "target": string }; Returns: Json
                           },
"scope_uncommitted":
{ Args: { "target": string }; Returns: number
                           },
"session_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"stock_apply":
{ Args: { "accounts": Json,"actor": Json,"operation": string,"postings": Json,"reason": string,"reservations": Json }; Returns: Json
                           },
"stock_snapshot":
{ Args: { "ids": (string)[] }; Returns: Json
                           },
"supplier_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"supplier_history":
{ Args: { "target"?: string }; Returns: Json
                           },
"supplier_profile":
{ Args: { "value": Json }; Returns: Json
                           },
"supplier_view":
{ Args: { "target": string }; Returns: Json
                           },
"suppliers_read":
{ Args: { "actor": Json,"target_supplier"?: string }; Returns: Json
                           },
"unbind_session":
{ Args: { "target_session": string,"target_user": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "material_request_items": {
                  Row: {
                    "data": NonNullable<Json>,"id": string,"position": number,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "data": NonNullable<Json>,"id": string,"position": number,"request_id": string
                  }
                  Update: {
                    "data"?: NonNullable<Json>,"id"?: string,"position"?: number,"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "material_request_items_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "material_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"material_requests": {
                  Row: {
                    "correction_kind": string | null,"correction_state": string | null,"created_at": string,"creator_id": string,"creator_name": string,"data": NonNullable<Json>,"id": string,"project_id": string,"ref": string,"scope_id": string | null,"sequence": number,"status": string,"submission_id": string | null,"updated_at": string,"updater_id": string,"updater_name": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "correction_kind"?: string | null,"correction_state"?: string | null,"created_at"?: string,"creator_id": string,"creator_name": string,"data": NonNullable<Json>,"id"?: string,"project_id": string,"ref": string,"scope_id"?: string | null,"sequence": number,"status"?: string,"submission_id"?: string | null,"updated_at"?: string,"updater_id": string,"updater_name": string,"version"?: number
                  }
                  Update: {
                    "correction_kind"?: string | null,"correction_state"?: string | null,"created_at"?: string,"creator_id"?: string,"creator_name"?: string,"data"?: NonNullable<Json>,"id"?: string,"project_id"?: string,"ref"?: string,"scope_id"?: string | null,"sequence"?: number,"status"?: string,"submission_id"?: string | null,"updated_at"?: string,"updater_id"?: string,"updater_name"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "material_requests_creator_id_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "material_requests_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_scope_id_project_id_fkey"
      columns: ["scope_id","project_id"]
isOneToOne: false
      referencedRelation: "scopes"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "material_requests_updater_id_fkey"
      columns: ["updater_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "access_revision": number,"created_at": string,"display_name": string,"first_signed_in_at": string | null,"is_active": boolean,"updated_at": string,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "access_revision"?: number,"created_at"?: string,"display_name": string,"first_signed_in_at"?: string | null,"is_active"?: boolean,"updated_at"?: string,"user_id": string,"version"?: number
                  }
                  Update: {
                    "access_revision"?: number,"created_at"?: string,"display_name"?: string,"first_signed_in_at"?: string | null,"is_active"?: boolean,"updated_at"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [

                  ]
                },"project_assignments": {
                  Row: {
                    "project_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "project_id": string,"user_id": string
                  }
                  Update: {
                    "project_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_assignments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_assignments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"project_budgets": {
                  Row: {
                    "amount": number,"project_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"project_id": string
                  }
                  Update: {
                    "amount"?: number,"project_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_budgets_project_id_fkey"
      columns: ["project_id"]
isOneToOne: true
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "code_locked_at": string | null,"created_at": string,"creation_request_id": string,"document_code": string | null,"id": string,"location": string,"name": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code_locked_at"?: string | null,"created_at"?: string,"creation_request_id"?: string,"document_code"?: string | null,"id"?: string,"location"?: string,"name": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "code_locked_at"?: string | null,"created_at"?: string,"creation_request_id"?: string,"document_code"?: string | null,"id"?: string,"location"?: string,"name"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [

                  ]
                },"role_grants": {
                  Row: {
                    "role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "role": string,"user_id": string
                  }
                  Update: {
                    "role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_grants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"scope_budgets": {
                  Row: {
                    "amount": number,"scope_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"scope_id": string
                  }
                  Update: {
                    "amount"?: number,"scope_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scope_budgets_scope_id_fkey"
      columns: ["scope_id"]
isOneToOne: true
      referencedRelation: "scopes"
      referencedColumns: ["id"]
    }
                  ]
                },"scopes": {
                  Row: {
                    "created_at": string,"creation_request_id": string,"id": string,"name": string,"project_id": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"creation_request_id"?: string,"id"?: string,"name": string,"project_id": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"creation_request_id"?: string,"id"?: string,"name"?: string,"project_id"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "scopes_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "account_complete":
{ Args: { "actor": Json,"operation": string }; Returns: Json
                           },
"account_message":
{ Args: { "actor": Json,"expected_version": string,"message_kind": string,"operation": string,"outcome"?: string,"target": string }; Returns: Json
                           },
"account_reserve":
{ Args: { "actor": Json,"draft": Json,"operation": string }; Returns: Json
                           },
"account_save":
{ Args: { "actor": Json,"draft": Json,"expected_version": string,"operation": string,"target": string }; Returns: Json
                           },
"accounting_command":
{ Args: { "actor": Json,"command": Json,"snapshot"?: Json }; Returns: Json
                           },
"accounts_directory":
{ Args: { "actor": Json }; Returns: Json
                           },
"auth_bind_session":
{ Args: { "expected_credential": string,"expected_revision": string,"target_session": string,"target_user": string }; Returns: boolean
                           },
"auth_bootstrap_administrator":
{ Args: { "display_name": string,"request_id": string,"target_user": string }; Returns: string
                           },
"auth_login_preflight":
{ Args: { "login_email": string }; Returns: Json
                           },
"auth_session_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"auth_unbind_session":
{ Args: { "target_session": string,"target_user": string }; Returns: undefined
                           },
"comparison_dispatch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"comparison_document":
{ Args: { "actor": Json,"artifact_id": string }; Returns: Json
                           },
"comparison_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"document_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"document_dispatch":
{ Args: { "target_project"?: string }; Returns: Json
                           },
"document_file":
{ Args: { "actor": Json,"document_id": string }; Returns: Json
                           },
"document_source_file":
{ Args: { "actor": Json,"document_id": string }; Returns: Json
                           },
"document_transfer":
{ Args: { "action": string,"actor": Json,"lease_id"?: string,"patch"?: Json,"upload_id": string }; Returns: Json
                           },
"document_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"documents_read":
{ Args: { "actor": Json,"target_project"?: string,"target_request"?: string }; Returns: Json
                           },
"issuance_command":
{ Args: { "actor": Json,"command": Json,"proof"?: Json }; Returns: Json
                           },
"issuance_prepare_files":
{ Args: { "actor": Json,"target": string }; Returns: Json
                           },
"issuance_receipt":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"po_archive_dispatch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"po_archive_document":
{ Args: { "actor": Json,"archive_id": string }; Returns: Json
                           },
"po_archive_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"project_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"projects_read":
{ Args: { "actor": Json,"target_project"?: string }; Returns: Json
                           },
"purchasing_command":
{ Args: { "actor": Json,"calculation"?: Json,"command": Json,"snapshot"?: Json }; Returns: Json
                           },
"purchasing_po_request":
{ Args: { "actor": Json,"po_id": string }; Returns: string
                           },
"purchasing_read":
{ Args: { "actor": Json,"target_request"?: string }; Returns: Json
                           },
"quotation_archive_dispatch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"quotation_archive_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"quotation_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"quotation_dispatch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"quotation_file":
{ Args: { "actor": Json,"file_id": string }; Returns: Json
                           },
"quotation_files_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"quotation_financial_command":
{ Args: { "actor": Json,"calculation"?: Json,"command": Json }; Returns: Json
                           },
"quotation_financial_source":
{ Args: { "actor": Json,"quote_id": string }; Returns: Json
                           },
"quotation_review_pdf":
{ Args: { "actor": Json,"revision_id": string }; Returns: Json
                           },
"quotation_transfer":
{ Args: { "action": string,"actor": Json,"file_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"quotation_worker":
{ Args: { "action": string,"job_id": string,"lease_id"?: string,"patch"?: Json }; Returns: Json
                           },
"quotations_read":
{ Args: { "actor": Json,"target_request": string }; Returns: Json
                           },
"request_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"requests_read":
{ Args: { "actor": Json,"target_request"?: string }; Returns: Json
                           },
"supplier_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"suppliers_read":
{ Args: { "actor": Json,"target_supplier"?: string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "private": {
          Enums: {

          }
        },"public": {
          Enums: {

          }
        }
} as const
