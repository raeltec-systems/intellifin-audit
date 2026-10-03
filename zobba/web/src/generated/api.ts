// Generated from zobba/openapi.json. Run pnpm api:generate; do not edit.
export interface paths {
    "/auth/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["callback"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["login"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["session"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["open"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/conversation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_conversation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/conversation/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_conversation_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/conversation/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_conversation_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_evidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/evidence-reservations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["recover_evidence_reservations"];
        put?: never;
        post: operations["reserve_evidence"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/evidence-reservations/{reservation_id}/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["upload_evidence"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/evidence/{evidence_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["inspect_evidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/evidence/{evidence_id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["download_evidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/evidence/{evidence_id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["preview_evidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/knowledge/evidence/{evidence_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["knowledge_source_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/knowledge/evidence/{evidence_id}/recover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["knowledge_recover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/knowledge/evidence/{evidence_id}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["knowledge_verify_source"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/knowledge/excerpts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["knowledge_excerpt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/operations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_operations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/operations/{operation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_operation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/operations/{operation_id}/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["decide_operation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/operations/{operation_id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_operation_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/permissions/{authority_id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["revoke_permission"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/skills/impacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["skills_selection_impact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/task-commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["admit_task_command"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/task-controls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["admit_task_control"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/task-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_task_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_tasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_task"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/knowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Returns at most 50 currently authorized views in C-ordered ID order after checking applicability and support. At most 1024 candidates are examined; scan_limit reports a partial scan, not absence. Exact record/revision lookup remains independent of page reachability. */
        get: operations["knowledge_inspect"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/knowledge/commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["knowledge_mutate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/knowledge/records/{record_id}/revisions/{revision}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["knowledge_exact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/knowledge/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A bounded read carried by POST to keep exact source references out of URLs.
         *     This is disclosure verification, not command admission or an execution grant.
         */
        post: operations["knowledge_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/methodology": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["task_methodology"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["skills_discover"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/skills/select": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["skills_select"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/skills/selections/{selection_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["skills_current_use"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ready"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/knowledge/organisations/{organisation_id}/preference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["knowledge_preference"];
        put?: never;
        post: operations["knowledge_mutate_preference"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/knowledge/organisations/{organisation_id}/preference/observations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["knowledge_observe_layout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/knowledge/organisations/{organisation_id}/preference/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["knowledge_verify_preference"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/membership/invitations/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["membership_accept_invitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/membership/invitations/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["membership_preview_invitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/membership/organisations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["membership_organisations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/membership/organisations/{organisation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["membership_snapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/membership/organisations/{organisation_id}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["membership_invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/membership/organisations/{organisation_id}/invitations/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["membership_revoke_invitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/membership/organisations/{organisation_id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["membership_save_member"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/membership/organisations/{organisation_id}/members/{actor_id}/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["membership_member_assignments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/methodology/organisations/{organisation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["methodology_snapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/methodology/organisations/{organisation_id}/recall": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["recall_methodology"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/methodology/organisations/{organisation_id}/save": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["save_methodology"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skills/organisations/{organisation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["skills_catalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skills/organisations/{organisation_id}/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["skills_assignment_options"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skills/organisations/{organisation_id}/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["skills_install"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skills/organisations/{organisation_id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["skills_set_status"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skills/organisations/{organisation_id}/versions/{version_id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["skills_status_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AcceptInvitationRequest: {
            key: components["schemas"]["MembershipIdentifier"];
            /** @description Private random 32-byte base64url invitation value. POST bodies only; never a query, log or projection. */
            secret: components["schemas"]["MembershipInvitationSecret"];
        };
        /** @enum {string} */
        ActionRequest: "read" | "write" | "send";
        AttachmentRequest: {
            classification: string;
            digest: string;
            /** @description Immutable logical material identity; never a credential or download capability. */
            id: string;
        };
        AttemptHistoryResponse: {
            execution_epoch: string;
            id: string;
            /** @description Non-secret source ledger identity bound when this attempt was admitted. */
            ledger_id: string | null;
            /** @description Exact immutable binding effective when this attempt was admitted. */
            methodology_binding_id: string;
            number: string;
            operation_id: string;
            recorded_at: string;
            request_digest: string;
            /** @description Non-secret logical source identity; never an endpoint URL or capability. */
            source_id: string | null;
        };
        CanonicalOperationRequest: {
            account_id: string;
            action: components["schemas"]["ActionRequest"];
            /** @description Sorted by unique attachment ID; complete immutable material identities. */
            attachments: components["schemas"]["AttachmentRequest"][];
            /** @description Exact logical destination, never a caller-selected URL or credential. */
            destination: string;
            environment_id: string;
            /** @description Exact positive Unix seconds represented as decimal text. */
            expires_at: string;
            /** @description Exact reviewed material, at most 4000 UTF-8 bytes. */
            material: string;
            material_digest: string;
            purpose: components["schemas"]["PurposeRequest"];
            /** @description Sorted unique logical recipient identities; order is canonical and substitutions refuse. */
            recipients: string[];
            resource_id: string;
            resource_version: string;
            /**
             * Format: int32
             * @description Canonical request contract version, currently 1.
             */
            version: number;
        };
        /** @enum {string} */
        Certainty: "user_directed" | "source_states" | "asserted" | "learned" | "explicit_preference";
        /** @enum {string} */
        CessationResponse: "none" | "pending" | "confirmed" | "reconciliation_required";
        ChangeSkillStatusRequest: {
            expected_revision: string;
            key: string;
            reason: string;
            status: components["schemas"]["SkillStatus"];
            version_id: string;
        };
        /** @enum {string} */
        CommandKindRequest: "create" | "guide" | "pause" | "resume" | "stop" | "continue";
        CommandReceiptResponse: {
            command_id: string;
            cycle_id: string;
            /** @description Decimal commit-ordered cursor; represented as text to preserve integer precision. */
            event_cursor: string;
            /** @description Admission is durable. Applied and observed cessation are separate event/snapshot facts. */
            status: components["schemas"]["ReceiptStatusResponse"];
            task_id: string;
        };
        ConversationActivityResponse: {
            /** @description Decimal Received or Applied cursor, no greater than the snapshot watermark. */
            cursor: string;
            task_id: string;
        };
        /** @enum {string} */
        ConversationAudienceResponse: "engagement_members";
        ConversationFeedResponse: {
            audience: components["schemas"]["ConversationAudienceResponse"];
            /** @description Invalidation facts; obtain a new consistent snapshot to replace current state. */
            events: components["schemas"]["TaskEventResponse"][];
            has_more: boolean;
            /** @description Last returned cursor, or unchanged input. Never advances over omitted facts. */
            next_cursor: string;
            /**
             * @description Gap, cursor ahead of server, or backlog exceeding 1000: refresh the snapshot.
             *     Events is empty and next_cursor unchanged; do not infer progress from watermark.
             */
            resync_required: boolean;
            scope: components["schemas"]["ConversationScopeResponse"];
            watermark: string;
        };
        ConversationHistoryResponse: {
            audience: components["schemas"]["ConversationAudienceResponse"];
            before_cursor: string | null;
            messages: components["schemas"]["ConversationMessageResponse"][];
            scope: components["schemas"]["ConversationScopeResponse"];
            /** @description Requested fixed through cursor, including Applied facts only through that cursor. */
            watermark: string;
        };
        ConversationMessageResponse: {
            /** @description Applied means retained plain text reached a work boundary, not model understanding. */
            applied_cursor: string | null;
            author_id: string;
            /** @description Current public label of the retained author; role changes do not erase authorship. */
            author_label: string;
            command_id: string;
            content: string | null;
            context?: null | components["schemas"]["MethodologyTaskContext"];
            /** @description Resulting cycle. Continue preserves its old addressed cycle separately below. */
            cycle_id: string;
            key: string;
            kind: components["schemas"]["CommandKindRequest"];
            received_cursor: string;
            target_cycle_id: string | null;
            target_task_id: string | null;
            task_id: string;
        };
        ConversationScopeResponse: {
            client_id: string;
            engagement_id: string;
            organisation_id: string;
        };
        ConversationSnapshotResponse: {
            audience: components["schemas"]["ConversationAudienceResponse"];
            /** @description Exclusive Received cursor for the preceding history page at this watermark. */
            before_cursor: string | null;
            latest_activity: null | components["schemas"]["ConversationActivityResponse"];
            /** @description Latest 100 accepted commands in ascending Received order; not the complete history. */
            messages: components["schemas"]["ConversationMessageResponse"][];
            /** @description Continue through GET tasks?after_task_id; those pages are fresh current reads. */
            next_task_cursor: string | null;
            scope: components["schemas"]["ConversationScopeResponse"];
            /** @description First 100 current Tasks ordered by ID; open any known ID independently. */
            tasks: components["schemas"]["TaskResponse"][];
            /** @description All included Task state and receipt facts come from the same statement as this cursor. */
            watermark: string;
        };
        DecisionHistoryResponse: {
            decision: components["schemas"]["OperationDecisionResponse"];
            /** @description Exact persisted decision key, scoped to the recorded actor and engagement. */
            key: string;
            /** @description Server recording time, positive Unix seconds as decimal text. */
            recorded_at: string;
        };
        EngagementResponse: {
            client_id: string;
            /** @description 1–200 Unicode scalars; no C0/C1 controls or leading/trailing Unicode White_Space. */
            client_name: string;
            engagement_id: string;
            /** @description 1–200 Unicode scalars; no C0/C1 controls or leading/trailing Unicode White_Space. */
            engagement_name: string;
            organisation_id: string;
            /** @description 1–200 Unicode scalars; no C0/C1 controls or leading/trailing Unicode White_Space. */
            organisation_name: string;
            roles: string[];
        };
        EngagementsResponse: {
            engagements: components["schemas"]["EngagementResponse"][];
            next_cursor: null | components["schemas"]["ScopeResponse"];
        };
        ErrorResponse: {
            error: string;
        };
        /**
         * Format: binary
         * @description Raw original bytes, not a JSON array or a base64-encoded string.
         */
        EvidenceBinary: string;
        EvidenceContentIdentity: {
            sha256: string;
            /** Format: int64 */
            size: number;
        };
        EvidencePageResponse: {
            coverage: components["schemas"]["EvidenceSearchCoverageResponse"];
            items: components["schemas"]["EvidenceResponse"][];
            next_cursor: string | null;
            /**
             * @description Canonical literal query, trimmed using Rust Unicode whitespace rules;
             *     at most 200 UTF-8 bytes. Empty text browses registered originals.
             */
            query: string;
            /** @description Storage configuration is present; this does not assert bucket readiness. */
            storage_configured: boolean;
        };
        /** @enum {string} */
        EvidencePreviewKind: "plain_text" | "download_only";
        EvidencePreviewResponse: {
            kind: components["schemas"]["EvidencePreviewKind"];
            text: string | null;
            truncated: boolean;
        };
        EvidenceReservationPageResponse: {
            items: components["schemas"]["EvidenceReservationResponse"][];
            next_cursor: string | null;
        };
        EvidenceReservationRequest: {
            filename: string;
            identity: components["schemas"]["EvidenceContentIdentity"];
            key: string;
            source: components["schemas"]["EvidenceSourceAssertions"];
        };
        EvidenceReservationResponse: {
            actor_id: string;
            id: string;
            request: components["schemas"]["EvidenceReservationRequest"];
            /**
             * Format: int64
             * @description Server-recorded reservation time, Unix seconds; registration completes acquisition.
             */
            reserved_at: number;
            scope: components["schemas"]["ScopeResponse"];
        };
        EvidenceResponse: {
            /** Format: int64 */
            registered_at: number;
            reservation: components["schemas"]["EvidenceReservationResponse"];
            /** @description Immutable storage version independently confirmed by a bounded pinned read. */
            version: string;
        };
        EvidenceSearchCoverageResponse: {
            candidate_limit: number;
            /**
             * @description No remaining C-ordered candidates for this read, iff next_cursor is null.
             *     This never establishes source completeness or absence before the cursor.
             */
            complete: boolean;
            examined_count: number;
        };
        /** @description Each populated value is the acquisition actor's assertion; null means unknown. */
        EvidenceSourceAssertions: {
            account: string | null;
            coverage: string | null;
            selection: string | null;
            /** @description Asserted source-system version, separate from the measured storage version. */
            source_version: string | null;
            system: string | null;
        };
        HealthResponse: {
            /** Format: int32 */
            schema_version: number | null;
            service: components["schemas"]["Service"];
            status: components["schemas"]["HealthStatus"];
        };
        /** @enum {string} */
        HealthStatus: "live" | "ready" | "unavailable";
        IdentityResponse: {
            display_name: string;
            id: string;
        };
        InstallSkillRequest: {
            applicability: components["schemas"]["MethodologyApplicability"];
            assignment: components["schemas"]["MethodologyAssignmentScope"];
            enabled: boolean;
            expected_revision: string;
            key: string;
            manifest: components["schemas"]["SkillManifest"];
        };
        InvitationPreviewResponse: {
            assignments: components["schemas"]["MembershipAssignmentOption"][];
            /** Format: int64 */
            expires_at: number;
            organisation_id: components["schemas"]["MembershipIdentifier"];
            organisation_name: string;
            recipient_email: components["schemas"]["MembershipRecipientEmail"];
            roles: components["schemas"]["MembershipRole"][];
        };
        InviteMemberRequest: {
            assignments: components["schemas"]["MembershipAssignment"][];
            expected_version: components["schemas"]["MembershipVersion"];
            /** Format: int32 */
            expires_in_seconds: number;
            key: components["schemas"]["MembershipIdentifier"];
            recipient_email: components["schemas"]["MembershipRecipientEmail"];
            /** @description Unique roles fixed for this invitation; acceptance cannot broaden them. */
            roles: components["schemas"]["MembershipRole"][];
            /** @description Private random 32-byte base64url invitation value. POST bodies only; never a query, log or projection. */
            secret: components["schemas"]["MembershipInvitationSecret"];
        };
        KnowledgeAction: {
            assertion: components["schemas"]["KnowledgeAssertion"];
            /** @enum {string} */
            kind: "assert";
        } | {
            assertion: components["schemas"]["KnowledgeAssertion"];
            /** @enum {string} */
            kind: "correct";
            reason: string;
            target: components["schemas"]["KnowledgeRecordReference"];
        } | {
            /** @enum {string} */
            kind: "exclude";
            reason: string;
            target: components["schemas"]["KnowledgeRecordReference"];
        } | {
            /** @enum {string} */
            kind: "forget";
            reason: string;
            target: components["schemas"]["KnowledgeRecordReference"];
        } | {
            destination_engagement_id: string;
            destination_task_id: string;
            /** @enum {string} */
            kind: "reuse";
            reason: string;
            target: components["schemas"]["KnowledgeRecordReference"];
        } | {
            expected_source_revision: string;
            /** @enum {string} */
            kind: "correct_source";
            predecessor_id: string;
            reason: string;
            replacement_id: string;
        };
        KnowledgeAssertion: {
            dependencies: components["schemas"]["KnowledgeDependency"][];
            period: components["schemas"]["KnowledgePeriod"];
            text: string;
            uncertainty?: string | null;
        };
        KnowledgeCaptureExcerpt: {
            /** Format: int64 */
            byte_end: number;
            /** Format: int64 */
            byte_start: number;
            evidence_id: string;
            key: string;
        };
        KnowledgeCommand: {
            action: components["schemas"]["KnowledgeAction"];
            expected_revision: string;
            key: string;
        };
        KnowledgeDependency: {
            digest: string;
            evidence_id: string;
            /** @enum {string} */
            kind: "evidence";
            scope: components["schemas"]["KnowledgeScope"];
            storage_version: string;
        } | {
            command_id: string;
            cycle_id: string;
            /** @enum {string} */
            kind: "guide";
            scope: components["schemas"]["KnowledgeScope"];
            task_id: string;
        } | {
            id: string;
            /** @enum {string} */
            kind: "knowledge";
            revision: string;
            scope: components["schemas"]["KnowledgeScope"];
        } | {
            /** @enum {string} */
            kind: "methodology";
            version_id: string;
        } | {
            /** @enum {string} */
            kind: "skill";
            selection_id: string;
            task_id: string;
        };
        KnowledgeDirectionBasis: {
            command_id: string;
            cycle_id: string;
            standing: string;
            task_id: string;
        };
        /** @enum {string} */
        KnowledgeInspectionLayout: "standard" | "expanded";
        /** @enum {string} */
        KnowledgeKind: "decision" | "observation" | "assertion" | "preference" | "published_preference";
        KnowledgeObserveLayout: {
            expected_revision: string;
            key: string;
            opening_id: string;
            value: components["schemas"]["KnowledgeInspectionLayout"];
        };
        /** @enum {string} */
        KnowledgeOmission: "unsupported_format" | "unknown_period" | "outside_period" | "invalidated_support" | "capture_capacity" | "legacy_not_captured" | "partial_source" | "bounded_page" | "scan_limit" | "unavailable_support";
        KnowledgePage: {
            execution_epoch: string;
            items: components["schemas"]["KnowledgeView"][];
            methodology_binding_id: string;
            next_after?: string | null;
            omissions: components["schemas"]["KnowledgeOmission"][];
            revision: string;
            task_id: string;
        };
        KnowledgePeriod: {
            end?: string | null;
            start?: string | null;
        };
        KnowledgePreferenceAction: {
            /** @enum {string} */
            kind: "save";
            value: components["schemas"]["KnowledgeInspectionLayout"];
        } | {
            /** @enum {string} */
            kind: "undo";
            target: components["schemas"]["KnowledgeRecordReference"];
        } | {
            client_id: string;
            engagement_id: string;
            /** @enum {string} */
            kind: "publish";
            target: components["schemas"]["KnowledgeRecordReference"];
        } | {
            /** @enum {string} */
            kind: "withdraw";
            publication_id: string;
        };
        KnowledgePreferenceBasis: {
            inferred: boolean;
            name: string;
            observation_ids: string[];
            rule?: string | null;
            value: components["schemas"]["KnowledgeInspectionLayout"];
        };
        KnowledgePreferenceCommand: {
            action: components["schemas"]["KnowledgePreferenceAction"];
            expected_revision: string;
            key: string;
        };
        KnowledgePreferenceSnapshot: {
            consumed_through: string;
            current?: null | components["schemas"]["KnowledgeView"];
            organisation_id: string;
            owner_id: string;
            publications: components["schemas"]["KnowledgeView"][];
            revision: string;
        };
        KnowledgePreferenceVerificationRequest: {
            expected_revision: string;
        };
        KnowledgeQuery: {
            /** @description Exclusive last-disclosed record or publication ID in C order; omitted starts at the first candidate. Use next_after unchanged. No cursor is disclosed when no eligible item is returned. */
            after?: string | null;
            /**
             * @description False by default. True includes authorized inactive history; it never bypasses current source authority or period applicability.
             * @default false
             */
            include_inactive: boolean;
            /** @description Case-insensitive Unicode lowercase substring match on authorized, applicable record text, without trimming. Empty text matches any eligible record. At most 200 Unicode scalar values; C0/C1 controls are refused. */
            text?: string | null;
        };
        KnowledgeReceipt: {
            affected_destinations: string[];
            affected_ids: string[];
            event_id: string;
            record?: null | components["schemas"]["KnowledgeView"];
            revision: string;
        };
        KnowledgeRecord: {
            actor_id: string;
            certainty: components["schemas"]["Certainty"];
            dependencies: components["schemas"]["KnowledgeDependency"][];
            direction?: null | components["schemas"]["KnowledgeDirectionBasis"];
            id: string;
            kind: components["schemas"]["KnowledgeKind"];
            period: components["schemas"]["KnowledgePeriod"];
            preference?: null | components["schemas"]["KnowledgePreferenceBasis"];
            /** Format: int64 */
            recorded_at: number;
            revision: string;
            scope: components["schemas"]["KnowledgeScope"];
            source?: null | components["schemas"]["KnowledgeSourceLocation"];
            supersedes?: null | components["schemas"]["KnowledgeRecordReference"];
            text: string;
            uncertainty?: string | null;
        };
        KnowledgeRecordReference: {
            id: string;
            revision: string;
        };
        /** @enum {string} */
        KnowledgeRecordStatus: "current" | "corrected" | "excluded" | "forgotten" | "invalidated" | "withdrawn";
        KnowledgeRecoveryRequest: {
            key: string;
        };
        KnowledgeScope: {
            client_id?: string | null;
            engagement_id?: string | null;
            kind: components["schemas"]["KnowledgeScopeKind"];
            organisation_id: string;
            owner_id?: string | null;
        };
        /** @enum {string} */
        KnowledgeScopeKind: "personal" | "firm" | "client" | "engagement";
        KnowledgeSourceLocation: {
            /** Format: int64 */
            byte_end: number;
            /** Format: int64 */
            byte_start: number;
            digest: string;
            evidence_id: string;
            field_path?: string | null;
            /** Format: int64 */
            original_size: number;
            partial: boolean;
            storage_version: string;
        };
        KnowledgeSourceStatus: {
            capture_revision: string;
            correction_actor_id?: string | null;
            correction_reason?: string | null;
            /** Format: int64 */
            correction_recorded_at?: number | null;
            evidence_id: string;
            omissions: components["schemas"]["KnowledgeOmission"][];
            replacement_id?: string | null;
            source_revision: string;
        };
        KnowledgeSourceVerificationRequest: {
            expected_capture_revision: string;
            expected_source_revision: string;
        };
        KnowledgeVerificationItem: {
            id: string;
            revision: string;
            status: components["schemas"]["KnowledgeRecordStatus"];
        };
        KnowledgeVerificationRequest: {
            /** @description Read-only exact historical inspection; at most one exact revision. */
            exact?: boolean;
            expected_execution_epoch: string;
            expected_methodology_binding_id: string;
            items: components["schemas"]["KnowledgeVerificationItem"][];
            query: components["schemas"]["KnowledgeQuery"];
        };
        KnowledgeVerificationResponse: {
            verified: boolean;
        };
        KnowledgeView: {
            can_correct: boolean;
            can_exclude: boolean;
            can_forget: boolean;
            can_reuse: boolean;
            can_undo: boolean;
            record: components["schemas"]["KnowledgeRecord"];
            status: components["schemas"]["KnowledgeRecordStatus"];
            status_reason?: string | null;
        };
        MembershipAssignment: {
            client_id: components["schemas"]["MembershipIdentifier"];
            engagement_id: components["schemas"]["MembershipIdentifier"];
        };
        /**
         * @description One assignment selected in a membership Save. Renewal is an explicit choice
         *     for this scope; omitting it has the same meaning as false for exact retries.
         */
        MembershipAssignmentChange: {
            client_id: components["schemas"]["MembershipIdentifier"];
            engagement_id: components["schemas"]["MembershipIdentifier"];
            /**
             * @description True explicitly renews this scope if its stored assignment expired or
             *     became inactive. A future active expiry is preserved. Remove mode must use false.
             * @default false
             */
            renew: boolean;
        };
        /** @description Exclusive cursor containing a client identifier, a dot, then an engagement identifier. */
        MembershipAssignmentCursor: string;
        /**
         * @description Replace supplies the complete assignment set and refuses legacy sets above
         *     100. Preserve requires an empty assignments array and keeps every assignment;
         *     remove revokes only the listed assignments, including across paged legacy sets.
         * @enum {string}
         */
        MembershipAssignmentMode: "replace" | "preserve" | "remove";
        MembershipAssignmentOption: {
            client_id: components["schemas"]["MembershipIdentifier"];
            client_name: string;
            engagement_id: components["schemas"]["MembershipIdentifier"];
            engagement_name: string;
        };
        /** @description A bounded ASCII application identifier; also used for idempotency keys. */
        MembershipIdentifier: string;
        MembershipInvitation: {
            assignments: components["schemas"]["MembershipAssignment"][];
            /** Format: int64 */
            expires_at: number;
            id: components["schemas"]["MembershipIdentifier"];
            inviter_actor_id: components["schemas"]["MembershipIdentifier"];
            recipient_email: components["schemas"]["MembershipRecipientEmail"];
            roles: components["schemas"]["MembershipRole"][];
            status: components["schemas"]["MembershipInvitationStatus"];
        };
        /** @description Private random 32-byte base64url capability. POST bodies only; never query strings or logs. */
        MembershipInvitationSecret: string;
        /** @enum {string} */
        MembershipInvitationStatus: "pending" | "accepted" | "revoked" | "expired";
        MembershipMember: {
            active: boolean;
            actor_id: components["schemas"]["MembershipIdentifier"];
            assignments: components["schemas"]["MembershipAssignment"][];
            /** @description False requires the paged assignment endpoint; the preview must not be used as a replacement set. */
            assignments_complete: boolean;
            /**
             * Format: int64
             * @description Effective assignments in this organisation, including any beyond the bounded preview.
             */
            assignments_count: number;
            display_name: string;
            /** Format: int64 */
            expires_at: number | null;
            roles: components["schemas"]["MembershipRole"][];
        };
        MembershipMemberAssignment: {
            client_id: components["schemas"]["MembershipIdentifier"];
            client_name: string;
            engagement_id: components["schemas"]["MembershipIdentifier"];
            engagement_name: string;
            /** Format: int64 */
            expires_at: number | null;
        };
        MembershipMemberAssignments: {
            actor_id: components["schemas"]["MembershipIdentifier"];
            assignments: components["schemas"]["MembershipMemberAssignment"][];
            next_cursor: null | components["schemas"]["MembershipAssignmentCursor"];
            organisation_id: components["schemas"]["MembershipIdentifier"];
            /** Format: int64 */
            total: number;
            version: components["schemas"]["MembershipVersion"];
        };
        MembershipOrganisation: {
            organisation_id: components["schemas"]["MembershipIdentifier"];
            organisation_name: string;
            version: components["schemas"]["MembershipVersion"];
        };
        MembershipOrganisations: {
            next_cursor: null | components["schemas"]["MembershipIdentifier"];
            organisations: components["schemas"]["MembershipOrganisation"][];
        };
        MembershipReceipt: {
            actor_id: components["schemas"]["MembershipIdentifier"];
            event_id: components["schemas"]["MembershipIdentifier"];
            invitation_id: null | components["schemas"]["MembershipIdentifier"];
            kind: components["schemas"]["MembershipReceiptKind"];
            organisation_id: components["schemas"]["MembershipIdentifier"];
            subject_actor_id: null | components["schemas"]["MembershipIdentifier"];
            version: components["schemas"]["MembershipVersion"];
        };
        /** @enum {string} */
        MembershipReceiptKind: "save_member" | "invite" | "revoke_invitation" | "accept";
        /** @description ASCII address with a local part of 1–64 characters and DNS-style domain labels. Preserve local-part case; lowercase the domain. */
        MembershipRecipientEmail: string;
        /**
         * @description Application roles are fixed; provider roles never grant application authority.
         * @enum {string}
         */
        MembershipRole: "auditor" | "audit_manager" | "admin";
        MembershipSnapshot: {
            engagements: components["schemas"]["MembershipAssignmentOption"][];
            engagements_next_cursor: null | components["schemas"]["MembershipAssignmentCursor"];
            invitations: components["schemas"]["MembershipInvitation"][];
            invitations_next_cursor: null | components["schemas"]["MembershipIdentifier"];
            members: components["schemas"]["MembershipMember"][];
            members_next_cursor: null | components["schemas"]["MembershipIdentifier"];
            organisation_id: components["schemas"]["MembershipIdentifier"];
            organisation_name: string;
            version: components["schemas"]["MembershipVersion"];
        };
        /** @description Canonical nonnegative decimal through 9223372036854775807; no signs or leading zeros. */
        MembershipVersion: string;
        MethodologyActivation: {
            /**
             * Format: int64
             * @description Availability in Unix seconds, independent of business applicability dates.
             */
            available_at: number;
            mode: components["schemas"]["MethodologyActivationMode"];
        };
        /** @enum {string} */
        MethodologyActivationMode: "new_tasks" | "active_tasks";
        MethodologyApplicability: {
            audit_area?: string | null;
            period_end?: string | null;
            period_start?: string | null;
        };
        /** @enum {string} */
        MethodologyAssignmentKind: "firm" | "client" | "engagement";
        MethodologyAssignmentScope: {
            client_id?: string | null;
            engagement_id?: string | null;
            kind: components["schemas"]["MethodologyAssignmentKind"];
        };
        MethodologyBinding: {
            actor_id: string;
            /** Format: int64 */
            bound_at: number;
            /** @description Exact version candidates retained for subsequent Task context discovery. */
            candidate_version_ids: string[];
            /** @description Exact Guide command supplying this context, retained through later bindings. */
            context_command_id: string | null;
            /** @description Task execution epoch from which this exact binding applies. */
            execution_epoch: string;
            id: string;
            resolution: components["schemas"]["MethodologyResolution"];
        };
        MethodologyBindingChange: {
            actor_id: string;
            id: string;
            reason: string;
            /** Format: int64 */
            requested_at: number;
            resolution: components["schemas"]["MethodologyResolution"];
        };
        MethodologyBindingNotice: {
            actor_id: string;
            id: string;
            impact: components["schemas"]["MethodologyImpact"];
            /** Format: int64 */
            requested_at: number;
            version_id: string;
        };
        MethodologyDefinition: {
            default_context?: components["schemas"]["MethodologyTaskContext"];
            name: string;
            neutral_starter: boolean;
            requirements: components["schemas"]["MethodologyRequirement"][];
            templates?: components["schemas"]["MethodologyTemplateDefinition"][];
        };
        MethodologyFieldSource: {
            field: string;
            version_ids: string[];
        };
        MethodologyImpact: {
            activation_mode: components["schemas"]["MethodologyActivationMode"];
            affected_tasks: string;
            diff: string[];
            id: string;
            pending_tasks: string;
            /** @description Unknown or changed semantics are potentially material. */
            potentially_material: boolean;
            retained_tasks: string;
            version_id: string;
        };
        MethodologyReceipt: {
            actor_id: string;
            event_id: string;
            impact: components["schemas"]["MethodologyImpact"];
            kind: string;
            organisation_id: string;
            revision: string;
            version_id: string;
        };
        MethodologyRequirement: {
            /** @description Absent fields inherit. Empty arrays cannot erase inherited mandatory controls. */
            criteria?: components["schemas"]["MethodologyText"][] | null;
            evidence_checks?: components["schemas"]["MethodologyText"][] | null;
            id: string;
            label?: string | null;
            mandatory: boolean;
            populations?: components["schemas"]["MethodologyText"][] | null;
            ratings?: components["schemas"]["MethodologyText"][] | null;
            review_rules?: components["schemas"]["MethodologyText"][] | null;
            suitable_skills?: components["schemas"]["MethodologyVersionReference"][] | null;
            templates?: components["schemas"]["MethodologyVersionReference"][] | null;
        };
        MethodologyResolution: {
            context: components["schemas"]["MethodologyTaskContext"];
            issues: string[];
            /**
             * @description Up to 128 saved neutral contributors plus the built-in fallback, joined to
             *     requirement field and template source IDs.
             */
            neutral_source_version_ids: string[];
            reason: string;
            requirements: components["schemas"]["MethodologyResolvedRequirement"][];
            status: components["schemas"]["MethodologyResolutionStatus"];
            templates: components["schemas"]["MethodologyResolvedTemplate"][];
            version_ids: string[];
        };
        /** @enum {string} */
        MethodologyResolutionStatus: "resolved" | "neutral" | "incomplete" | "ambiguous" | "recalled";
        MethodologyResolvedRequirement: {
            field_sources: components["schemas"]["MethodologyFieldSource"][];
            requirement: components["schemas"]["MethodologyResolvedRequirementFields"];
            source_version_ids: string[];
        };
        MethodologyResolvedRequirementFields: {
            /** @description Resolved inherited values can combine up to 128 saved versions. */
            criteria?: components["schemas"]["MethodologyText"][] | null;
            evidence_checks?: components["schemas"]["MethodologyText"][] | null;
            id: string;
            label?: string | null;
            mandatory: boolean;
            populations?: components["schemas"]["MethodologyText"][] | null;
            ratings?: components["schemas"]["MethodologyText"][] | null;
            review_rules?: components["schemas"]["MethodologyText"][] | null;
            suitable_skills?: components["schemas"]["MethodologyVersionReference"][] | null;
            templates?: components["schemas"]["MethodologyVersionReference"][] | null;
        };
        MethodologyResolvedTemplate: {
            source_version_id: string;
            template: components["schemas"]["MethodologyTemplateDefinition"];
        };
        MethodologySnapshot: {
            /** @description Assignment metadata for current Admins; grants no access to audit work. */
            engagements: components["schemas"]["MembershipAssignmentOption"][];
            impacts: components["schemas"]["MethodologyImpact"][];
            organisation_id: string;
            revision: string;
            versions: components["schemas"]["MethodologyVersionRecord"][];
        };
        MethodologySource: {
            kind: components["schemas"]["MethodologySourceKind"];
            note?: null | components["schemas"]["MethodologyText"];
            reference?: null | components["schemas"]["MethodologyText"];
        };
        /** @enum {string} */
        MethodologySourceKind: "authored" | "imported_proposal" | "neutral_starter";
        MethodologyTaskContext: {
            audit_area?: string | null;
            period_end?: string | null;
            /** @description Inclusive business date, YYYY-MM-DD. Both period dates are required together. */
            period_start?: string | null;
        };
        MethodologyTemplateDefinition: {
            id: string;
            name: string;
            sections: components["schemas"]["MethodologyTemplateSection"][];
            version: string;
        };
        /** @description Preserved Unicode prose containing at least one character outside Unicode White_Space; at most 2000 Unicode characters. LF, CR and tab are allowed; all other control characters are refused. Indentation, line endings, trailing whitespace and U+FEFF are preserved exactly. */
        MethodologyTemplateProse: string;
        MethodologyTemplateSection: {
            content: components["schemas"]["MethodologyTemplateProse"];
            id: string;
            required: boolean;
            title: string;
        };
        /** @description Nonempty, already-trimmed Unicode text without control characters; at most 2000 Unicode characters. */
        MethodologyText: string;
        MethodologyVersionRecord: {
            actor_id: string;
            command: components["schemas"]["SaveMethodologyRequest"];
            id: string;
            recalled: boolean;
            revision: string;
            /** Format: int64 */
            saved_at: number;
        };
        MethodologyVersionReference: {
            id: string;
            version: string;
        };
        ObservationHistoryResponse: {
            attempt_id: string;
            /** @description A recorded source fact. Unknown or Accepted proves neither completion nor absence. */
            fact: components["schemas"]["SourceFactResponse"];
            id: string;
            recorded_at: string;
            source: components["schemas"]["ObservationSourceResponse"];
        };
        /** @enum {string} */
        ObservationSourceResponse: "dispatch" | "reconciliation";
        OperationDecisionRequest: {
            /** @description False records an exact refusal; true cannot override a hard prohibition. */
            allow: boolean;
            expected_revision: string;
            /** @description Decision expiry cannot exceed request expiry. Positive Unix seconds as decimal text. */
            expires_at: string;
            key: string;
            /** @description The complete request read and reviewed by this actor. Any material change refuses. */
            request: components["schemas"]["CanonicalOperationRequest"];
        };
        OperationDecisionResponse: {
            actor_id: string;
            allowed: boolean;
            expected_revision: string;
            expires_at: string;
            id: string;
            operation_id: string;
            request_digest: string;
        };
        OperationHistoryResponse: {
            /** @description Exclusive attempt ID; each history collection has its own continuation. */
            attempt_next_cursor: string | null;
            attempts: components["schemas"]["AttemptHistoryResponse"][];
            /** @description Exclusive decision ID; null means this fresh page exhausted that collection. */
            decision_next_cursor: string | null;
            /** @description Immutable decisions in ID order, including the persisted decider and exact expiry. */
            decisions: components["schemas"]["DecisionHistoryResponse"][];
            /** @description Exclusive observation ID. Restart from the first page to discover new records. */
            observation_next_cursor: string | null;
            observations: components["schemas"]["ObservationHistoryResponse"][];
            operation_id: string;
        };
        OperationResponse: {
            /** @description Immutable producing actor; the reading or deciding actor does not replace it. */
            actor_id: string;
            cycle_id: string;
            /** @description Immutable producing Task epoch; methodology history identifies its exact criteria. */
            execution_epoch: string;
            id: string;
            /** @description Exact immutable Task methodology binding used by the producer. */
            methodology_binding_id: string;
            request: components["schemas"]["CanonicalOperationRequest"];
            request_digest: string;
            revision: string;
            /** @description Provider acceptance is distinct from a completed effect; possible dispatch remains uncertain. */
            state: components["schemas"]["OperationStateResponse"];
            task_id: string;
        };
        /** @enum {string} */
        OperationStateResponse: "needs_decision" | "ready" | "possibly_dispatched" | "accepted" | "completed" | "absent" | "revoked";
        OperationsResponse: {
            /** @description Exclusive operation ID; null means no further rows for this exact Task. */
            next_cursor: string | null;
            operations: components["schemas"]["OperationResponse"][];
        };
        PermissionRevocationRequest: {
            expected_version: string;
            key: string;
            kind: components["schemas"]["PolicyKindRequest"];
        };
        PermissionRevocationResponse: {
            kind: components["schemas"]["PolicyKindRequest"];
            subject_id: string;
            version: string;
        };
        /** @enum {string} */
        PolicyKindRequest: "organisation" | "engagement" | "member" | "account" | "task" | "delegation";
        PreviewInvitationRequest: {
            secret: components["schemas"]["MembershipInvitationSecret"];
        };
        /** @enum {string} */
        PurposeRequest: "live_inspection" | "test_workflows" | "audit_coordination";
        RecallMethodologyRequest: {
            expected_revision: string;
            key: string;
            reason: components["schemas"]["MethodologyText"];
            version_id: string;
        };
        /** @enum {string} */
        ReceiptStatusResponse: "received";
        RevokeInvitationRequest: {
            expected_version: components["schemas"]["MembershipVersion"];
            invitation_id: components["schemas"]["MembershipIdentifier"];
            key: components["schemas"]["MembershipIdentifier"];
        };
        SaveMemberRequest: {
            active: boolean;
            actor_id: components["schemas"]["MembershipIdentifier"];
            /** @default replace */
            assignment_mode: components["schemas"]["MembershipAssignmentMode"];
            assignments: components["schemas"]["MembershipAssignmentChange"][];
            expected_version: components["schemas"]["MembershipVersion"];
            /**
             * Format: int64
             * @description Unix seconds through 9999-12-31T23:59:59Z; null explicitly clears membership expiry.
             */
            expires_at: number | null;
            key: components["schemas"]["MembershipIdentifier"];
            /** @description Unique application roles; an active membership must have at least one. */
            roles: components["schemas"]["MembershipRole"][];
        };
        SaveMethodologyRequest: {
            activation: components["schemas"]["MethodologyActivation"];
            applicability: components["schemas"]["MethodologyApplicability"];
            assignment: components["schemas"]["MethodologyAssignmentScope"];
            definition: components["schemas"]["MethodologyDefinition"];
            /** @description Canonical decimal revision, bounded by 9223372036854775806 so a successor fits. */
            expected_revision: string;
            key: string;
            source: components["schemas"]["MethodologySource"];
            supersedes?: string | null;
            undo_of?: string | null;
        };
        ScopeResponse: {
            client_id: string;
            engagement_id: string;
            organisation_id: string;
        };
        SelectSkillRequest: {
            expected_catalog_revision: string;
            expected_execution_epoch: string;
            expected_methodology_binding_id: string;
            expected_selection_revision: string;
            key: string;
            reason: string;
            version_id: string;
        };
        /** @enum {string} */
        Service: "api" | "worker";
        SessionResponse: {
            csrf_token: string;
            identity: components["schemas"]["IdentityResponse"];
        };
        /** @enum {string} */
        SkillAssignmentKind: "client" | "engagement";
        SkillAssignmentPage: {
            clients: components["schemas"]["SkillClientAssignmentOption"][];
            engagements: components["schemas"]["MembershipAssignmentOption"][];
            next_after?: string | null;
        };
        SkillCandidate: {
            inspection: components["schemas"]["SkillInspection"];
            version: components["schemas"]["SkillVersion"];
        };
        SkillCapabilityBound: {
            accepted: boolean;
            delegation_depth?: number | null;
            kind: components["schemas"]["SkillCapabilityBoundKind"];
        };
        /** @enum {string} */
        SkillCapabilityBoundKind: "organisation" | "engagement" | "member" | "account" | "task" | "delegation";
        /** @enum {string} */
        SkillCapabilityStatus: "unavailable" | "forbidden" | "compatible_needs_exact_details";
        SkillCatalogReceipt: {
            actor_id: string;
            affected_selections: string;
            event_id: string;
            organisation_id: string;
            revision: string;
            status: components["schemas"]["SkillStatus"];
            version_id: string;
        };
        SkillCatalogSnapshot: {
            organisation_id: string;
            revision: string;
            versions: components["schemas"]["SkillVersion"][];
        };
        SkillClientAssignmentOption: {
            client_id: string;
            client_name: string;
        };
        /** @enum {string} */
        SkillEligibilityStatus: "eligible" | "unavailable" | "forbidden" | "disabled" | "recalled" | "inapplicable" | "methodology_blocked" | "task_blocked";
        SkillImpactCursor: {
            revision: string;
            task_id: string;
        };
        SkillInput: {
            id: string;
            label: string;
            required: boolean;
        };
        SkillInspection: {
            authority_actor_id?: string | null;
            catalog_revision: string;
            dependency_fingerprint: string;
            digest: string;
            execution_epoch: string;
            methodology_binding_id: string;
            needs: components["schemas"]["SkillNeedInspection"][];
            /** Format: int64 */
            observed_at: number;
            /** @description Server-owned explanation, at most 256 UTF-8 bytes. */
            reason: string;
            skill_id: string;
            skill_version: string;
            status: components["schemas"]["SkillEligibilityStatus"];
            version_id: string;
        };
        SkillManifest: {
            description: string;
            id: string;
            inputs: components["schemas"]["SkillInput"][];
            method_version_ids: string[];
            name: string;
            needs: components["schemas"]["SkillNeed"][];
            outputs: string[];
            resources: components["schemas"]["SkillResource"][];
            /** Format: int32 */
            schema_version: number;
            source: components["schemas"]["SkillSource"];
            version: string;
        };
        SkillNeed: {
            account_id?: string | null;
            attachment_classifications: string[];
            destination?: string | null;
            environment_id?: string | null;
            id: string;
            recipients: string[];
            requires_attachments: boolean;
            resource_id?: string | null;
            tool: components["schemas"]["SkillTool"];
        };
        SkillNeedInspection: {
            blocking_bound?: null | components["schemas"]["SkillCapabilityBound"];
            id: string;
            /** @description Server-owned explanation, at most 256 UTF-8 bytes. */
            reason: string;
            /** Format: int64 */
            refresh_at?: number | null;
            status: components["schemas"]["SkillCapabilityStatus"];
            tool: components["schemas"]["SkillTool"];
        };
        SkillResource: {
            /**
             * @description Exact UTF-8 resource bytes: 32 KiB per resource and 128 KiB in aggregate.
             *     Nonempty under Unicode White_Space; only LF, CR and tab controls allowed.
             *     U+FEFF, indentation and line endings are preserved; scripts remain inert.
             */
            content: string;
            id: string;
            kind: components["schemas"]["SkillResourceKind"];
        };
        SkillResourceDigest: {
            digest: string;
            id: string;
        };
        /** @enum {string} */
        SkillResourceKind: "text" | "script";
        SkillSelection: {
            authority_actor_id?: string | null;
            catalog_revision: string;
            dependency_fingerprint: string;
            digest: string;
            execution_epoch: string;
            id: string;
            methodology: components["schemas"]["MethodologyBinding"];
            reason: string;
            revision: string;
            /** Format: int64 */
            selected_at: number;
            selector_id: string;
            skill_id: string;
            skill_version: string;
            task_id: string;
            version_id: string;
        };
        SkillSelectionImpact: {
            catalog_revision: string;
            digest: string;
            execution_epoch: string;
            methodology_binding_id: string;
            /** Format: int64 */
            selected_at: number;
            selection_id: string;
            selection_revision: string;
            selector_id: string;
            skill_id: string;
            skill_version: string;
            status: components["schemas"]["SkillStatus"];
            status_revision: string;
            task_id: string;
            version_id: string;
        };
        SkillSelectionImpactPage: {
            client_id: string;
            engagement_id: string;
            next_after?: null | components["schemas"]["SkillImpactCursor"];
            organisation_id: string;
            selections: components["schemas"]["SkillSelectionImpact"][];
            version_id?: string | null;
        };
        SkillSelectionView: {
            current: components["schemas"]["SkillInspection"];
            selection: components["schemas"]["SkillSelection"];
        };
        SkillSource: {
            license: string;
            reference: string;
            revision: string;
        };
        /** @enum {string} */
        SkillStatus: "enabled" | "disabled" | "recalled";
        SkillStatusEvent: {
            actor_id: string;
            event_id: string;
            reason?: string | null;
            /** Format: int64 */
            recorded_at: number;
            revision: string;
            status: components["schemas"]["SkillStatus"];
        };
        SkillStatusHistory: {
            events: components["schemas"]["SkillStatusEvent"][];
            next_before_revision?: string | null;
            version_id: string;
        };
        /** @enum {string} */
        SkillTool: "live_read_v1" | "test_read_v1" | "test_write_v1" | "test_send_v1" | "audit_read_v1" | "audit_write_v1" | "audit_send_v1" | "analysis_v1";
        SkillVersion: {
            actor_id: string;
            command: components["schemas"]["InstallSkillRequest"];
            digest: string;
            id: string;
            /** Format: int64 */
            installed_at: number;
            resource_digests: components["schemas"]["SkillResourceDigest"][];
            revision: string;
            status: components["schemas"]["SkillStatus"];
            status_event: components["schemas"]["SkillStatusEvent"];
            status_revision: string;
        };
        /** @enum {string} */
        SourceFactResponse: "unknown" | "accepted" | "completed" | "authoritatively_absent";
        TaskCommandRequest: {
            /**
             * @description Exact retained text, at most 4000 UTF-8 bytes. Required only for Create and Guide.
             *     Must contain non-whitespace; control characters other than LF, CR and tab are refused.
             */
            content?: string | null;
            context?: null | components["schemas"]["MethodologyTaskContext"];
            cycle_id?: string | null;
            /** @description Author and composite scope bind this key. Identical retries return the original receipt. */
            key: string;
            kind: components["schemas"]["CommandKindRequest"];
            /** @description Required together with cycle_id except for Create, which requires both absent/null. */
            task_id?: string | null;
        };
        TaskEventResponse: {
            command_id: string | null;
            cursor: string;
            cycle_id: string;
            /** @description Fixed event category, including received and applied. No content or capability is included. */
            kind: string;
            task_id: string;
        };
        TaskEventsResponse: {
            events: components["schemas"]["TaskEventResponse"][];
            /** @description Last returned cursor, or the input cursor on an empty page. Poll again from this value. */
            next_cursor: string;
        };
        TaskMethodologyResponse: {
            current: components["schemas"]["MethodologyBinding"];
            history: components["schemas"]["MethodologyBinding"][];
            notices: components["schemas"]["MethodologyBindingNotice"][];
            pending?: null | components["schemas"]["MethodologyBindingChange"];
            recalled: boolean;
            task_id: string;
        };
        TaskResponse: {
            /** @description Accountable human identity, distinct from worker ownership. */
            accountable_actor: string;
            /** @description Current public label of the accountable human, independent of recent message pages. */
            accountable_label: string;
            cessation: components["schemas"]["CessationResponse"];
            cycle_id: string;
            execution_epoch: string;
            id: string;
            intent_revision: string;
            objective: string;
            revision: string;
            /** @description Desired control/work state; Paused/Stopped require separate observed cessation. */
            state: components["schemas"]["TaskStateResponse"];
            /** @description Retained plain text; no model understanding or audit result is asserted. */
            working_brief: string;
        };
        TaskSkillsResponse: {
            candidates: components["schemas"]["SkillCandidate"][];
            catalog_revision: string;
            execution_epoch: string;
            methodology_binding_id: string;
            /** Format: int64 */
            observed_at: number;
            selection_revision: string;
            selections: components["schemas"]["SkillSelectionView"][];
            task_id: string;
        };
        /** @enum {string} */
        TaskStateResponse: "ready" | "running" | "paused" | "stopped" | "waiting";
        TasksResponse: {
            /** @description Pass this Task ID as after_task_id; null means no further current Tasks. */
            next_cursor: string | null;
            /** @description Current projection ordered by Task ID; open known IDs independently of this page. */
            tasks: components["schemas"]["TaskResponse"][];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    callback: {
        parameters: {
            query: {
                /** @description Exact one-use state from the current login attempt */
                state: string;
                /** @description One-use provider authorization code; required unless error is present */
                code?: string;
                /** @description Provider denial code; never reflected to clients */
                error?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Verified success rotates session; failure returns only fixed sign-in status to configured app. Clear only matching consumed binding. */
            303: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid response when no application origin is configured */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Whole-request deadline exceeded */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Redirect to trusted OIDC sign-in with one-use state and PKCE */
            303: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Outstanding sign-in capacity reached; try again later */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                    "text/html": string;
                };
            };
            /** @description Recoverable sign-in failure; native browser navigation receives an HTML return link */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                    "text/html": string;
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header: {
                /** @description Exactly the configured HTTPS application origin, supplied by the browser */
                Origin: string;
                /** @description Current session-bound CSRF token from GET /auth/session */
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Server session deleted and cookie expired */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    session: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    list: {
        parameters: {
            query?: {
                /** @description Supply all three cursor fields together */
                after_organisation_id?: string;
                after_client_id?: string;
                after_engagement_id?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Freshly authorized page, ordered by complete scope identity */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EngagementsResponse"];
                };
            };
            /** @description Incomplete or invalid cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    open: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Explicit scope opened independently of chooser page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EngagementResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_conversation: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One consistent current snapshot, bounded messages and Tasks with explicit page continuations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationSnapshotResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_conversation_events: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Last delivered decimal cursor or snapshot watermark */
                after: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Finite ordered invalidation page; explicit resync for gaps or replay overflow */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationFeedResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_conversation_history: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Snapshot watermark bounding retained Received and Applied facts */
                through: string;
                /** @description Exclusive Received cursor; omitted returns latest page through watermark */
                before?: string;
                /** @description Optional exact Task history */
                task_id?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationHistoryResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Requested watermark is ahead of retained history; resnapshot */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    list_evidence: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Last examined C-ordered candidate; restart without a cursor when q changes */
                after?: string;
                /** @description Literal substring of filename or attributed source fields after context-independent per-scalar Unicode lowercase; no normalization or full case folding. At most 200 UTF-8 bytes after Rust Unicode whitespace trim, controls refused and FEFF preserved. No original-content search. */
                q?: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description At most 50 matches from at most 256 examined current-scope candidates. Partial empty pages retain continuation; no page proves document meaning or source completeness. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidencePageResponse"];
                };
            };
            /** @description evidence_invalid: shorten the search to 200 UTF-8 bytes, remove control characters or restart with a valid cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    recover_evidence_reservations: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                after?: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owner-only incomplete reservations under current scope */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceReservationPageResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reserve_evidence: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvidenceReservationRequest"];
            };
        };
        responses: {
            /** @description Original immutable reservation, including exact retries */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceReservationResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Changed retry conflicts, or evidence_reservation_limit: 100 incomplete reservations for this actor/scope; finish an existing reservation to free a slot. No automatic expiry or abandonment is available. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    upload_evidence: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                reservation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": components["schemas"]["EvidenceBinary"];
            };
        };
        responses: {
            /** @description Independently verified original registered, or identical receipt replay */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    inspect_evidence: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                evidence_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    download_evidence: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                evidence_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authenticated verified original; attachment, no-store, nosniff, no-referrer */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": components["schemas"]["EvidenceBinary"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    preview_evidence: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                evidence_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Inert valid plain UTF-8 only; at most 64 KiB and 100 lines */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidencePreviewResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_source_status: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                evidence_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeSourceStatus"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_recover: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                evidence_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeRecoveryRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_verify_source: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                evidence_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeSourceVerificationRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeVerificationResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_excerpt: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeCaptureExcerpt"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    list_operations: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Exact Task whose operation history is requested */
                task_id: string;
                /** @description Exclusive operation ID from next_cursor */
                after_operation_id?: string;
            };
            header?: {
                /** @description Optional current session-bound CSRF read precondition; mismatch refuses without changing cookies */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationsResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; refresh composed reads without replacing the cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_operation: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                /** @description Optional current session-bound CSRF read precondition; mismatch refuses without changing cookies */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; refresh composed reads without replacing the cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    decide_operation: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                /** @description Exact configured HTTPS application origin */
                Origin: string;
                /** @description Current session-bound token */
                "X-CSRF-Token": string;
                /** @description Required refusal fence for the current session actor; never supplies author authority */
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OperationDecisionRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationDecisionResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_operation_history: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Exclusive decision ID from decision_next_cursor */
                after_decision_id?: string;
                /** @description Exclusive attempt ID from attempt_next_cursor */
                after_attempt_id?: string;
                /** @description Exclusive observation ID from observation_next_cursor */
                after_observation_id?: string;
            };
            header?: {
                /** @description Optional current session-bound CSRF read precondition; mismatch refuses without changing cookies */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Fresh authenticated history: up to50 immutable records per independent collection, ordered by ID; restart pages to discover newly recorded facts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationHistoryResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; refresh reads without replacing the cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    revoke_permission: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                /** @description Exact configured HTTPS application origin */
                Origin: string;
                /** @description Current session-bound token */
                "X-CSRF-Token": string;
                /** @description Required refusal fence for the current session actor; never supplies author authority */
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                authority_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PermissionRevocationRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PermissionRevocationResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_selection_impact: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Omit to list selections of currently disabled or recalled versions */
                version_id?: string;
                /** @description Cursor pair: both task and revision are required */
                after_task_id?: string;
                after_revision?: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillSelectionImpactPage"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    admit_task_command: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                /** @description Exact configured HTTPS application origin */
                Origin: string;
                /** @description Current session-bound token */
                "X-CSRF-Token": string;
                /** @description Optional additional refusal fence: expected current actor, never author authority */
                "X-Expected-Actor"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskCommandRequest"];
            };
        };
        responses: {
            /** @description Durable immutable Received receipt for Create, Resume or Continue; identical retry returns the original */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandReceiptResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    admit_task_control: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                /** @description Exact configured HTTPS application origin */
                Origin: string;
                /** @description Current session-bound token */
                "X-CSRF-Token": string;
                /** @description Optional additional refusal fence: expected current actor, never author authority */
                "X-Expected-Actor"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskCommandRequest"];
            };
        };
        responses: {
            /** @description Reserved admission/authentication for Guide, Pause and Stop; Received is not proof of cessation */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandReceiptResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    list_task_events: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Decimal durable cursor; omitted starts at zero */
                after?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description At most 100 commit-ordered metadata events; repeat from next_cursor to drain/reconnect */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskEventsResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    list_tasks: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Exclusive Task ID cursor from next_cursor */
                after_task_id?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TasksResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_task: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed; compose fresh reads without replacing the current cookie */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_inspect: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description Exclusive last-disclosed record or publication ID in C order; omitted starts at the first candidate. Use next_after unchanged. No cursor is disclosed when no eligible item is returned. */
                after?: string;
                /** @description Case-insensitive Unicode lowercase substring match on authorized, applicable record text, without trimming. Empty text matches any eligible record. At most 200 Unicode scalar values; C0/C1 controls are refused. */
                text?: string;
                /** @description False by default. True includes authorized inactive history; it never bypasses current source authority or period applicability. */
                include_inactive?: boolean;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgePage"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_mutate: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                task_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeCommand"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_exact: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
                record_id: string;
                revision: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeView"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_verify: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                task_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeVerificationRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeVerificationResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    task_methodology: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskMethodologyResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_discover: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskSkillsResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_select: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                task_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SelectSkillRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillSelectionView"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_current_use: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
                selection_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillSelectionView"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Process is serving; does not assert database readiness */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    ready: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Runtime role and exact schema verified */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            /** @description Database or schema unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    knowledge_preference: {
        parameters: {
            query?: never;
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgePreferenceSnapshot"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_mutate_preference: {
        parameters: {
            query?: never;
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgePreferenceCommand"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_observe_layout: {
        parameters: {
            query?: never;
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgeObserveLayout"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgePreferenceSnapshot"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    knowledge_verify_preference: {
        parameters: {
            query?: never;
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KnowledgePreferenceVerificationRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeVerificationResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    membership_accept_invitation: {
        parameters: {
            query?: never;
            header: {
                /** @description Additional current session refusal fence */
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": components["schemas"]["MembershipIdentifier"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptInvitationRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipReceipt"];
                };
            };
            /** @description Invalid membership command; unknown fields, vocabulary and out-of-range values refuse without changes */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    membership_preview_invitation: {
        parameters: {
            query?: never;
            header: {
                Origin: string;
                "X-CSRF-Token": string;
                "X-Expected-Actor": components["schemas"]["MembershipIdentifier"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewInvitationRequest"];
            };
        };
        responses: {
            /** @description Current verified recipient's fixed invitation terms; grants no authority */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationPreviewResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    membership_organisations: {
        parameters: {
            query?: {
                after?: components["schemas"]["MembershipIdentifier"];
            };
            header?: {
                /** @description Additional current session refusal fence */
                "X-Expected-Session"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipOrganisations"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    membership_snapshot: {
        parameters: {
            query?: {
                members_after?: components["schemas"]["MembershipIdentifier"];
                invitations_after?: components["schemas"]["MembershipIdentifier"];
                engagements_after?: components["schemas"]["MembershipAssignmentCursor"];
            };
            header?: {
                /** @description Additional current session refusal fence */
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: components["schemas"]["MembershipIdentifier"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipSnapshot"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    membership_invite: {
        parameters: {
            query?: never;
            header: {
                /** @description Additional current session refusal fence */
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": components["schemas"]["MembershipIdentifier"];
            };
            path: {
                organisation_id: components["schemas"]["MembershipIdentifier"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InviteMemberRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipReceipt"];
                };
            };
            /** @description Invalid membership command; unknown fields, vocabulary and out-of-range values refuse without changes */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    membership_revoke_invitation: {
        parameters: {
            query?: never;
            header: {
                /** @description Additional current session refusal fence */
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": components["schemas"]["MembershipIdentifier"];
            };
            path: {
                organisation_id: components["schemas"]["MembershipIdentifier"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RevokeInvitationRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    membership_save_member: {
        parameters: {
            query?: never;
            header: {
                /** @description Additional current session refusal fence */
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": components["schemas"]["MembershipIdentifier"];
            };
            path: {
                organisation_id: components["schemas"]["MembershipIdentifier"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveMemberRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipReceipt"];
                };
            };
            /** @description Invalid membership command; unknown fields, vocabulary and out-of-range values refuse without changes */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    membership_member_assignments: {
        parameters: {
            query?: {
                after?: components["schemas"]["MembershipAssignmentCursor"];
            };
            header?: {
                /** @description Additional current session refusal fence */
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: components["schemas"]["MembershipIdentifier"];
                actor_id: components["schemas"]["MembershipIdentifier"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current Admin's bounded page of effective member assignments */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipMemberAssignments"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    methodology_snapshot: {
        parameters: {
            query?: never;
            header?: {
                /** @description Additional current session refusal fence */
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MethodologySnapshot"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    recall_methodology: {
        parameters: {
            query?: never;
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecallMethodologyRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MethodologyReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    save_methodology: {
        parameters: {
            query?: never;
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveMethodologyRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MethodologyReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_catalog: {
        parameters: {
            query?: never;
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillCatalogSnapshot"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_assignment_options: {
        parameters: {
            query: {
                kind: components["schemas"]["SkillAssignmentKind"];
                /** @description Required for engagement choices; absent for client choices */
                client_id?: string;
                after?: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillAssignmentPage"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_install: {
        parameters: {
            query?: never;
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallSkillRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillCatalogReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_set_status: {
        parameters: {
            query?: never;
            header: {
                "X-Expected-Session"?: string | null;
                Origin: string;
                "X-CSRF-Token": string;
                /** @description Required exact current actor refusal fence */
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeSkillStatusRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillCatalogReceipt"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skills_status_history: {
        parameters: {
            query?: {
                before_revision?: string;
            };
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: string;
                version_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillStatusHistory"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
