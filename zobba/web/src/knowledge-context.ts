export type MethodContext = { task_id: string; binding_id: string; source_version_ids: string[]; status: string; checked_at: number };
export type SkillContext = { task_id: string; methodology_binding_id: string; execution_epoch: string; observed_at: number; selections: { id: string; version_id: string; digest: string; status: string }[] };
