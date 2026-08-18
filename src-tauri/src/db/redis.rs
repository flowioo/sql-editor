//! Redis driver. Redis has no SQL — the editor's command line is tokenized
//! and dispatched as a RESP command, and results are rendered in the same
//! grid as SQL results. `get_schema` samples keys via SCAN and groups them
//! by type so the sidebar still shows a useful tree.

use std::sync::Mutex;
use async_trait::async_trait;
use crate::application::ports::DriverGateway;
use crate::db::StatementResult;
use crate::schema::{DatabaseSchema, Table};
use redis::aio::MultiplexedConnection;
use redis::Value;

use super::redis_render::{open_connection, scan_keys, tokenize_command, value_to_result};

/// Upper bound on keys sampled for the schema tree — keeps `get_schema`
/// bounded on instances with millions of keys.
const SCHEMA_KEY_SAMPLE: usize = 500;

/// Redis connection state, mutable so the multiplexer can be transparently
/// rebuilt when the underlying connection errors (TCP reset, idle timeout,
/// explicit `CLIENT KILL`).
///
/// The `password` / `db_index` are kept alongside the handle so a
/// reconnect can re-run `AUTH` and `SELECT` — neither call is implicit
/// in `MultiplexedConnection::new`, so a reconnect without them would
/// silently land the session on db 0 with no auth.
pub struct RedisDriver {
    /// The active `MultiplexedConnection`, or `None` while a reconnect is
    /// in flight. MultiplexedConnection's `Clone` is Arc-backed and cheap,
    /// so we copy it out for any awaited query and drop the lock before
    /// the await — std::sync::Mutex guards are not `Send`.
    handle: Mutex<Option<MultiplexedConnection>>,
    /// Most recent error observed by `run_query`, kept so a reconnect
    /// attempt can surface it as the cause of failure.
    last_err: Mutex<Option<String>>,
    host: String,
    port: u16,
    password: String,
    db_index: i64,
}

impl RedisDriver {
    /// Connect, then authenticate (`AUTH`) and select the logical db
    /// (`SELECT`) as needed, finishing with `PING` so auth / network / db
    /// errors all surface here — mirroring the Postgres/MySql drivers.
    ///
    /// Credentials are passed as command arguments, never embedded in a
    /// URL string. Rationale: redis 1.6.0's `Client::open(url)` accepts
    /// `redis://:password@host/db`, but the password can then leak via
    /// `e.to_string()` on parse / connect failure (the url is echoed in
    /// several error variants). Constructing the client from a bare
    /// `ConnectionAddr` and using `AUTH` after connect keeps the password
    /// out of every error path. Future upgrade path: switch to a
    /// `RedisConnectionInfo` builder (the `set_password` / `set_db` API is
    /// `pub` in redis 1.x) so the driver can rely on the multiplexer's
    /// built-in reconnect instead of the current lazy-reconnect below.
    pub async fn new(host: &str, port: u16, password: &str, db: i64) -> Result<Self, String> {
        let conn = open_connection(host, port).await?;
        let driver = Self {
            handle: Mutex::new(Some(conn)),
            last_err: Mutex::new(None),
            host: host.to_string(),
            port,
            password: password.to_string(),
            db_index: db,
        };
        driver.auth_and_select().await?;
        driver.ping().await?;
        Ok(driver)
    }

    /// Re-run `AUTH` (if password is non-empty) and `SELECT` (if db != 0)
    /// on the supplied connection. Used at startup and after every
    /// reconnect — keeps db/credentials in lock-step with the configured
    /// connection state.
    async fn auth_and_select_on(&self, conn: &mut MultiplexedConnection) -> Result<(), String> {
        if !self.password.is_empty() {
            redis::cmd("AUTH")
                .arg(&self.password)
                .query_async::<Value>(conn)
                .await
                .map_err(|e| format!("Redis 认证失败: {}", e))?;
        }
        if self.db_index != 0 {
            redis::cmd("SELECT")
                .arg(self.db_index)
                .query_async::<Value>(conn)
                .await
                .map_err(|e| format!("切换 db{} 失败: {}", self.db_index, e))?;
        }
        Ok(())
    }

    async fn auth_and_select(&self) -> Result<(), String> {
        let mut conn = self.clone_active().await?;
        self.auth_and_select_on(&mut conn).await
    }

    async fn ping(&self) -> Result<(), String> {
        let mut conn = self.clone_active().await?;
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .map_err(|e| format!("Redis PING 失败: {}", e))?;
        Ok(())
    }

    /// Borrow the live `MultiplexedConnection` (cheap — clones the inner
    /// Arc). The handle lock is released before returning so the awaited
    /// query does not hold the guard.
    async fn clone_active(&self) -> Result<MultiplexedConnection, String> {
        let guard = self.handle.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| self.last_err_message("未连接 Redis"))
    }

    /// Snapshot the most recent connection error for the next call to
    /// surface as the cause of a failed reconnect.
    fn last_err_message(&self, fallback: &str) -> String {
        self.last_err
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or_else(|| fallback.to_string())
    }

    fn set_last_err(&self, msg: Option<String>) {
        if let Ok(mut g) = self.last_err.lock() {
            *g = msg;
        }
    }

    /// Run a single `Cmd` on the live connection. If the call hit a
    /// connection-level error, transparently rebuild — including re-running
    /// AUTH/SELECT so a dropped connection does not land the session on
    /// db 0 / unauthenticated.
    async fn run_query(&self, cmd: redis::Cmd) -> Result<Value, String> {
        // Snapshot the active connection; lock is released before await.
        let mut conn = self.clone_active().await?;
        let r: redis::RedisResult<Value> = cmd.query_async(&mut conn).await;
        match r {
            Ok(v) => {
                self.set_last_err(None);
                Ok(v)
            }
            Err(e) => {
                let msg = e.to_string();
                let reconnectable = e.is_io_error() || e.is_connection_dropped();
                self.set_last_err(Some(msg.clone()));
                if !reconnectable {
                    return Err(msg);
                }
                // Reconnect and retry.
                let mut new_conn = open_connection(&self.host, self.port).await?;
                self.auth_and_select_on(&mut new_conn).await?;
                let value: Value = cmd.query_async(&mut new_conn).await.map_err(|e| e.to_string())?;
                if let Ok(mut guard) = self.handle.lock() {
                    *guard = Some(new_conn);
                }
                self.set_last_err(None);
                Ok(value)
            }
        }
    }
}

#[async_trait]
impl DriverGateway for RedisDriver {
    async fn execute_single(&self, sql: &str) -> Result<StatementResult, String> {
        let tokens = tokenize_command(sql);
        let Some((name, args)) = tokens.split_first() else {
            return Err("空命令".to_string());
        };
        let mut cmd = redis::cmd(name);
        for arg in args {
            cmd.arg(arg);
        }
        let value = self.run_query(cmd).await?;
        Ok(value_to_result(sql, value))
    }

    async fn get_schema(&self) -> Result<DatabaseSchema, String> {
        let mut conn = self.clone_active().await?;
        let keys = scan_keys(&mut conn, SCHEMA_KEY_SAMPLE).await?;
        // No keys means an empty db — return an empty schema rather than
        // running an empty TYPE pipeline (which would error in older
        // servers). Avoids the "second call returned nothing" UX trap.
        if keys.is_empty() {
            return Ok(DatabaseSchema {
                database_name: format!("db{}@{}", self.db_index, self.host),
                tables: Vec::new(),
                captured_at: chrono::Utc::now().to_rfc3339(),
            });
        }

        // Pipeline one TYPE per sampled key (single round-trip).
        let mut pipe = redis::pipe();
        for key in &keys {
            pipe.cmd("TYPE").arg(key);
        }
        let types: Vec<Value> = pipe
            .query_async(&mut conn)
            .await
            .map_err(|e| e.to_string())?;

        let mut groups: std::collections::BTreeMap<String, usize> = Default::default();
        for t in types {
            let type_name = match t {
                Value::SimpleString(s) => s,
                Value::BulkString(b) => String::from_utf8_lossy(&b).into_owned(),
                other => format!("{:?}", other),
            };
            *groups.entry(type_name).or_insert(0) += 1;
        }

        // One table per key type ("string (123)"); columns stay empty — the
        // tree is a navigational overview, values are read via commands.
        let tables = groups
            .into_iter()
            .map(|(type_name, count)| Table {
                name: format!("{} ({})", type_name, count),
                columns: vec![],
                indexes: vec![],
            })
            .collect();

        Ok(DatabaseSchema {
            database_name: format!("db{}@{}", self.db_index, self.host),
            tables,
            captured_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    /// Redis is non-SQL, so multi-statement dispatch is line-based — each
    /// non-empty line is one command. The default trait impl returning
    /// `None` (see `ports.rs`) drives that decision.
    fn dialect(&self) -> Option<crate::domain::sql::Dialect> {
        None
    }
}