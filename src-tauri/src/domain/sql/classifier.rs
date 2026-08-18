//! Classify a statement as row-returning (Query) or data-modifying (Execute).

/// Whether a statement returns a row set (use `fetch`) or modifies data
/// (use `execute`). Based on the first significant keyword after stripping
/// leading comments/whitespace.
#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub enum StmtKind {
    Query,
    Execute,
}

pub fn classify_statement(sql: &str) -> StmtKind {
    match first_significant_word(sql).map(str::to_ascii_uppercase).as_deref() {
        Some("SELECT") | Some("WITH") | Some("SHOW") | Some("EXPLAIN")
        | Some("DESCRIBE") | Some("DESC") | Some("PRAGMA") | Some("TABLE")
        | Some("VALUES") => StmtKind::Query,
        _ => StmtKind::Execute,
    }
}

/// Return the first alphanumeric word, skipping leading whitespace, SQL
/// comments, **and leading `(` / `,`**.
///
/// Why: PostgreSQL allows `WITH x AS (…) SELECT …` as well as parenthesised
/// statements like `(SELECT 1) UNION (SELECT 2)`. The first character may
/// legitimately be `(` or `,`; in that case we keep scanning for the next
/// significant token rather than reporting "no keyword" and defaulting to
/// `Execute`. PostgreSQL also accepts a top-level `(` as the start of a
/// parenthesised SELECT, which must classify as `Query`.
fn first_significant_word(sql: &str) -> Option<&str> {
    let bytes = sql.as_bytes();
    let n = bytes.len();
    let mut i = 0usize;
    while i < n {
        // Skip whitespace.
        while i < n && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= n {
            return None;
        }
        // Skip line comments.
        if i + 1 < n && bytes[i] == b'-' && bytes[i + 1] == b'-' {
            while i < n && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        // Skip block comments.
        if i + 1 < n && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < n && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
            continue;
        }
        // Skip leading punctuation that's not part of any keyword (parens
        // and commas appear before subqueries / multi-row VALUES lists).
        if bytes[i] == b'(' || bytes[i] == b',' {
            i += 1;
            continue;
        }
        let start = i;
        while i < n && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
            i += 1;
        }
        if i > start {
            return Some(&sql[start..i]);
        }
        // Some other leading byte — no keyword here, but keep scanning
        // rather than bailing out (e.g. `; ` at the very start).
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_query_keywords() {
        assert_eq!(classify_statement("SELECT 1"), StmtKind::Query);
        assert_eq!(classify_statement("with t as (select 1) select * from t"), StmtKind::Query);
        assert_eq!(classify_statement("  /* c */ SHOW TABLES"), StmtKind::Query);
        assert_eq!(classify_statement("-- note\nEXPLAIN SELECT 1"), StmtKind::Query);
        assert_eq!(classify_statement("PRAGMA table_info(x)"), StmtKind::Query);
        assert_eq!(classify_statement("TABLE foo"), StmtKind::Query);
        assert_eq!(classify_statement("VALUES (1), (2)"), StmtKind::Query);
    }

    #[test]
    fn classify_query_with_leading_paren() {
        // Parenthesised SELECT — the `(` is a wrapper, the SELECT still
        // runs and returns rows.
        assert_eq!(classify_statement("(SELECT 1) UNION (SELECT 2)"), StmtKind::Query);
    }

    #[test]
    fn classify_execute_keywords() {
        assert_eq!(classify_statement("INSERT INTO t VALUES (1)"), StmtKind::Execute);
        assert_eq!(classify_statement("UPDATE t SET a = 1"), StmtKind::Execute);
        assert_eq!(classify_statement("DELETE FROM t"), StmtKind::Execute);
        assert_eq!(classify_statement("CREATE TABLE t (a int)"), StmtKind::Execute);
        assert_eq!(classify_statement("DROP TABLE t"), StmtKind::Execute);
        assert_eq!(classify_statement(""), StmtKind::Execute);
    }
}