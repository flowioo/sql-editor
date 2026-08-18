//! RESP parsing / rendering and Redis command tokenisation. Kept out of
//! `redis.rs` so the driver stays focused on connection state management
//! and the render helpers stay easy to test in isolation.

use redis::aio::MultiplexedConnection;
use redis::{Client, IntoConnectionInfo, Value};

use crate::db::StatementResult;

/// Upper bound on rows rendered from a single Redis command. A `KEYS *`
/// against a million-key db is truncated so the UI does not hang.
const RESULT_ROW_CAP: usize = 10_000;

/// Open a fresh `MultiplexedConnection` — used by `RedisDriver::new` and
/// by every reconnect path.
pub async fn open_connection(host: &str, port: u16) -> Result<MultiplexedConnection, String> {
    let info = redis::ConnectionAddr::Tcp(host.to_string(), port)
        .into_connection_info()
        .map_err(|e| e.to_string())?;
    let client = Client::open(info).map_err(|e| e.to_string())?;
    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| format!("无法连接 {}: {} ({})", host, port, e))
}

/// SCAN (never KEYS — KEYS blocks the server) until the cursor wraps to 0 or
/// `limit` keys have been collected.
pub async fn scan_keys(conn: &mut MultiplexedConnection, limit: usize) -> Result<Vec<String>, String> {
    let mut keys = Vec::new();
    let mut cursor: u64 = 0;
    loop {
        let (next, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("COUNT")
            .arg(100)
            .query_async(conn)
            .await
            .map_err(|e| e.to_string())?;
        keys.extend(batch);
        if next == 0 || keys.len() >= limit {
            return Ok(keys);
        }
        cursor = next;
    }
}

/// Split a command line into tokens, honouring single/double-quoted arguments
/// so `SET greeting "hello world"` arrives as one argument.
///
/// Empty quoted strings (`""` / `''`) are preserved as empty tokens — the
/// user might be running `LPUSH list ""` to push a literal empty string,
/// and silently dropping the token would corrupt the argument count.
pub fn tokenize_command(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut pending_empty = false;
    for c in input.trim().chars() {
        match quote {
            Some(q) => {
                if c == q {
                    tokens.push(std::mem::take(&mut current));
                    quote = None;
                    pending_empty = false;
                } else {
                    current.push(c);
                }
            }
            None => {
                if c == '\'' || c == '"' {
                    quote = Some(c);
                    pending_empty = true;
                } else if c.is_whitespace() {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    } else if pending_empty {
                        tokens.push(String::new());
                        pending_empty = false;
                    }
                } else {
                    current.push(c);
                    pending_empty = false;
                }
            }
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    } else if pending_empty {
        tokens.push(String::new());
    }
    tokens
}

/// Render a RESP value as a single-column grid, mirroring redis-cli's
/// numbered vertical output. Simple replies (GET/INCR…) are one row; array
/// replies (KEYS/MGET…) are one row per element; nested arrays (SCAN's key
/// list) are joined inline. Results are bounded by `RESULT_ROW_CAP` —
/// past that we stop collecting and mark the result `truncated`.
pub fn value_to_result(sql: &str, value: Value) -> StatementResult {
    let scalar_row = |text: String| vec![vec![Some(text)]];
    let (rows_raw, affected_rows, is_query) = match value {
        Value::Nil => (Vec::new(), 0, true),
        Value::Int(i) => (scalar_row(i.to_string()), 0, true),
        Value::BulkString(bytes) => (scalar_row(String::from_utf8_lossy(&bytes).into_owned()), 0, true),
        Value::SimpleString(s) => (scalar_row(s), 0, true),
        // Write-path acknowledgement (SET/EXPIRE…): treated as affected, not a result set.
        Value::Okay => (scalar_row("OK".to_string()), 1, false),
        Value::Array(items) => {
            let rows = items.into_iter().map(value_to_cell).map(|c| vec![c]).collect();
            (rows, 0, true)
        }
        other => (scalar_row(format!("{:?}", other)), 0, true),
    };
    let mut truncated = false;
    let rows = if rows_raw.len() > RESULT_ROW_CAP {
        truncated = true;
        rows_raw.into_iter().take(RESULT_ROW_CAP).collect()
    } else {
        rows_raw
    };
    StatementResult {
        sql: sql.to_string(),
        columns: vec!["value".to_string()],
        rows,
        affected_rows,
        truncated,
        is_query,
        error: None,
    }
}

fn value_to_cell(value: Value) -> Option<String> {
    match value {
        Value::Nil => None,
        Value::Int(i) => Some(i.to_string()),
        Value::BulkString(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
        Value::SimpleString(s) => Some(s),
        Value::Okay => Some("OK".to_string()),
        Value::Array(items) => {
            let joined = items
                .into_iter()
                .filter_map(value_to_cell)
                .collect::<Vec<_>>()
                .join(", ");
            Some(format!("[{}]", joined))
        }
        other => Some(format!("{:?}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_splits_on_whitespace() {
        assert_eq!(
            tokenize_command("SET greeting hello"),
            vec!["SET", "greeting", "hello"]
        );
    }

    #[test]
    fn tokenize_keeps_quoted_argument_intact() {
        assert_eq!(
            tokenize_command("SET msg \"hello world\""),
            vec!["SET", "msg", "hello world"]
        );
        assert_eq!(tokenize_command("SET msg 'a b'"), vec!["SET", "msg", "a b"]);
    }

    #[test]
    fn tokenize_ignores_leading_trailing_whitespace() {
        assert_eq!(tokenize_command("  PING  "), vec!["PING"]);
        assert!(tokenize_command("   ").is_empty());
    }

    #[test]
    fn tokenize_preserves_empty_quoted_argument() {
        // `LPUSH list ""` should arrive as three tokens — silently dropping
        // the empty arg would corrupt the command's arity.
        assert_eq!(
            tokenize_command("LPUSH list \"\""),
            vec!["LPUSH", "list", ""],
        );
        assert_eq!(
            tokenize_command("LPUSH list ''"),
            vec!["LPUSH", "list", ""],
        );
    }

    #[test]
    fn result_scalar_renders_one_row() {
        let r = value_to_result("GET k", Value::BulkString(b"v1".to_vec()));
        assert_eq!(r.columns, vec!["value"]);
        assert_eq!(r.rows, vec![vec![Some("v1".to_string())]]);
        assert!(r.is_query);
    }

    #[test]
    fn result_ok_counts_as_affected() {
        let r = value_to_result("SET k v", Value::Okay);
        assert_eq!(r.affected_rows, 1);
        assert!(!r.is_query);
        assert_eq!(r.rows, vec![vec![Some("OK".to_string())]]);
    }

    #[test]
    fn result_array_renders_vertical_rows() {
        let r = value_to_result(
            "KEYS *",
            Value::Array(vec![
                Value::BulkString(b"a".to_vec()),
                Value::BulkString(b"b".to_vec()),
            ]),
        );
        assert_eq!(r.rows.len(), 2);
        assert_eq!(r.rows[1], vec![Some("b".to_string())]);
    }

    #[test]
    fn result_nil_is_empty_query() {
        let r = value_to_result("GET missing", Value::Nil);
        assert!(r.rows.is_empty());
        assert!(r.is_query);
    }

    #[test]
    fn result_large_array_is_truncated() {
        // Build an oversized array and verify the cap kicks in. We use
        // a synthetic `Vec` larger than `RESULT_ROW_CAP` to actually
        // exercise the truncation branch (the other tests stay under it).
        let items: Vec<Value> = (0..RESULT_ROW_CAP + 1)
            .map(|i| Value::BulkString(format!("k{i}").into_bytes()))
            .collect();
        let r = value_to_result("KEYS *", Value::Array(items));
        assert_eq!(r.rows.len(), RESULT_ROW_CAP);
        assert!(r.truncated);
    }
}