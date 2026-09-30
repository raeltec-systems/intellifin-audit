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
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @enum {string} */
        CessationResponse: "none" | "pending" | "confirmed" | "reconciliation_required";
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
        /** @enum {string} */
        ReceiptStatusResponse: "received";
        ScopeResponse: {
            client_id: string;
            engagement_id: string;
            organisation_id: string;
        };
        /** @enum {string} */
        Service: "api" | "worker";
        SessionResponse: {
            csrf_token: string;
            identity: components["schemas"]["IdentityResponse"];
        };
        TaskCommandRequest: {
            /**
             * @description Exact retained text, at most 4000 UTF-8 bytes. Required only for Create and Guide.
             *     Must contain non-whitespace; control characters other than LF, CR and tab are refused.
             */
            content?: string | null;
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
            header?: never;
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
            header?: never;
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
            header?: never;
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
            header?: never;
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
            header?: never;
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
            header?: never;
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
            header?: never;
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
            header?: never;
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
            header?: never;
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
}
