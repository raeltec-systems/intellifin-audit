//! Owned identity, scope and durable Task meanings; no delivery or vendor types.
pub mod conversation;
pub mod identity;
pub mod membership;
pub mod permissions;
pub mod task;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SchemaVersion(pub u32);

pub const SCHEMA_VERSION: SchemaVersion = SchemaVersion(5);
