//! Owned identity, scope and durable Task meanings; no delivery or vendor types.
pub mod conversation;
pub mod engagement_setup;
pub mod evidence;
pub mod identity;
pub mod knowledge;
pub mod membership;
pub mod methodology;
pub mod model;
pub mod permissions;
pub mod skills;
pub mod task;
pub mod work;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SchemaVersion(pub u32);

pub const SCHEMA_VERSION: SchemaVersion = SchemaVersion(13);
