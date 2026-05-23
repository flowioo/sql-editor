pub mod sqlite;
pub mod postgres;
pub mod mysql;

use serde::{Serialize, Deserialize};
use crate::schema::DatabaseSchema;

#[derive(Serialize, Clone)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected_rows: u64,
    pub truncated: bool,
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
        }
    }

    pub fn db_type_label(&self) -> &'static str {
        match self {
            Self::Sqlite { .. } => "SQLite",
            Self::Postgresql { .. } => "PostgreSQL",
            Self::Mysql { .. } => "MySQL",
        }
    }
}

// Event payloads for streaming query results

#[derive(Serialize, Clone)]
pub struct QueryBatchEvent {
    pub query_id: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub batch_index: u32,
}

#[derive(Serialize, Clone)]
pub struct QueryCompleteEvent {
    pub query_id: String,
    pub total_rows: u64,
    pub affected_rows: u64,
    pub truncated: bool,
}

#[derive(Serialize, Clone)]
pub struct QueryErrorEvent {
    pub query_id: String,
    pub error: String,
}

pub trait DatabaseDriver: Send + Sync {
    fn execute_query(&self, sql: &str) -> Result<QueryResult, String>;
    fn get_schema(&self) -> Result<DatabaseSchema, String>;
    fn test_connection(&self) -> Result<(), String>;
}
