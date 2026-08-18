pub mod sqlite;
pub mod postgres;
pub mod mysql;
pub mod redis;
pub(crate) mod redis_render;
pub(crate) mod sqlx_common;

use serde::{Serialize, Deserialize};

// Pure SQL domain primitives live in `crate::domain::sql`; re-exported here as
// a compatibility shim so existing callers (drivers, commands) keep compiling
// unchanged.
pub use crate::domain::sql::{classify_statement, StmtKind};
pub(crate) use crate::domain::sql::decode_cell;

/// Single statement execution result.
/// Used for multi-statement execution — each statement gets one of these.
#[derive(Serialize, Clone)]
pub struct StatementResult {
    pub sql: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected_rows: u64,
    pub truncated: bool,
    pub is_query: bool,
    pub error: Option<String>,
}

/// Multi-statement execution result — a list of StatementResult.
#[derive(Serialize, Clone)]
pub struct MultiQueryResult {
    pub results: Vec<StatementResult>,
    pub total_duration_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ConnectionConfig {
    Sqlite { path: String },
    Postgresql {
        host: String,
        port: u16,
        user: String,
        password: String,
        database: String,
        #[serde(default)]
        url: Option<String>,
    },
    Mysql {
        host: String,
        port: u16,
        user: String,
        password: String,
        database: String,
        #[serde(default)]
        url: Option<String>,
    },
    Redis {
        host: String,
        port: u16,
        password: String,
        /// Logical database index (SELECT n).
        database: i64,
    },
}

impl ConnectionConfig {
    pub fn connection_key(&self) -> String {
        match self {
            Self::Sqlite { path } => path.clone(),
            Self::Postgresql { host, port, user, database, .. } => {
                format!("postgresql://{}@{}:{}/{}", user, host, port, database)
            }
            Self::Mysql { host, port, user, database, .. } => {
                format!("mysql://{}@{}:{}/{}", user, host, port, database)
            }
            Self::Redis { host, port, database, .. } => {
                format!("redis://{}:{}/{}", host, port, database)
            }
        }
    }

    pub fn display_name(&self) -> String {
        match self {
            Self::Sqlite { path } => {
                std::path::Path::new(path)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            }
            Self::Postgresql { database, host, .. } => {
                format!("{} ({})", database, host)
            }
            Self::Mysql { database, host, .. } => {
                format!("{} ({})", database, host)
            }
            Self::Redis { database, host, .. } => {
                format!("redis db{} ({})", database, host)
            }
        }
    }
}
