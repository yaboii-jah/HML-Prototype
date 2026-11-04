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
"accounts_directory":
{ Args: { "actor": Json }; Returns: Json
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
"current_user_authorized":
{ Args: Record<PropertyKey, never>; Returns: boolean
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
"project_actor":
{ Args: { "actor": Json,"writing"?: boolean }; Returns: string
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
"projects_read":
{ Args: { "actor": Json,"target_project"?: string }; Returns: Json
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
"requests_read":
{ Args: { "actor": Json,"target_request"?: string }; Returns: Json
                           },
"scope_snapshot":
{ Args: { "target": string }; Returns: Json
                           },
"session_context":
{ Args: Record<PropertyKey, never>; Returns: Json
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
"project_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"projects_read":
{ Args: { "actor": Json,"target_project"?: string }; Returns: Json
                           },
"request_command":
{ Args: { "actor": Json,"command": Json }; Returns: Json
                           },
"requests_read":
{ Args: { "actor": Json,"target_request"?: string }; Returns: Json
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
