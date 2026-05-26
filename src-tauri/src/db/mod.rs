pub mod sqlite;
pub mod postgres;
pub mod mysql;

use serde::{Serialize, Deserialize};
use crate::schema::DatabaseSchema;
use std::sync::Arc;
use std::time::Instant;

#[derive(Serialize, Clone)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected_rows: u64,
    pub truncated: bool,
}

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

    pub async fn execute_multi_query(&self, sql: &str) -> Result<MultiQueryResult, String> {
        let statements = split_sql(sql);
        let start = Instant::now();
        let mut results = Vec::with_capacity(statements.len());

        for stmt in &statements {
            let result = match self {
                Driver::Sqlite(d) => d.execute_single(stmt),
                Driver::Postgres(d) => d.execute_single(stmt).await,
                Driver::MySql(d) => d.execute_single(stmt).await,
            };

            match result {
                Ok(sr) => results.push(sr),
                Err(e) => results.push(StatementResult {
                    sql: stmt.clone(),
                    columns: vec![],
                    rows: vec![],
                    affected_rows: 0,
                    truncated: false,
                    is_query: false,
                    error: Some(e),
                }),
            }
        }

        let total_duration_ms = start.elapsed().as_millis() as u64;
        Ok(MultiQueryResult { results, total_duration_ms })
    }
}

/// Split SQL text into individual statements by `;`.
/// Handles string literals (single-quoted) to avoid splitting inside strings.
/// Filters out empty statements and whitespace-only statements.
pub fn split_sql(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut prev_char: Option<char> = None;

    for ch in sql.chars() {
        if ch == '\'' && prev_char != Some('\\') {
            in_string = !in_string;
        }

        if ch == ';' && !in_string {
            let trimmed = current.trim();
            if !trimmed.is_empty() && !trimmed.starts_with("--") {
                statements.push(trimmed.to_string());
            }
            current = String::new();
        } else {
            current.push(ch);
        }
        prev_char = Some(ch);
    }

    // Don't forget the last statement (no trailing semicolon)
    let trimmed = current.trim();
    if !trimmed.is_empty() && !trimmed.starts_with("--") {
        statements.push(trimmed.to_string());
    }

    statements
}
