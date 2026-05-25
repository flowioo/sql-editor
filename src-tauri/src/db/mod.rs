pub mod sqlite;
pub mod postgres;
pub mod mysql;

use serde::{Serialize, Deserialize};
use crate::schema::DatabaseSchema;
use std::sync::Arc;

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
                format!("postgresql://{}@{}:{}:{}/{}", user, host, port, "***", database)
            }
            Self::Mysql { host, port, user, database, .. } => {
                format!("mysql://{}@{}:{}:{}/{}", user, host, port, "***", database)
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
}

/// Enum dispatcher — avoids sync trait + async runtime conflicts
#[derive(Clone)]
pub enum Driver {
    Sqlite(Arc<sqlite::SqliteDriver>),
    Postgres(Arc<postgres::PostgresDriver>),
    MySql(Arc<mysql::MySqlDriver>),
}

impl Driver {
    pub async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        match self {
            Driver::Sqlite(d) => d.execute_query(sql),
            Driver::Postgres(d) => d.execute_query(sql).await,
            Driver::MySql(d) => d.execute_query(sql).await,
        }
    }

    pub async fn get_schema(&self) -> Result<DatabaseSchema, String> {
        match self {
            Driver::Sqlite(d) => d.get_schema(),
            Driver::Postgres(d) => d.get_schema().await,
            Driver::MySql(d) => d.get_schema().await,
        }
    }
}
