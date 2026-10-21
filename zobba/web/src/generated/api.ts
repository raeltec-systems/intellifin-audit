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
    "/engagement-setups/organisations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_setup_organisations"];
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
    "/engagements/{engagement_id}/task-directions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["admit_task_direction"];
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
    "/engagements/{engagement_id}/task-questions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_task_questions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/task-questions/{question_id}/answer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["answer_task_question"];
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
    "/engagements/{engagement_id}/tasks/{task_id}/answers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_task_answers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/assessment/chains/{chain_id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_evaluation_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_exceptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions/{exception_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_exception"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/assessment/exceptions/{exception_id}/dispositions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["save_exception_disposition"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/assessment/populations/{population_id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_population_members"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/assessment/revisions/{revision_id}/dispositions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["save_disposition"];
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
    "/engagements/{engagement_id}/tasks/{task_id}/work": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_task_work"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/work-products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_task_work_products"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/exports/{export_id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["download_work_product_export"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["save_work_product_version"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_work_product_version"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}/claims/{block_id}/support": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_work_product_claim_support"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}/exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["export_work_product_version"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/engagements/{engagement_id}/work-products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_work_products"];
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
    "/methodology/organisations/{organisation_id}/proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["methodology_proposals"];
        put?: never;
        post: operations["propose_methodology"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/methodology/organisations/{organisation_id}/proposals/{proposal_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["methodology_proposal"];
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
    "/organisations/{organisation_id}/engagement-setups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_engagement_setups"];
        put?: never;
        post: operations["open_engagement_setup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/organisations/{organisation_id}/engagement-setups/{setup_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_engagement_setup"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/organisations/{organisation_id}/engagement-setups/{setup_id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["confirm_engagement_setup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/organisations/{organisation_id}/engagement-setups/{setup_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["answer_engagement_setup"];
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
        AnswerRequest: {
            /** @description Candidate Task IDs from the question; at least one. */
            selected: string[];
        };
        AnswerSegmentResponse: {
            /** @description Sources of this span, empty when the span is uncited. */
            sources: components["schemas"]["CitationSourceResponse"][];
            /** @description Exact segment text. Concatenating all segments gives the answer. */
            text: string;
        };
        /** @description One immutable assessment basis version. */
        AssessmentBasisResponse: {
            as_of: string | null;
            criteria: string[];
            execution_epoch: string;
            id: string;
            invocation_id: string;
            key: string;
            limitations: string[];
            methodology_binding_id: string;
            objective: string;
            /** @description Business period, civil dates (`YYYY-MM-DD`). */
            period_from: string;
            period_to: string;
            population: components["schemas"]["PopulationReferenceResponse"][];
            supersedes: string | null;
        };
        /**
         * @description One immutable criterion version. Its assertion is attributed agent text;
         *     its authority was checked by trusted code.
         */
        AssessmentCriterionResponse: {
            /** @description The applicability test, in platform words. */
            applicability: string | null;
            assertion: string;
            /** @description `method` or `original`. */
            authority_kind: string;
            /** @description Closed reason when the authority is unverified. */
            authority_reason: string | null;
            authority_source: null | components["schemas"]["CitationSourceResponse"];
            authority_text_sha256: string | null;
            authority_verified: boolean;
            /** Format: int32 */
            criterion_ordinal: number | null;
            effective_from: string | null;
            effective_to: string | null;
            execution_epoch: string;
            id: string;
            invocation_id: string;
            /** @description The agent's local name for it in its answer. */
            key: string;
            /** @description `rule` (decided by trusted code) or `judgment` (proposed by the model). */
            kind: string;
            methodology_binding_id: string;
            required_facts: components["schemas"]["RequiredFactResponse"][];
            /** @description Method authority: requirement and 0-based criterion ordinal. */
            requirement_id: string | null;
            rubric: string | null;
            /** @description The rule predicate, in platform words. */
            rule: string | null;
            supersedes: string | null;
        };
        /**
         * @description One immutable evaluation. Applicability, execution, verdict and origin
         *     are separate fields; only an applicable, completed evaluation on
         *     supported facts can be met or not_met.
         */
        AssessmentEvaluationResponse: {
            /** @description `applicable`, `not_applicable` or `unknown`. */
            applicability: string;
            basis_id: string;
            chain: null | components["schemas"]["ChainResponse"];
            criterion_id: string;
            /** @description `completed` or `failed`. */
            execution: string;
            execution_epoch: string;
            id: string;
            inputs: components["schemas"]["EvaluationInputResponse"][];
            invocation_id: string;
            judgment: null | components["schemas"]["JudgmentResponse"];
            methodology_binding_id: string;
            /** @description `deterministic` or `model_proposal`. */
            origin: string;
            output_digest: string;
            reason: string | null;
            subject: string;
            /** @description `met`, `not_met`, `undetermined`, or null (no verdict). */
            verdict: string | null;
        };
        /** @description One immutable typed fact observation and its verified sources. */
        AssessmentFactResponse: {
            basis_id: string;
            /** Format: int32 */
            candidates: number | null;
            execution_epoch: string;
            id: string;
            invocation_id: string;
            job_id: string | null;
            /** @description Exact decimal: digit-string mantissa and scale (no float). */
            mantissa: string | null;
            measure: string | null;
            /**
             * @description For a decimal: its currency or unit was found at, or beside, a
             *     verified source; otherwise it is only the agent's claim.
             */
            measure_grounded: boolean | null;
            methodology_binding_id: string;
            name: string;
            /** Format: int32 */
            offset_minutes: number | null;
            rule: string | null;
            /** Format: int32 */
            scale: number | null;
            sources: components["schemas"]["CitationSourceResponse"][];
            /** @description Exactly as stated (leading zeros kept). */
            subject: string;
            /** @description The subject was found at, or beside, a verified source of the value. */
            subject_grounded: boolean;
            subject_unit: string;
            /** @description `supported`, `unsupported` or `no_value`. */
            support: string;
            support_reason: string | null;
            /** @description Unavailable reason or ambiguous candidate count. */
            unavailable_reason: string | null;
            /** @description An instant in UTC; `value` keeps the source offset. */
            utc: string | null;
            /** @description Canonical value text (decimal `1250.00`, date, RFC 3339 instant). */
            value: string | null;
            /** @description A fact type, `unavailable` or `ambiguous`. */
            value_kind: string;
            /**
             * @description True when the fact states a value the viewer may not see: the value
             *     is read from its source quote, and none of its sources is an exact
             *     original the viewer may read now. The value fields are then null.
             */
            value_withheld: boolean;
        };
        AssessmentResponse: {
            /**
             * @description The Task's newest records of each kind, oldest first; earlier ones
             *     may be omitted (see the totals).
             */
            bases: components["schemas"]["AssessmentBasisResponse"][];
            criteria: components["schemas"]["AssessmentCriterionResponse"][];
            evaluations: components["schemas"]["AssessmentEvaluationResponse"][];
            facts: components["schemas"]["AssessmentFactResponse"][];
            /**
             * @description Story 24.2: population manifests, sample manifests and coverage
             *     summaries, newest of each kind (oldest first), with exact totals.
             */
            populations: components["schemas"]["CoveragePopulationResponse"][];
            samples: components["schemas"]["CoverageSampleResponse"][];
            summaries: components["schemas"]["CoverageSummaryResponse"][];
            total_bases: string;
            total_criteria: string;
            total_evaluations: string;
            total_facts: string;
            total_populations: string;
            total_samples: string;
            total_summaries: string;
        };
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
        /** @enum {string} */
        AttentionResponse: "awaiting_guidance" | "reconciliation_required" | "step_failed" | "cycle_bounded" | "method_question";
        /** @description An accepted brief revision. Received and applied are separate facts. */
        BriefRevisionResponse: {
            /**
             * Format: int32
             * @description Recorded step count of the cycle when applied; null until applied.
             */
            applied_boundary: number | null;
            applied_cursor: string | null;
            command_id: string;
            /** @description Retained plain text supplied by a person; no model understanding is asserted. */
            content: string;
            cycle_id: string;
            received_cursor: string;
            /** @description The later accepted revision that replaced this one. */
            superseded_by: string | null;
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
        /**
         * @description One page of a chain's history in revision order, with the exact number
         *     of its revisions and the facts the listed revisions read.
         */
        ChainHistoryResponse: {
            chain_id: string;
            entries: components["schemas"]["HistoryEntryResponse"][];
            facts: components["schemas"]["AssessmentFactResponse"][];
            head_id: string;
            /** @description The revision number after which the next page starts. */
            next_cursor: string | null;
            subject: string;
            total: string;
        };
        /** @description The current head of one evaluation chain and its review state. */
        ChainResponse: {
            applicability: string;
            basis_id: string;
            /** @description The head's closed causes (none for revision 1). */
            causes: string[];
            chain_id: string;
            criterion_id: string;
            disposition: null | components["schemas"]["DispositionResponse"];
            /**
             * @description An earlier revision of this chain was accepted (independent of this
             *     revision's own review state).
             */
            earlier_accepted: boolean;
            /** @description `deterministic`, `model_proposal` or `human`. */
            effective_origin: string;
            /** @description The verdict after the head's newest disposition. */
            effective_verdict: string | null;
            execution: string;
            head_id: string;
            origin: string;
            reason: string | null;
            /** @description `unreviewed`, `accepted`, `replaced` or `pending_reconsideration`. */
            review: string;
            revision: string;
            verdict: string | null;
        };
        ChangeSkillStatusRequest: {
            expected_revision: string;
            key: string;
            reason: string;
            status: components["schemas"]["SkillStatus"];
            version_id: string;
        };
        ChangesResponse: {
            added: string[];
            removed: string[];
            replaced: components["schemas"]["ReplacedFactResponse"][];
        };
        CitationSourceResponse: {
            /** Format: int64 */
            byte_end?: number | null;
            /**
             * Format: int64
             * @description Half-open byte range for a plain-text locator.
             */
            byte_start?: number | null;
            filename?: string | null;
            /** @description Human label of the locator (`Page 2`, `Sheet1!B4`). */
            location?: string | null;
            /** @description Canonical locator (`page:2`, `cell:Sheet1!B4`, `bytes:16-24`, ...). */
            locator?: string | null;
            /** @description Exact registered original the model cited. */
            original_id: string;
            /** @description The model's quoted text, at most 1000 UTF-8 bytes. */
            quote?: string | null;
            /**
             * @description False when the current viewer cannot read this original, or when
             *     verification did not establish the exact original. Its quote,
             *     filename, version, digest and location are then withheld.
             */
            readable: boolean;
            /**
             * @description Closed reason when unverified: `not_found_at_location`,
             *     `location_missing`, `source_unreadable` or `page_only`.
             */
            reason?: string | null;
            sha256?: string | null;
            verification: components["schemas"]["CitationVerificationResponse"];
            /** @description Exact storage version and SHA-256 for evidence navigation. */
            version?: string | null;
        };
        /** @enum {string} */
        CitationVerificationResponse: "verified" | "unverified" | "unchecked";
        CitedAnswerResponse: {
            invocation_id: string;
            /** @description Limitations the model stated about what it could not read. */
            limitations: string[];
            segments: components["schemas"]["AnswerSegmentResponse"][];
            /** @description The unchanged answer text. */
            text: string;
            /**
             * @description True when trusted verification of this answer could not be completed;
             *     every source is then `unchecked`.
             */
            verification_failed: boolean;
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
        /**
         * @description A durable context compaction record: a deterministic digest of recorded step
         *     facts (never a model summary, never evidence). The covered raw steps remain
         *     inspectable.
         */
        CompactionResponse: {
            /** @description Server time the record was made, in seconds since the Unix epoch. */
            created_at: string;
            /** @description SHA-256 of the canonical digest, reproducible from the database. */
            digest_sha256: string;
            estimated_tokens: string;
            /** Format: int32 */
            first_ordinal: number;
            /** Format: int32 */
            last_ordinal: number;
            omissions: components["schemas"]["OmissionResponse"][];
            /** Format: int32 */
            sequence: number;
            sources: components["schemas"]["CompactionSourceResponse"][];
        };
        /**
         * @description A knowledge revision an earlier compacted turn used, with its standing when
         *     the record was made.
         */
        CompactionSourceResponse: {
            id: string;
            revision: string;
            status: components["schemas"]["SourceStatusResponse"];
        };
        ConfirmSetupRequest: {
            key: string;
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
        /**
         * @description One immutable population manifest version. Trusted code read every row
         *     of the exact original; completeness and reconciliation are derived,
         *     never asserted by the model.
         */
        CoveragePopulationResponse: {
            basis_id: string;
            /** @description `complete` or `incomplete`. */
            completeness: string;
            control_source: null | components["schemas"]["CitationSourceResponse"];
            counts: components["schemas"]["PopulationCountsResponse"];
            /** @description The cited control count, verified at its location by trusted code. */
            declared_count: string | null;
            execution_epoch: string;
            /** @description The agent's statement; `false` always means absence is not proven. */
            exhaustive: boolean;
            /** @description Only when the viewer may read that exact original now. */
            filename: string | null;
            grain: string[];
            /** Format: int32 */
            header_row: number;
            id: string;
            /** @description `not_exhaustive`, `row_bound` or `count_mismatch` when incomplete. */
            incomplete_reason: string | null;
            invocation_id: string;
            job_id: string | null;
            key: string;
            /** Format: int32 */
            last_row: number;
            methodology_binding_id: string;
            /** @description Excel date or date-time cells (no time zone) read as UTC. */
            naive_date_times: string;
            original_id: string;
            original_sha256: string;
            period_column: string | null;
            period_rule: string | null;
            /** @description `matched`, `mismatch` or `not_declared`. */
            reconciliation: string;
            /** Format: int32 */
            rows_read: number;
            selection: string;
            sheet: string | null;
            subject_unit: string;
            supersedes: string | null;
            truncated: boolean;
            values: components["schemas"]["ValueColumnResponse"][];
        };
        /**
         * @description One immutable sample manifest version. Trusted code checked every
         *     selected key and recomputed a seeded selection. A sample says nothing
         *     about the items it did not select: there is no statistical inference.
         */
        CoverageSampleResponse: {
            algorithm: string | null;
            execution_epoch: string;
            id: string;
            invocation_id: string;
            justification: string;
            key: string;
            keys: string[];
            /** @description True when the selected keys (cell texts of the original) are withheld. */
            keys_withheld: boolean;
            /** @description `all_in_scope`, `judgmental` or `seeded_random`. */
            method: string;
            methodology_binding_id: string;
            population_id: string;
            seed: string | null;
            selected_count: string;
            /** Format: int32 */
            size: number;
            statistical_inference: boolean;
            strata: string;
            substitutions: components["schemas"]["SubstitutionResponse"][];
        };
        /** @description One immutable coverage summary version, recounted by the database. */
        CoverageSummaryResponse: {
            /** @description `subject_partition_v1`. */
            aggregation: string;
            basis_id: string;
            completeness: string;
            /**
             * @description A closed conclusion; never a pass on an incomplete population, a
             *     sample or zero applicable subjects.
             */
            conclusion: string;
            counts: components["schemas"]["PopulationCountsResponse"];
            criteria: components["schemas"]["CriterionCountsResponse"][];
            declared_count: string | null;
            execution_epoch: string;
            /** @description Criterion opportunities, never failing records. */
            failing_opportunities: string;
            failing_subjects: string;
            id: string;
            incomplete_reason: string | null;
            invocation_id: string;
            limitations: components["schemas"]["LimitationResponse"][];
            meets_every_applicable: string;
            methodology_binding_id: string;
            not_applicable_to_any: string;
            population_id: string;
            reconciliation: string;
            sample_id: string | null;
            /** @description The selected items a sample summary covers. */
            selected: string | null;
            statistical_inference: boolean;
            summary_sha256: string;
            unresolved_subjects: string;
        };
        /**
         * @description Exact opportunity counts of one criterion over the in-scope (or
         *     selected) subjects.
         */
        CriterionCountsResponse: {
            applicability_unknown: string;
            applicable: string;
            criterion_id: string;
            execution_failed: string;
            met: string;
            /**
             * @description Among `met`: unreviewed model proposals (24.1 judgments). They never
             *     show that no exception exists.
             */
            met_unreviewed: string;
            not_applicable: string;
            not_evaluated: string;
            not_met: string;
            undetermined: string;
            undetermined_by_reason: components["schemas"]["ReasonCountResponse"][];
        };
        DecisionHistoryResponse: {
            decision: components["schemas"]["OperationDecisionResponse"];
            /** @description Exact persisted decision key, scoped to the recorded actor and engagement. */
            key: string;
            /** @description Server recording time, positive Unix seconds as decimal text. */
            recorded_at: string;
        };
        /** @enum {string} */
        DirectionOutcome: "routed" | "asked";
        DirectionRequest: {
            /** @description Exact retained guidance text, at most 4000 UTF-8 bytes. */
            content: string;
            /** @description Author and scope bind this key. Identical retries return the original outcome. */
            key: string;
        };
        DirectionResponse: {
            outcome: components["schemas"]["DirectionOutcome"];
            question: null | components["schemas"]["RoutingQuestionResponse"];
            receipt: null | components["schemas"]["CommandReceiptResponse"];
        };
        DispositionCommandRequest: {
            /** @description `facts`, `rule`, `authority` or `scope`: exactly for needs_reconsideration. */
            concern?: string | null;
            /** @description Request key, idempotent per actor. */
            key: string;
            /** @description `accepted`, `replaced` or `needs_reconsideration`. */
            kind: string;
            /** @description 1–2,000 UTF-8 bytes. */
            rationale: string;
            references: components["schemas"]["DispositionReferenceRequest"][];
            /** @description `met`, `not_met` or `undetermined`: exactly for replaced. */
            verdict?: string | null;
        };
        /**
         * @description A refusal of a disposition. `head_id` names the current head of a
         *     superseded revision's chain; `index` names an unverified reference.
         */
        DispositionErrorResponse: {
            error: string;
            head_id: string | null;
            /** Format: int32 */
            index: number | null;
        };
        DispositionReferenceRequest: {
            /** @description An exact canonical locator (`cell:Sheet1!D7`, `bytes:16-24`, ...). */
            locator: string;
            original_id: string;
            /** @description The exact quoted text at that location. */
            quote: string;
        };
        /**
         * @description A person's disposition of one exact revision. It never changes the
         *     revision: `replaced` is a separate human verdict.
         */
        DispositionResponse: {
            actor_id: string;
            /** @description The person's public label, when known. */
            actor_label: string | null;
            chain_id: string;
            /** @description `facts`, `rule`, `authority` or `scope` (needs_reconsideration only). */
            concern: string | null;
            id: string;
            /** @description `accepted`, `replaced` or `needs_reconsideration`. */
            kind: string;
            /** @description The person's words (attributed data), at most 2,000 UTF-8 bytes. */
            rationale: string;
            recorded_us: string | null;
            /**
             * @description Verified evidence references; a quote is withheld from a viewer who
             *     cannot read its original now.
             */
            references: components["schemas"]["CitationSourceResponse"][];
            revision: string;
            /** @description The exact revision: the 24.1 evaluation (revision 1) or a revision. */
            revision_id: string;
            /** @description The person's verdict (replaced only). */
            verdict: string | null;
        };
        /** @description Counts per criterion the 24.2 summary does not carry. */
        EffectiveCriterionResponse: {
            criterion_id: string;
            human_replaced: string;
            pending_reconsideration: string;
            superseded: string;
            undisposed: string;
        };
        /** @description A closed limitation of an effective summary and its sentence. */
        EffectiveLimitationResponse: {
            code: string;
            count: string | null;
            text: string;
        };
        /**
         * @description An effective summary version: the 24.2 partition over current
         *     revisions and dispositions (its denominators are the 24.2 ones), with
         *     the exceptions of its own subjects under its basis's criterion lineages
         *     by derived status. The database recounted every number.
         */
        EffectiveSummaryResponse: {
            /** @description `effective_partition_v1`. */
            aggregation: string;
            /**
             * @description The effective conclusion: the summary's own conclusion, except that
             *     it is `inconclusive` instead of `no_exception_found` while an
             *     exception of its subjects is open.
             */
            conclusion: string;
            criteria: components["schemas"]["EffectiveCriterionResponse"][];
            effective_limitations: components["schemas"]["EffectiveLimitationResponse"][];
            /** @description Counts are lower bounds when false; the total is then not known. */
            exact: boolean;
            exceptions: components["schemas"]["ExceptionCountsResponse"];
            id: string;
            /**
             * @description The first 50 exceptions in (subject, criterion lineage, ID) byte
             *     order; `exceptions.total` is exact.
             */
            listed: components["schemas"]["ListedExceptionResponse"][];
            recorded_us: string | null;
            summary: components["schemas"]["CoverageSummaryResponse"];
            supersedes: string | null;
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
        EvaluationInputResponse: {
            digest: string;
            fact_id: string;
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
        /** @description Exact exception counts by derived status. */
        ExceptionCountsResponse: {
            closed_by_disposition: string;
            open: string;
            replaced_by_human_judgment: string;
            resolved_by_evidence: string;
            /** @description Distinct exception subjects (never more than the total). */
            subjects: string;
            total: string;
        };
        /**
         * @description One exception, one page of its occurrences (oldest first) and every
         *     disposition.
         */
        ExceptionDetailResponse: {
            dispositions: components["schemas"]["ExceptionDispositionResponse"][];
            exception: components["schemas"]["ExceptionResponse"];
            next_cursor: string | null;
            occurrences: components["schemas"]["OccurrenceResponse"][];
        };
        ExceptionDispositionCommandRequest: {
            /** @description Request key, idempotent per actor. */
            key: string;
            /** @description `closed` or `reopened`. */
            kind: string;
            /** @description 1–2,000 UTF-8 bytes. */
            rationale: string;
            /** @description `closed` cites at least one. */
            references: components["schemas"]["DispositionReferenceRequest"][];
        };
        /**
         * @description A refusal of an exception disposition. `index` names an unverified
         *     reference.
         */
        ExceptionDispositionErrorResponse: {
            error: string;
            /** Format: int32 */
            index: number | null;
        };
        /**
         * @description A person's disposition of one exception. It never changes an occurrence,
         *     a revision or a verdict.
         */
        ExceptionDispositionResponse: {
            actor_id: string;
            /** @description The person's public label, when known. */
            actor_label: string | null;
            exception_id: string;
            id: string;
            /** @description `closed` or `reopened`. */
            kind: string;
            /** @description The person's words (attributed data), at most 2,000 UTF-8 bytes. */
            rationale: string;
            recorded_us: string | null;
            /**
             * @description Verified evidence references; a quote is withheld from a viewer who
             *     cannot read its original now.
             */
            references: components["schemas"]["CitationSourceResponse"][];
        };
        /** @description One exception of a Task with its derived status (never stored). */
        ExceptionResponse: {
            /** @description The criterion lineage (its first version's ID). */
            criterion_root: string;
            disposition: null | components["schemas"]["ExceptionDispositionResponse"];
            /** @description The exact number of its dispositions; at most 16 may be saved. */
            dispositions: string;
            first_source_id: string;
            /** @description The record its first occurrence names. */
            first_source_kind: string;
            id: string;
            /**
             * @description `not_met` while any current observation of its lineage and subject
             *     fails; otherwise `proposed_met` (an unreviewed model proposal would
             *     resolve it once accepted), `person_undetermined` (a person replaced
             *     the failing judgment with undetermined) or `not_observed`.
             */
            latest_observed: string;
            /** @description The exact number of its occurrences. */
            occurrences: string;
            recorded_us: string | null;
            /**
             * @description `open`, `resolved_by_evidence`, `replaced_by_human_judgment` or
             *     `closed_by_disposition`.
             */
            status: string;
            /**
             * @description What the status means, in words. An open exception the latest
             *     revision did not observe says that this is not evidence of
             *     remediation.
             */
            status_words: string;
            subject: string;
        };
        /**
         * @description One page of a Task's exceptions (50, C-ordered by subject, criterion
         *     lineage and ID), the exact counts by status over all of them, whether the
         *     viewer may close or reopen one, and the newest effective summaries.
         */
        ExceptionsResponse: {
            /** @description Exact counts over every exception of the Task, never over the page. */
            counts: components["schemas"]["ExceptionCountsResponse"];
            effective_summaries: components["schemas"]["EffectiveSummaryResponse"][];
            exceptions: components["schemas"]["ExceptionResponse"][];
            /** @description The viewer is an Audit manager or the Task's accountable person. */
            may_close: boolean;
            /** @description The `cursor` of the next page, when more exceptions follow. */
            next_cursor: string | null;
            /**
             * @description The sentence an open exception the latest revision did not observe
             *     carries.
             */
            not_remediation: string;
            total_effective_summaries: string;
        };
        HealthResponse: {
            /** Format: int32 */
            schema_version: number | null;
            service: components["schemas"]["Service"];
            status: components["schemas"]["HealthStatus"];
        };
        /** @enum {string} */
        HealthStatus: "live" | "ready" | "unavailable";
        /** @description One revision of a chain, unchanged since it was recorded. */
        HistoryEntryResponse: {
            applicability: string;
            basis_id: string;
            causes: string[];
            changes: components["schemas"]["ChangesResponse"];
            criterion_id: string;
            dispositions: components["schemas"]["DispositionResponse"][];
            execution: string;
            id: string;
            inputs: components["schemas"]["EvaluationInputResponse"][];
            invocation_id: string;
            judgment: null | components["schemas"]["JudgmentResponse"];
            origin: string;
            output_digest: string;
            predecessor_id: string | null;
            reason: string | null;
            recorded_us: string | null;
            revision: string;
            verdict: string | null;
        };
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
        /**
         * @description Zobba's own investigation record of its latest answered turn: method,
         *     skill, model and tool provenance. Separate from the working brief.
         */
        InvestigationRecordResponse: {
            catalogue_id: string;
            catalogue_revision: string;
            /**
             * Format: int32
             * @description Individually invalid answer requests and notes left out on decode.
             */
            discarded_requests: number;
            execution_epoch: string;
            /** Format: int32 */
            gaps: number;
            invocation_id: string;
            method_status: string;
            method_version_ids: string[];
            methodology_binding_id: string;
            model: string;
            /**
             * Format: int32
             * @description Skill, method version and tool entries beyond the record bound.
             */
            omitted_items: number;
            /**
             * Format: int32
             * @description Notes beyond the recorded bound, counted and not recorded.
             */
            omitted_notes: number;
            profile_id: string;
            profile_revision: string;
            provider: string;
            /** Format: int32 */
            questions: number;
            skills: components["schemas"]["UsedSkillResponse"][];
            /** Format: int32 */
            statements: number;
            tools: string[];
        };
        InvestigationResponse: {
            method_status: string;
            method_version_ids: string[];
            /** @description The Task's current binding and the exact method versions it resolves. */
            methodology_binding_id: string;
            /**
             * @description This cycle's newest method notes, in record order; earlier ones may be
             *     omitted (see `total_notes`).
             */
            notes: components["schemas"]["MethodNoteResponse"][];
            /**
             * Format: int32
             * @description Questions of the whole cycle with no guidance applied after their turn.
             */
            open_questions: number;
            record: null | components["schemas"]["InvestigationRecordResponse"];
            /**
             * @description This cycle's newest skill uses, in record order; earlier ones may be
             *     omitted (see `total_skills`).
             */
            skills: components["schemas"]["SkillUseResponse"][];
            /** @description Every method note recorded in this cycle. */
            total_notes: string;
            /** @description Every skill use recorded in this cycle. */
            total_skills: string;
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
        /**
         * @description A model's judgment of a judgment criterion, in words. Pending human
         *     disposition; there is no confidence score.
         */
        JudgmentResponse: {
            contrary: string[];
            rationale: string;
            supporting: string[];
            uncertainty: string;
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
        /** @description One closed limitation of a summary, in words beside its exact count. */
        LimitationResponse: {
            /**
             * @description `not_evaluated`, `judgment_not_recorded`, `unreviewed_model_judgments`,
             *     `sample_selected_only`, `scope_unknown`, `unkeyed_rows`,
             *     `period_not_checked` or `naive_date_times`.
             */
            code: string;
            count: string | null;
            criterion_id: string | null;
            text: string;
        };
        /** @description One listed exception of an effective summary. */
        ListedExceptionResponse: {
            criterion_root: string;
            id: string;
            latest_observed: string;
            status: string;
            subject: string;
        };
        /** @description One named cell of a member row. */
        MemberCellResponse: {
            column: string;
            /**
             * @description How the original stored it: `text`, `excel_date` or `excel_datetime`
             *     (an Excel date-time has no time zone).
             */
            kind: string;
            location: string | null;
            /** @description Display text; null when blank, over its bound, or withheld. */
            text: string | null;
        };
        /** @description One received row and what trusted code decided about it. */
        MemberResponse: {
            cells: components["schemas"]["MemberCellResponse"][];
            /** @description `in_scope`, `excluded`, `scope_unknown`, `duplicate_row` or `unkeyed`. */
            disposition: string;
            /**
             * Format: int32
             * @description For a duplicate row, the ordinal of the row it repeats.
             */
            duplicate_of: number | null;
            /**
             * Format: int32
             * @description 0-based order of receipt.
             */
            ordinal: number;
            reason: string | null;
            /**
             * Format: int32
             * @description 1-based row of the original.
             */
            row: number;
            /** @description The subject key (exact cell texts); null when unkeyed or withheld. */
            subject: string | null;
            values: components["schemas"]["MemberValueResponse"][];
        };
        /** @description One typed value of a member, re-parsed by trusted code. */
        MemberValueResponse: {
            measure: string | null;
            measure_grounded: boolean | null;
            name: string;
            /** @description `value`, `missing` or `unsupported` (does not parse under its rule). */
            state: string;
            value: string | null;
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
        /**
         * @description A gap, contextual question or Zobba statement about one requirement. A
         *     statement points at answer segments whose citations support it; nothing
         *     marks a requirement complete.
         */
        MethodNoteResponse: {
            execution_epoch: string;
            invocation_id: string;
            /** @description `gap`, `question` or `statement`. */
            kind: string;
            methodology_binding_id: string;
            /**
             * @description For a question: true while no guidance has been applied after its
             *     turn. Always false for gaps and statements.
             */
            open: boolean;
            /** Format: int32 */
            ordinal: number;
            reason: string | null;
            requirement_id: string | null;
            segments: number[];
            /** @description `agent` (Zobba's answer) or `platform` (a deterministic fact). */
            source: string;
            /** @description Retained text as written, shown as attributed data. */
            text: string;
        };
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
        MethodologyProposalList: {
            proposals: components["schemas"]["MethodologyProposalResponse"][];
        };
        MethodologyProposalResponse: {
            actor_id: string;
            citations: components["schemas"]["ProposalCitation"][];
            conflicts: components["schemas"]["ProposalConflictResponse"][];
            definition?: null | components["schemas"]["MethodologyDefinition"];
            disclosure: components["schemas"]["ProposalDisclosureResponse"];
            id: string;
            key: string;
            missing_criteria: string[];
            reason?: string | null;
            source?: null | components["schemas"]["MethodologySource"];
            status: components["schemas"]["ProposalStatus"];
            unverified: string[];
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
        /** @description One occurrence of an exception: a not_met result. */
        OccurrenceResponse: {
            basis_id: string;
            criterion_id: string;
            /** @description The digests of the inputs it read. */
            evidence: string[];
            member_ordinal: string | null;
            /** @description `deterministic`, `model_proposal` or `human`. */
            origin: string;
            population_id: string | null;
            /** @description Its place in the exception's order (commit order, never clock time). */
            seq: string;
            source_id: string;
            /** @description `evaluation`, `revision`, `opportunity` or `disposition`. */
            source_kind: string;
            source_us: string;
        };
        /**
         * @description Why material was left out of a request. A category never means absence.
         * @enum {string}
         */
        OmissionCategoryResponse: "steps_compacted" | "digests_omitted" | "knowledge_budget" | "knowledge_unusable" | "stale_sources" | "stale_content" | "skills_budget";
        /** @description Count of material left out by category. An omission never means absence. */
        OmissionResponse: {
            category: components["schemas"]["OmissionCategoryResponse"];
            /** Format: int32 */
            count: number;
        };
        OpenSetupRequest: {
            /** @description Actor and organisation bind this key; an identical retry returns the original setup. */
            key: string;
            /** @description The first objective, at most 4000 UTF-8 bytes. */
            objective: string;
        };
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
        /**
         * @description Exact counts of a population's received rows. When the population is
         *     incomplete each is a lower bound ("at least N found").
         */
        PopulationCountsResponse: {
            distinct_subjects: string;
            duplicate_rows: string;
            excluded_out_of_period: string;
            in_scope: string;
            received_rows: string;
            scope_unknown_conflicting_duplicate: string;
            scope_unknown_period_missing: string;
            scope_unknown_period_unparsed: string;
            unkeyed: string;
        };
        PopulationMembersResponse: {
            /** @description The disposition filter, or null for every member. */
            disposition: string | null;
            members: components["schemas"]["MemberResponse"][];
            /**
             * @description Opaque cursor of the next page (members are C-ordered by key, then
             *     receipt order), when there is one.
             */
            next_cursor: string | null;
            population: components["schemas"]["CoveragePopulationResponse"];
            /** @description The exact count of members matching the filter. */
            total: string;
            /**
             * @description True when cell texts are withheld (the viewer may not read the exact
             *     original now); dispositions, row numbers and counts are still shown.
             */
            values_withheld: boolean;
        };
        /** @description A population or sample reference to a registered original. */
        PopulationReferenceResponse: {
            /** @description The filename, only when the viewer may read that exact original now. */
            filename: string | null;
            original_id: string;
            selection: string;
            /**
             * @description The registered digest pinned when the basis was recorded; null when it
             *     was not a registered original.
             */
            sha256: string | null;
            unit: string;
        };
        PreviewInvitationRequest: {
            secret: components["schemas"]["MembershipInvitationSecret"];
        };
        ProposalCitation: {
            field: string;
            location: components["schemas"]["ProposalLocation"];
            quote: string;
        };
        ProposalConflictResponse: {
            location: components["schemas"]["ProposalLocation"];
            quote: string;
            text: string;
        };
        ProposalDisclosureResponse: {
            document_sha256: string;
            document_size: string;
            filename: string;
            media_type: string;
            model: string;
            profile_id: string;
            profile_revision: string;
            provider: string;
        };
        ProposalLocation: {
            end: string;
            line: string;
            /** @description UTF-8 byte offsets of the exact quote, and its 1-based line. */
            start: string;
        };
        /** @enum {string} */
        ProposalStatus: "drafted" | "failed" | "in_progress" | "uncertain";
        ProposeMethodologyRequest: {
            filename: string;
            key: string;
            /** @description Plain UTF-8 documents only; other formats are refused, not guessed. */
            media_type: string;
            profile_id: string;
            /**
             * @description The exact document text: at most 200,000 UTF-8 bytes (not
             *     characters). A longer document is refused as `document_too_large`.
             */
            text: string;
        };
        /** @enum {string} */
        PurposeRequest: "live_inspection" | "test_workflows" | "audit_coordination";
        ReasonCountResponse: {
            count: string;
            reason: string;
        };
        RecallMethodologyRequest: {
            expected_revision: string;
            key: string;
            reason: components["schemas"]["MethodologyText"];
            version_id: string;
        };
        /** @enum {string} */
        ReceiptStatusResponse: "received";
        ReplacedFactResponse: {
            from: string;
            to: string;
        };
        /** @description A fact the criterion needs, with its type and (for a decimal) measure. */
        RequiredFactResponse: {
            /** @description `identifier`, `text`, `boolean`, `enum`, `decimal`, `date` or `instant`. */
            fact_type: string;
            /** @description ISO 4217 currency code or unit name, for a decimal. */
            measure: string | null;
            name: string;
        };
        RevokeInvitationRequest: {
            expected_version: components["schemas"]["MembershipVersion"];
            invitation_id: components["schemas"]["MembershipIdentifier"];
            key: components["schemas"]["MembershipIdentifier"];
        };
        RoutedGuideResponse: {
            command_id: string;
            cycle_id: string;
            event_cursor: string;
            task_id: string;
        };
        RoutingCandidateResponse: {
            cycle_id: string;
            objective: string;
            task_id: string;
        };
        /** @description A durable targeting question. Nothing is applied until it is answered. */
        RoutingQuestionResponse: {
            /** @description One Guide receipt per selected target, once answered. */
            answer: components["schemas"]["RoutedGuideResponse"][] | null;
            candidates: components["schemas"]["RoutingCandidateResponse"][];
            content: string;
            id: string;
            key: string;
        };
        RoutingQuestionsResponse: {
            /** @description More (older) questions exist beyond this page. */
            has_more: boolean;
            questions: components["schemas"]["RoutingQuestionResponse"][];
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
        SetupAuthorResponse: "member" | "zobba";
        SetupClientResponse: {
            client_id: string;
            client_name: string;
        };
        SetupEstablishedResponse: {
            client_id: string;
            engagement_id: string;
            engagement_name: string;
            organisation_id: string;
            /** @description The first Task's immutable Received receipt. */
            receipt: components["schemas"]["CommandReceiptResponse"];
        };
        /** @description The server's setup bounds, so clients never restate them. */
        SetupLimitsResponse: {
            /**
             * Format: int32
             * @description One answer (a client name or a period), in UTF-8 bytes.
             */
            answer_bytes: number;
            /** Format: int32 */
            client_candidates: number;
            /**
             * Format: int32
             * @description Engagements one actor may establish in one organisation per UTC day.
             */
            established_per_day: number;
            /**
             * Format: int32
             * @description The first objective, in UTF-8 bytes.
             */
            objective_bytes: number;
            /** Format: int32 */
            open_setups: number;
            /** Format: int32 */
            setup_messages: number;
        };
        /** @enum {string} */
        SetupMessageKind: "text" | "choose_client" | "new_client" | "change_client" | "change_period" | "cancel";
        SetupMessageRequest: {
            /** @description Required only for new_client: explicit acceptance or decline. */
            accept?: boolean | null;
            /** @description Required only for choose_client: one of the listed candidates. */
            client_id?: string | null;
            /**
             * @description Required only for text: a client name or an explicit ISO period, at most
             *     400 UTF-8 bytes.
             */
            content?: string | null;
            key: string;
            kind: components["schemas"]["SetupMessageKind"];
        };
        SetupMessageResponse: {
            author: components["schemas"]["SetupAuthorResponse"];
            candidates: components["schemas"]["SetupClientResponse"][];
            /** @description Retained member text, or Zobba's fixed deterministic sentence; at most 4000 UTF-8 bytes. */
            content: string;
            /**
             * @description Member: objective, text, choose_client, new_client, change_client, change_period, confirm or cancel.
             *     Zobba: question, refusal, summary, established or cancelled.
             */
            kind: string;
            /** Format: int32 */
            ordinal: number;
            /** @description Closed prompt for a Zobba question: client, client_choice, new_client, period or confirm. */
            prompt: string | null;
            /** @description Closed refusal code; the content carries the reason. */
            refusal: string | null;
            /** Format: int32 */
            reply_to: number | null;
        };
        SetupOrganisationResponse: {
            organisation_id: string;
            organisation_name: string;
        };
        SetupOrganisationsResponse: {
            limits: components["schemas"]["SetupLimitsResponse"];
            /** @description Another page exists after the last organisation listed. */
            more: boolean;
            /**
             * @description Organisations where the caller holds a current auditor or audit manager
             *     role, in C (byte) order of their IDs.
             */
            organisations: components["schemas"]["SetupOrganisationResponse"][];
        };
        SetupResponse: {
            candidates: components["schemas"]["SetupClientResponse"][];
            client: null | components["schemas"]["SetupClientResponse"];
            established: null | components["schemas"]["SetupEstablishedResponse"];
            id: string;
            /** @description The idempotency key of the opening objective. */
            key: string;
            messages: components["schemas"]["SetupMessageResponse"][];
            /** @description A new client the member explicitly agreed to create on confirmation. */
            new_client_name: string | null;
            /** @description At most 4000 UTF-8 bytes. */
            objective: string;
            organisation_id: string;
            period_end: string | null;
            period_start: string | null;
            state: components["schemas"]["SetupStateResponse"];
        };
        /** @enum {string} */
        SetupStateResponse: "objective" | "client" | "client_choice" | "new_client" | "period" | "confirm" | "established" | "cancelled";
        SetupsResponse: {
            /** @description The caller's open setups in this organisation, oldest first. */
            setups: components["schemas"]["SetupResponse"][];
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
        /**
         * @description One recorded skill use: a load, a resource fetch or a script run. Content
         *     is never returned here; a use names the exact version and digest.
         */
        SkillUseResponse: {
            digest: string | null;
            execution_epoch: string;
            invocation_id: string;
            job_id: string | null;
            /** @description `load`, `resource` or `script`. */
            kind: string;
            methodology_binding_id: string;
            name: string | null;
            /** Format: int32 */
            ordinal: number;
            /** @description `loaded`, `fetched`, `completed`, `failed` or `unavailable`. */
            outcome: string;
            /** @description Closed reason of a failed or unavailable use. */
            reason: string | null;
            resource_id: string | null;
            skill_id: string | null;
            skill_version: string | null;
            version_id: string;
        };
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
        /** @enum {string} */
        SourceStatusResponse: "current" | "withdrawn" | "corrected" | "invalidated";
        /** @enum {string} */
        StepKindResponse: "model_turn" | "tool_step";
        /** @enum {string} */
        StepReasonResponse: "context_budget";
        /** @enum {string} */
        StepStatusResponse: "proposed" | "responded" | "superseded" | "failed" | "completed" | "refused" | "reconciliation_required";
        SubstitutionResponse: {
            reason: string;
            replaced: string;
            substitute: string;
        };
        TaskAnswersResponse: {
            /** @description Verified answers of the current cycle, oldest first, at most 20. */
            answers: components["schemas"]["CitedAnswerResponse"][];
        };
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
        /** @description One immutable recorded step. Labels are fixed platform text, never model output. */
        TaskStepResponse: {
            /** @description Model turns: input tokens the provider reported, when known. */
            actual_input_tokens: string | null;
            current_work: string;
            /** @description Model turns: conservative token estimate of the planned request. */
            estimated_input_tokens: string | null;
            execution_epoch: string;
            intent_revision: string;
            invocation_id: string | null;
            kind: components["schemas"]["StepKindResponse"];
            /**
             * Format: int32
             * @description Model turns: authorised knowledge records left out of the turn's context.
             */
            knowledge_omitted: number;
            /** @description `model_turn`, `await_guidance`, `reconcile` or `tool:<catalogue name>`. */
            next_action: string | null;
            operation_id: string | null;
            /** Format: int32 */
            ordinal: number;
            reason: null | components["schemas"]["StepReasonResponse"];
            status: components["schemas"]["StepStatusResponse"];
        };
        TaskWorkResponse: {
            assessment: null | components["schemas"]["AssessmentResponse"];
            assessment_unavailable: boolean;
            attention: null | components["schemas"]["AttentionResponse"];
            briefs: components["schemas"]["BriefRevisionResponse"][];
            /** @description The most recent context compaction records of the current cycle, oldest first. */
            compactions: components["schemas"]["CompactionResponse"][];
            current_work: string | null;
            cycle_id: string;
            investigation: null | components["schemas"]["InvestigationResponse"];
            /**
             * @description True when investigation is composed but its facts could not be read
             *     for this response. The rest of the work view is unaffected.
             */
            investigation_unavailable: boolean;
            methodology_binding_id: string | null;
            methodology_status: string | null;
            /**
             * @description False when no qualified profile and enabled catalogue are selectable here:
             *     the Task stays inert and no model is called.
             */
            model_available: boolean;
            next_action: string | null;
            /** @description The invocation that proposed `next_action`. */
            next_action_invocation_id: string | null;
            /** @description The most recent recorded steps of the current cycle, in order. */
            steps: components["schemas"]["TaskStepResponse"][];
            task_id: string;
            /**
             * Format: int32
             * @description All compaction records of the current cycle.
             */
            total_compactions: number;
            /**
             * Format: int32
             * @description All steps recorded in the current cycle; earlier ones may be omitted above.
             */
            total_steps: number;
        };
        TasksResponse: {
            /** @description Pass this Task ID as after_task_id; null means no further current Tasks. */
            next_cursor: string | null;
            /** @description Current projection ordered by Task ID; open known IDs independently of this page. */
            tasks: components["schemas"]["TaskResponse"][];
        };
        UsedSkillResponse: {
            digest: string;
            skill_id: string;
            skill_version: string;
            version_id: string;
        };
        /** @description One typed value column of a population manifest. */
        ValueColumnResponse: {
            fact_type: string;
            header: string;
            measure: string | null;
            measure_column: string | null;
            name: string;
            rule: string;
        };
        /**
         * @description One checked assertion of a claim. A quote's value is withheld from a
         *     viewer who may not read its original now.
         */
        WorkProductAssertionResponse: {
            criterion_id: string | null;
            kind: string;
            locator: string | null;
            measure: string | null;
            origin: string | null;
            record_digest: string;
            record_id: string;
            record_kind: string;
            review: string | null;
            source: null | components["schemas"]["CitationSourceResponse"];
            subject: string | null;
            unit: string | null;
            value: string | null;
            withheld: boolean;
        };
        /** @description One block of a version. */
        WorkProductBlockResponse: {
            author_id: string;
            author_kind: string;
            author_label: string | null;
            authored_in_version: string;
            claim: null | components["schemas"]["WorkProductClaimResponse"];
            id: string;
            /**
             * @description `heading`, `narrative`, `claim`, `coverage`, `exceptions` or
             *     `limitations`.
             */
            kind: string;
            /** @description A narrative's `judgment` or `narrative`. */
            label: string | null;
            /** @description "Zobba's judgment — not checked against records" on a judgment block. */
            label_words: string | null;
            /** @description Platform lines of a coverage, exceptions or limitations block. */
            lines: string[];
            record_id: string | null;
            section_id: string;
            /** @description A heading's or narrative's text, or a claim's sentence. */
            text: string | null;
        };
        /** @description A claim's currency, derived now (never stored). */
        WorkProductClaimResponse: {
            assertions: components["schemas"]["WorkProductAssertionResponse"][];
            /** @description The platform coverage line of its summary or basis. */
            coverage: string | null;
            current: boolean;
            /** @description Its 1-based number in the version. */
            number: string;
            /** @description Closed reasons it needs refresh. */
            refresh: string[];
            refresh_words: string[];
            /** @description What each record says, in the platform's words. */
            support: string[];
            /** @description A quote this viewer may not read now (withheld, never stale). */
            withheld: boolean;
        };
        /**
         * @description One block a person keeps, in order: a base block by ID, with new text
         *     for a heading, a narrative or a claim's sentence (absent keeps it).
         */
        WorkProductEditBlockRequest: {
            block: string;
            /** @description At most 4,000 UTF-8 bytes (a claim's sentence 1,000, a heading 500). */
            text?: string | null;
        };
        /** @description A person's edit of a work product's latest version. */
        WorkProductEditRequest: {
            /** @description The version it edits: the latest. */
            base_version: string;
            /** @description The blocks to keep, in order (the limitations block is kept anyway). */
            blocks: components["schemas"]["WorkProductEditBlockRequest"][];
            /** @description Request key, idempotent per actor and bound to the session. */
            key: string;
        };
        WorkProductErrorResponse: {
            error: string;
            /** @description The work product's latest version, for `stale_base`. */
            head: string | null;
            refusals: components["schemas"]["WorkProductRefusalItemResponse"][];
        };
        /** @description An export request: the format and a request key idempotent per actor. */
        WorkProductExportRequest: {
            /** @description `docx` or `xlsx`. */
            format: string;
            key: string;
        };
        /** @description A stored export of one exact version. */
        WorkProductExportResponse: {
            digest: string;
            /** @description `docx` or `xlsx`. */
            format: string;
            id: string;
            media_type: string;
            recorded_us: string | null;
            /** @description Claims needing refresh at export time. */
            refresh_count: string;
            renderer: string;
            size: string;
            version_id: string;
            /** @description The digest of the requesting viewer's withheld set. */
            withheld_digest: string;
        };
        /** @description A refusal of a person's edit, per block (or the edit as a whole). */
        WorkProductRefusalItemResponse: {
            /** Format: int32 */
            block: number | null;
            detail: string;
            reason: string;
            words: string;
        };
        /** @description One template section with its blocks. */
        WorkProductSectionResponse: {
            blocks: components["schemas"]["WorkProductBlockResponse"][];
            id: string;
            /** @description "Not completed in this version." when required and empty. */
            not_completed: string | null;
            required: boolean;
            title: string;
        };
        /** @description One page of a shelf (50, C-ordered by work product ID). */
        WorkProductShelfResponse: {
            next_cursor: string | null;
            products: components["schemas"]["WorkProductSummaryResponse"][];
            /** @description Exact count over the whole shelf, never over the page. */
            total: string;
        };
        /**
         * @description One work product on a shelf: its latest version, the review state word,
         *     the exact number of its claims needing refresh and its required sections
         *     not completed.
         */
        WorkProductSummaryResponse: {
            /** @description `agent` or `human`. */
            author_kind: string;
            claims: string;
            id: string;
            /** @description `working_paper`, `analysis`, `finding_summary` or `report_draft`. */
            kind: string;
            /** @description Required template sections with no content, in template order. */
            missing_required: string[];
            /**
             * @description The built-in neutral starter or a neutral source: "Neutral starter
             *     (not firm methodology)".
             */
            neutral: boolean;
            recorded_us: string | null;
            /** @description Exact count of claims needing refresh now. */
            refresh: string;
            /** @description Always "Draft" in this story. */
            review_state: string;
            /** @description The originating Task. */
            task_id: string;
            /** @description The template's name; a neutral starter says so. */
            template: string;
            template_id: string;
            template_version: string;
            title: string;
            version: string;
            version_id: string;
        };
        /** @description One assertion of a claim as pinned, and what its record says now. */
        WorkProductSupportItemResponse: {
            pinned: components["schemas"]["WorkProductAssertionResponse"];
            /** @description The platform's words for the pinned record. */
            support: string;
        };
        /** @description A claim's support: its sentence, each pinned record and its currency. */
        WorkProductSupportResponse: {
            block_id: string;
            claim: components["schemas"]["WorkProductClaimResponse"];
            items: components["schemas"]["WorkProductSupportItemResponse"][];
            statement: string;
        };
        /** @description One exact version of a work product with its claims' currency now. */
        WorkProductVersionResponse: {
            author_kind: string;
            author_label: string | null;
            /** @description SHA-256 of the version's canonical document. */
            digest: string;
            figure_rule: string;
            id: string;
            kind: string;
            limitations: string[];
            missing_required: string[];
            /**
             * @description The latest version's ID when this is not the latest (a newer version
             *     is announced, never swapped in).
             */
            newer_version_id: string | null;
            predecessor_id: string | null;
            product: components["schemas"]["WorkProductSummaryResponse"];
            recorded_us: string | null;
            refresh: string;
            review_state: string;
            sections: components["schemas"]["WorkProductSectionResponse"][];
            template: string;
            title: string;
            version: string;
            withheld: string;
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
    list_setup_organisations: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional session-bound read precondition */
                "X-Expected-Session"?: string | null;
            };
            path: {
                /** @description The last organisation ID of the previous page. */
                after: string | null;
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
                    "application/json": components["schemas"]["SetupOrganisationsResponse"];
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
            /** @description access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload) */
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
    admit_task_direction: {
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
                /** @description Optional additional refusal fence */
                "X-Expected-Actor"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DirectionRequest"];
            };
        };
        responses: {
            /** @description Reserved lane. Routed to the only open Task that accepts guidance, or a durable targeting question; never routed by a model */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DirectionResponse"];
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
            /** @description No Task can receive guidance, or the key was reused with different text */
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
    list_task_questions: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                /** @description Optional session-bound read precondition */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's most recent targeting questions, newest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoutingQuestionsResponse"];
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
            /** @description Session changed */
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
    answer_task_question: {
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
                /** @description Optional additional refusal fence */
                "X-Expected-Actor"?: string | null;
            };
            path: {
                engagement_id: string;
                question_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AnswerRequest"];
            };
        };
        responses: {
            /** @description One Guide per selected target with a derived key; an identical retry returns the same receipts */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoutingQuestionResponse"];
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
            /** @description A selected Task is stale, foreign, or the question was answered differently */
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
    get_task_answers: {
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
            /** @description Cited answers with each source's trusted verification; the answer text is unchanged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskAnswersResponse"];
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
            /** @description Session changed */
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
    get_evaluation_history: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description next_cursor of the previous page */
                cursor?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
                /** @description The chain's revision 1: a 24.1 evaluation ID */
                chain_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The exact number of a chain's revisions and one page of them in revision order, each with its causes, changed facts and dispositions; earlier revisions are never changed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChainHistoryResponse"];
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
            /** @description Session changed */
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
    list_exceptions: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description next_cursor of the previous page */
                cursor?: string;
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
            /** @description One page (50) of the Task's exceptions with their derived status, exact counts by status over all of them, and the newest effective summaries */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExceptionsResponse"];
                };
            };
            /** @description exception_cursor_invalid for a cursor that names no exception of this Task */
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
            /** @description Session changed */
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
    get_exception: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description next_cursor of the previous page (the last listed occurrence's place) */
                cursor?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
                exception_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One exception, one page of its occurrences (in their order, 50 a page) and every disposition; occurrences are never changed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExceptionDetailResponse"];
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
            /** @description exception_not_found: no such exception of this Task */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Session changed */
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
    save_exception_disposition: {
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
                task_id: string;
                exception_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExceptionDispositionCommandRequest"];
            };
        };
        responses: {
            /** @description The saved disposition (an exact retry returns the original); no occurrence, revision or verdict changes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExceptionDispositionResponse"];
                };
            };
            /** @description exception_disposition_invalid (including a closure without evidence) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExceptionDispositionErrorResponse"];
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
            /** @description access_denied, or exception_close_forbidden for a person who is neither an Audit manager nor the Task's accountable person */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExceptionDispositionErrorResponse"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExceptionDispositionErrorResponse"];
                };
            };
            /** @description reference_unverified (index), exception_already_closed, exception_not_closed, exception_disposition_conflict or exception_disposition_capacity */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExceptionDispositionErrorResponse"];
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
                    "application/json": components["schemas"]["ExceptionDispositionErrorResponse"];
                };
            };
        };
    };
    get_population_members: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description in_scope, excluded, scope_unknown, duplicate_row or unkeyed */
                disposition?: string;
                /** @description next_cursor of the previous page */
                cursor?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition from the in-memory session CSRF token; mismatch refuses without changing the cookie */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
                population_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The exact count of a population's members of one disposition and one page of them, C-ordered by key (a row with no key first), then receipt order */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PopulationMembersResponse"];
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
            /** @description Session changed */
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
    save_disposition: {
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
                task_id: string;
                /** @description The exact revision: a 24.1 evaluation or a revision ID */
                revision_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DispositionCommandRequest"];
            };
        };
        responses: {
            /** @description The saved disposition (an exact retry returns the original); the revision is unchanged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DispositionResponse"];
                };
            };
            /** @description disposition_invalid, not_replaceable, or verdict_not_decidable (a person's met or not_met on a head that is not applicable, failed or under an unverified authority) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DispositionErrorResponse"];
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
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DispositionErrorResponse"];
                };
            };
            /** @description reference_unverified (index), revision_superseded (head_id), disposition_conflict or disposition_capacity */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DispositionErrorResponse"];
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
                    "application/json": components["schemas"]["DispositionErrorResponse"];
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
    get_task_work: {
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
            /** @description Recorded work facts for the Task card; a waiting Task is not a completed objective */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskWorkResponse"];
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
            /** @description Session changed */
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
    list_task_work_products: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description next_cursor of the previous page */
                cursor?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition */
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
            /** @description The Task's work products (a Task holds at most 16) with an exact total */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductShelfResponse"];
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
            /** @description Session changed */
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
    download_work_product_export: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                /** @description Optional session-bound read precondition */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
                product_id: string;
                export_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The export's exact bytes, their size and digest checked again */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": number[];
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
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            /** @description export_scope_changed: the viewer's withheld set is not the export's; request your own export */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            /** @description Session changed */
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
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
        };
    };
    save_work_product_version: {
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
                /** @description Required refusal fence for the current session actor */
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                task_id: string;
                product_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkProductEditRequest"];
            };
        };
        responses: {
            /** @description The recorded version (an exact retry returns the original); every kept block is unchanged with its author, every edited claim's assertions were checked again */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductVersionResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
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
            /** @description access_denied: not a currently assigned Auditor or Audit manager in their own session (Admin alone is refused) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            /** @description stale_base naming the latest version, a closed refusal reason per block, or work_product_edit_conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
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
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
        };
    };
    get_work_product_version: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                /** @description Optional session-bound read precondition */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
                product_id: string;
                version_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One exact version by template section, each claim's currency derived now, its limitations, and the latest version's ID when this is not the latest */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductVersionResponse"];
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
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            /** @description Session changed */
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
    get_work_product_claim_support: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
            };
            header?: {
                /** @description Optional session-bound read precondition */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
                task_id: string;
                product_id: string;
                version_id: string;
                block_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One claim's pinned records and their currency now; a quote this viewer may not read now is withheld */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductSupportResponse"];
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
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            /** @description Session changed */
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
    export_work_product_version: {
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
                /** @description Required refusal fence for the current session actor */
                "X-Expected-Actor": string;
            };
            path: {
                engagement_id: string;
                task_id: string;
                product_id: string;
                version_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkProductExportRequest"];
            };
        };
        responses: {
            /** @description The stored export of this exact version for the requesting viewer's withheld set (an exact retry returns the original; the same version, format and withheld set give identical bytes) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductExportResponse"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
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
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
            /** @description work_product_export_conflict for a key used for another request */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
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
            /** @description The object store is unavailable: nothing was recorded; retry */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductErrorResponse"];
                };
            };
        };
    };
    list_work_products: {
        parameters: {
            query: {
                organisation_id: string;
                client_id: string;
                /** @description next_cursor of the previous page */
                cursor?: string;
            };
            header?: {
                /** @description Optional session-bound read precondition */
                "X-Expected-Session"?: string | null;
            };
            path: {
                engagement_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page (50, C-ordered) of the engagement's work products with an exact total, each with its latest version, review state Draft, claims needing refresh and missing required sections */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkProductShelfResponse"];
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
            /** @description Session changed */
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
    methodology_proposals: {
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
                    "application/json": components["schemas"]["MethodologyProposalList"];
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
    propose_methodology: {
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
                "application/json": components["schemas"]["ProposeMethodologyRequest"];
            };
        };
        responses: {
            /** @description The recorded proposal: drafted, failed, in progress (still being drafted) or uncertain */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MethodologyProposalResponse"];
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
            /** @description The document is over 200,000 UTF-8 bytes */
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
    methodology_proposal: {
        parameters: {
            query?: never;
            header?: {
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: string;
                proposal_id: string;
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
                    "application/json": components["schemas"]["MethodologyProposalResponse"];
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
            404: {
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
    list_engagement_setups: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional session-bound read precondition */
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
                    "application/json": components["schemas"]["SetupsResponse"];
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
            /** @description access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload) */
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
    open_engagement_setup: {
        parameters: {
            query?: never;
            header: {
                /** @description Exact configured HTTPS application origin */
                Origin: string;
                /** @description Current session-bound token */
                "X-CSRF-Token": string;
                /** @description Expected current actor; refusal fence only */
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OpenSetupRequest"];
            };
        };
        responses: {
            /** @description The objective is persisted, then Zobba asks for what is missing. An identical retry returns the original setup */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupResponse"];
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
            /** @description access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Key reused with a different objective, or engagement_setup_open_limit */
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
    get_engagement_setup: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional session-bound read precondition */
                "X-Expected-Session"?: string | null;
            };
            path: {
                organisation_id: string;
                setup_id: string;
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
                    "application/json": components["schemas"]["SetupResponse"];
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
            /** @description access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description engagement_setup_not_found: no such setup for this actor here */
            404: {
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
    confirm_engagement_setup: {
        parameters: {
            query?: never;
            header: {
                /** @description Exact configured HTTPS application origin */
                Origin: string;
                /** @description Current session-bound token */
                "X-CSRF-Token": string;
                /** @description Expected current actor; refusal fence only */
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
                setup_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmSetupRequest"];
            };
        };
        responses: {
            /** @description One transaction created the client (when new), the engagement with its period, the creator's assignment and the first Task. A retry or a concurrent confirmation returns the original receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupResponse"];
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
            /** @description access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description engagement_setup_not_found: no such setup for this actor here */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not ready to confirm, key reused, engagement_setup_message_limit, engagement_setup_daily_limit or engagement_setup_confirm_failed. A refusal after the confirmation was saved is retained as a Zobba turn; replaying that key repeats it and never establishes */
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
    answer_engagement_setup: {
        parameters: {
            query?: never;
            header: {
                /** @description Exact configured HTTPS application origin */
                Origin: string;
                /** @description Current session-bound token */
                "X-CSRF-Token": string;
                /** @description Expected current actor; refusal fence only */
                "X-Expected-Actor": string;
            };
            path: {
                organisation_id: string;
                setup_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetupMessageRequest"];
            };
        };
        responses: {
            /** @description The message is persisted, then answered deterministically. A refused answer is a retained Zobba refusal; the setup stays open */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupResponse"];
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
            /** @description access_denied: no current auditor or audit manager role; engagement_setup_request_rejected: the CSRF, origin or expected-actor fence refused the request (reload) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description engagement_setup_not_found: no such setup for this actor here */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Key reused with a different meaning, closed setup, or engagement_setup_message_limit */
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
