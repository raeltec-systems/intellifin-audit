//! Deterministic knowledge rules. Evidence quotations, assertions, directions
//! and presentation preferences have different standing; none grants authority.
use std::collections::{BTreeMap, BTreeSet};

use crate::identity::valid_scope_id;

pub const MAX_TEXT_BYTES: usize = 16 * 1024;
pub const MAX_DEPENDENCIES: usize = 32;
pub const MAX_GRAPH_NODES: usize = 4096;
pub const PREFERENCE_RULE: &str = "task-inspection-layout-v1";

/// Exact text is never trimmed, normalized or silently repaired.
pub fn valid_text(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_TEXT_BYTES
        && !text.chars().all(char::is_whitespace)
        && !text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Period {
    pub start: Option<String>,
    pub end: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeriodEligibility {
    Eligible,
    Unknown,
    Outside,
}
impl Period {
    pub fn is_valid(&self) -> bool {
        match (&self.start, &self.end) {
            (None, None) => true,
            (Some(start), Some(end)) => {
                crate::methodology::valid_date(start)
                    && crate::methodology::valid_date(end)
                    && start <= end
            }
            _ => false,
        }
    }
    /// Unknown source periods remain visibly unknown; a period-limited source
    /// never silently matches a consumer with no known business period.
    pub fn eligibility(&self, consumer: &Self) -> PeriodEligibility {
        if !self.is_valid() || !consumer.is_valid() {
            return PeriodEligibility::Outside;
        }
        match (&self.start, &self.end, &consumer.start, &consumer.end) {
            (None, None, _, _) => PeriodEligibility::Unknown,
            (Some(_), Some(_), None, None) => PeriodEligibility::Unknown,
            (Some(start), Some(end), Some(target_start), Some(target_end))
                if start <= target_start && end >= target_end =>
            {
                PeriodEligibility::Eligible
            }
            _ => PeriodEligibility::Outside,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RecordReference {
    pub id: String,
    pub revision: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DependencyNode {
    pub record: RecordReference,
    pub dependencies: Vec<RecordReference>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DependencyError {
    Invalid,
    Capacity,
    Cycle,
}

fn graph(
    nodes: &[DependencyNode],
) -> Result<BTreeMap<RecordReference, Vec<RecordReference>>, DependencyError> {
    if nodes.len() > MAX_GRAPH_NODES {
        return Err(DependencyError::Capacity);
    }
    let mut graph = BTreeMap::new();
    for node in nodes {
        if !valid_scope_id(&node.record.id)
            || node.record.revision == 0
            || node
                .dependencies
                .iter()
                .any(|d| !valid_scope_id(&d.id) || d.revision == 0)
            || node.dependencies.len() > MAX_DEPENDENCIES
            || graph
                .insert(node.record.clone(), node.dependencies.clone())
                .is_some()
        {
            return Err(DependencyError::Invalid);
        }
    }
    Ok(graph)
}

/// Validate the entire bounded graph before admitting a new immutable revision.
/// Iterative traversal avoids stack growth on long, adversarial dependency paths.
pub fn validate_dependencies(nodes: &[DependencyNode]) -> Result<(), DependencyError> {
    let graph = graph(nodes)?;
    let mut finished = BTreeSet::new();
    for root in graph.keys() {
        if finished.contains(root) {
            continue;
        }
        let mut pending = vec![(root.clone(), false)];
        let mut visiting = BTreeSet::new();
        while let Some((id, leaving)) = pending.pop() {
            if leaving {
                visiting.remove(&id);
                finished.insert(id);
                continue;
            }
            if finished.contains(&id) {
                continue;
            }
            if !visiting.insert(id.clone()) {
                return Err(DependencyError::Cycle);
            }
            pending.push((id.clone(), true));
            if let Some(deps) = graph.get(&id) {
                for dependency in deps.iter().rev() {
                    pending.push((dependency.clone(), false));
                }
            }
        }
    }
    Ok(())
}

/// Includes the invalidated roots and every dependent exact revision. Refuses
/// cycles/capacity instead of returning a misleading partial invalidation set.
pub fn invalidate_dependents(
    nodes: &[DependencyNode],
    roots: &[RecordReference],
) -> Result<Vec<RecordReference>, DependencyError> {
    validate_dependencies(nodes)?;
    if roots.len() > MAX_GRAPH_NODES {
        return Err(DependencyError::Capacity);
    }
    let mut inverse: BTreeMap<RecordReference, Vec<RecordReference>> = BTreeMap::new();
    for node in nodes {
        for dependency in &node.dependencies {
            inverse
                .entry(dependency.clone())
                .or_default()
                .push(node.record.clone());
        }
    }
    let mut affected = BTreeSet::new();
    let mut pending = roots.to_vec();
    while let Some(id) = pending.pop() {
        if !affected.insert(id.clone()) {
            continue;
        }
        if affected.len() > MAX_GRAPH_NODES {
            return Err(DependencyError::Capacity);
        }
        if let Some(dependents) = inverse.get(&id) {
            pending.extend(dependents.iter().cloned());
        }
    }
    Ok(affected.into_iter().collect())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InspectionLayout {
    Standard,
    Expanded,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayoutObservation {
    pub id: String,
    pub opening_id: String,
    pub sequence: u64,
    pub value: InspectionLayout,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LearnedLayout {
    pub value: InspectionLayout,
    pub observation_ids: Vec<String>,
    pub consumed_through: u64,
}
/// Two latest matching explicit choices on different openings. Retries and
/// duplicate openings never supply extra support. Undo consumes the horizon;
/// an explicit setting disables inference until explicitly replaced.
pub fn learn_layout(
    observations: &[LayoutObservation],
    consumed_through: u64,
    explicit: bool,
) -> Option<LearnedLayout> {
    if explicit || observations.len() > MAX_GRAPH_NODES {
        return None;
    }
    let mut choices: Vec<_> = observations
        .iter()
        .filter(|event| event.sequence > consumed_through)
        .collect();
    choices.sort_by(|a, b| b.sequence.cmp(&a.sequence).then_with(|| a.id.cmp(&b.id)));
    let mut openings = BTreeSet::new();
    let mut events = BTreeSet::new();
    let mut chosen = Vec::new();
    for event in choices {
        if !valid_scope_id(&event.id) || !valid_scope_id(&event.opening_id) {
            return None;
        }
        if !events.insert(&event.id) || !openings.insert(&event.opening_id) {
            continue;
        }
        chosen.push(event);
        if chosen.len() == 2 {
            break;
        }
    }
    if chosen.len() != 2 || chosen[0].value != chosen[1].value {
        return None;
    }
    Some(LearnedLayout {
        value: chosen[0].value,
        observation_ids: chosen.iter().rev().map(|event| event.id.clone()).collect(),
        consumed_through: chosen[0].sequence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reference(id: &str) -> RecordReference {
        RecordReference {
            id: id.into(),
            revision: 1,
        }
    }
    fn node(id: &str, deps: &[&str]) -> DependencyNode {
        DependencyNode {
            record: reference(id),
            dependencies: deps.iter().map(|id| reference(id)).collect(),
        }
    }
    #[test]
    fn invalidation_is_transitive_revision_exact_and_cycle_safe() {
        let graph = vec![
            node("a", &[]),
            node("b", &["a"]),
            node("c", &["b"]),
            node("d", &[]),
        ];
        assert_eq!(
            invalidate_dependents(&graph, &[reference("a")]).unwrap(),
            vec![reference("a"), reference("b"), reference("c")]
        );
        assert_eq!(
            validate_dependencies(&[node("a", &["b"]), node("b", &["a"])]),
            Err(DependencyError::Cycle)
        );
        assert_eq!(
            validate_dependencies(&[node("a", &["a"])]),
            Err(DependencyError::Cycle)
        );
        assert_eq!(
            validate_dependencies(&[node("a", &["b", "c"]), node("b", &["c"]), node("c", &[])]),
            Ok(())
        );
    }
    #[test]
    fn period_unknown_and_partial_overlap_never_imply_current_eligibility() {
        let period = Period {
            start: Some("2026-01-01".into()),
            end: Some("2026-12-31".into()),
        };
        assert_eq!(
            period.eligibility(&Period::default()),
            PeriodEligibility::Unknown
        );
        assert_eq!(period.eligibility(&period), PeriodEligibility::Eligible);
        assert_eq!(
            Period::default().eligibility(&period),
            PeriodEligibility::Unknown
        );
        assert_eq!(
            period.eligibility(&Period {
                start: Some("2025-12-31".into()),
                ..period.clone()
            }),
            PeriodEligibility::Outside
        );
    }
    fn choice(
        id: &str,
        opening: &str,
        sequence: u64,
        value: InspectionLayout,
    ) -> LayoutObservation {
        LayoutObservation {
            id: id.into(),
            opening_id: opening.into(),
            sequence,
            value,
        }
    }
    #[test]
    fn learning_requires_distinct_explicit_openings_and_consumes_undo_horizon() {
        let events = vec![
            choice("e1", "o1", 1, InspectionLayout::Expanded),
            choice("e2", "o2", 2, InspectionLayout::Expanded),
        ];
        let learned = learn_layout(&events, 0, false).unwrap();
        assert_eq!(learned.observation_ids, vec!["e1", "e2"]);
        assert_eq!(learn_layout(&events, learned.consumed_through, false), None);
        assert_eq!(learn_layout(&events, 0, true), None);
        assert_eq!(
            learn_layout(&[events[0].clone(), events[0].clone()], 0, false),
            None
        );
        assert_eq!(
            learn_layout(
                &[
                    events[0].clone(),
                    choice("e3", "o1", 3, InspectionLayout::Expanded)
                ],
                0,
                false
            ),
            None
        );
        assert_eq!(
            learn_layout(
                &[
                    events[0].clone(),
                    choice("e3", "o3", 3, InspectionLayout::Standard)
                ],
                0,
                false
            ),
            None
        );
    }
    #[test]
    fn exact_text_preserves_bom_crlf_and_unicode() {
        assert!(valid_text("\u{feff}Evidence\r\n界🙂"));
        assert!(!valid_text("evidence\0text"));
        assert!(!valid_text(&"x".repeat(MAX_TEXT_BYTES + 1)));
        assert!(!valid_text(" \n\r\t"));
    }
}
