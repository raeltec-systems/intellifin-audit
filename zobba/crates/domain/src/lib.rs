//! Owned meanings only. Bootstrap readiness is not audit or Task capability.
pub mod identity;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SchemaVersion(pub u32);

pub const SCHEMA_VERSION: SchemaVersion = SchemaVersion(2);
