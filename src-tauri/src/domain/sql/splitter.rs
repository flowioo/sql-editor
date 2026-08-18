//! SQL statement splitting with dialect-aware quote/comment handling.

/// Per-dialect flags that drive the splitter's quote and comment handling.
///
/// SQL dialects differ in which escape sequences and comment forms are
/// legal inside a statement body:
///   * PostgreSQL treats `\` as an ordinary character and uses `$$ ... $$`
///     for dollar-quoted bodies (plpgsql, etc.).
///   * MySQL uses `\'` to escape the single quote inside `'…'` and treats
///     `# …` as a line comment in addition to `--`.
///   * SQLite also accepts `# …` line comments but does not use backslash
///     escapes (the legacy `ESCAPE '\'` clause notwithstanding).
///
/// Modelling these as a small struct keeps the splitter itself dialect-free
/// and the choice of dialect explicit at the call site (the driver gateway).
#[derive(Clone, Copy, Debug)]
pub struct Dialect {
    /// Treat `\'` as a single-quote escape inside `'…'`.
    pub backslash_escapes: bool,
    /// Recognise `# …\n` as a line comment.
    pub hash_line_comments: bool,
    /// Recognise `$tag$ … $tag$` as a quoted body.
    pub dollar_quotes: bool,
}

impl Dialect {
    pub const fn postgres() -> Self {
        Self {
            backslash_escapes: false,
            hash_line_comments: false,
            dollar_quotes: true,
        }
    }

    pub const fn mysql() -> Self {
        Self {
            backslash_escapes: true,
            hash_line_comments: true,
            dollar_quotes: false,
        }
    }

    pub const fn sqlite() -> Self {
        Self {
            backslash_escapes: false,
            hash_line_comments: true,
            dollar_quotes: false,
        }
    }
}

/// Split SQL text into individual statements by top-level `;`, honouring
/// the dialect's quote and comment rules.
///
/// Character-level state machine that tracks single-quoted strings (with
/// optional `\'` escape), double-quoted identifiers, backtick identifiers,
/// `--` / `/* */` comments, the dialect's hash line comments, and the
/// dialect's dollar-quoted bodies. A `;` only splits when not inside any of
/// those. Leading/trailing whitespace is trimmed per statement, and
/// statements that consist of comments/whitespace only are dropped.
pub fn split_sql_with(sql: &str, dialect: &Dialect) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let n = chars.len();
    let mut statements = Vec::new();
    let mut start = 0usize;

    let mut in_single = false;
    let mut in_double = false;
    let mut in_backtick = false;
    let mut in_line_comment = false;
    let mut block_depth = 0usize;
    let mut dollar_tag: Option<String> = None;

    let mut i = 0usize;
    while i < n {
        let c = chars[i];
        let next = if i + 1 < n { Some(chars[i + 1]) } else { None };

        if in_line_comment {
            if c == '\n' {
                in_line_comment = false;
            }
            i += 1;
            continue;
        }
        if block_depth > 0 {
            if c == '*' && next == Some('/') {
                block_depth -= 1;
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }
        if let Some(ref tag) = dollar_tag {
            // Look for the matching closing $tag$.
            let close: Vec<char> = format!("${}$", tag).chars().collect();
            if c == '$' && i + close.len() <= n && chars[i..i + close.len()] == close[..] {
                dollar_tag = None;
                i += close.len();
            } else {
                i += 1;
            }
            continue;
        }
        if in_single {
            if c == '\\' && dialect.backslash_escapes && next.is_some() {
                // MySQL-style backslash escape — skip the next char verbatim
                // (covers `\'`, `\\`, `\n`, …).
                i += 2;
            } else if c == '\'' {
                if next == Some('\'') {
                    i += 2;
                } else {
                    in_single = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }
        if in_double {
            if c == '"' {
                if next == Some('"') {
                    i += 2;
                } else {
                    in_double = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }
        if in_backtick {
            if c == '`' {
                if next == Some('`') {
                    i += 2;
                } else {
                    in_backtick = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }

        // Not inside any quote/comment.
        match c {
            '-' if next == Some('-') => {
                in_line_comment = true;
                i += 2;
            }
            '/' if next == Some('*') => {
                block_depth += 1;
                i += 2;
            }
            '#' if dialect.hash_line_comments => {
                in_line_comment = true;
                i += 1;
            }
            '\'' => {
                in_single = true;
                i += 1;
            }
            '"' => {
                in_double = true;
                i += 1;
            }
            '`' => {
                in_backtick = true;
                i += 1;
            }
            '$' if dialect.dollar_quotes => {
                // Dollar-quoted string: $tag$ ... $tag$ (tag optional / alphanumeric).
                let mut j = i + 1;
                let mut tag = String::new();
                while j < n && chars[j] != '$' && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                    tag.push(chars[j]);
                    j += 1;
                }
                if j < n && chars[j] == '$' {
                    dollar_tag = Some(tag);
                    i = j + 1;
                } else {
                    // Lone '$' — treat as an ordinary character.
                    i += 1;
                }
            }
            ';' => {
                if let Some(stmt) = collect_statement(&chars[start..i]) {
                    statements.push(stmt);
                }
                i += 1;
                start = i;
            }
            _ => {
                i += 1;
            }
        }
    }

    // Trailing statement (no terminating ';').
    if let Some(stmt) = collect_statement(&chars[start..]) {
        statements.push(stmt);
    }

    statements
}

/// Split SQL text using the PostgreSQL dialect. Kept as a thin wrapper for
/// backward compatibility — existing callers and the existing test suite
/// assume this default.
#[allow(dead_code)] // re-exported for callers/tests, not used inside the lib
pub fn split_sql(sql: &str) -> Vec<String> {
    split_sql_with(sql, &Dialect::postgres())
}

/// Trim a statement slice and drop it if it is comments/whitespace only.
fn collect_statement(chars: &[char]) -> Option<String> {
    let s: String = chars.iter().collect();
    let trimmed = s.trim();
    if trimmed.is_empty() || is_comment_only(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

/// True if `s` contains only SQL comments and whitespace (no real tokens).
fn is_comment_only(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut i = 0usize;
    while i < n {
        let c = chars[i];
        let next = if i + 1 < n { Some(chars[i + 1]) } else { None };
        if c == '-' && next == Some('-') {
            while i < n && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            i += 2;
            while i + 1 < n && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else if c.is_whitespace() {
            i += 1;
        } else {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_sql_basic() {
        assert_eq!(split_sql("SELECT 1; SELECT 2;"), vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn split_sql_no_trailing_semicolon() {
        assert_eq!(split_sql("SELECT 1"), vec!["SELECT 1"]);
        assert_eq!(split_sql("SELECT 1\n"), vec!["SELECT 1"]);
    }

    #[test]
    fn split_sql_empty_and_whitespace() {
        assert!(split_sql("").is_empty());
        assert!(split_sql("   \n\t  ").is_empty());
        assert_eq!(split_sql("; ; ;"), Vec::<String>::new());
    }

    #[test]
    fn split_sql_semicolon_inside_string() {
        assert_eq!(split_sql("SELECT ';' AS s;"), vec!["SELECT ';' AS s"]);
        assert_eq!(
            split_sql("INSERT INTO t VALUES ('a;b', 'c');"),
            vec!["INSERT INTO t VALUES ('a;b', 'c')"],
        );
    }

    #[test]
    fn split_sql_escaped_quote() {
        assert_eq!(split_sql("SELECT 'it''s';"), vec!["SELECT 'it''s'"]);
    }

    #[test]
    fn split_sql_line_comment_with_statement() {
        // A comment before the statement must not discard it.
        assert_eq!(split_sql("-- 注释\nSELECT 1;"), vec!["-- 注释\nSELECT 1"]);
    }

    #[test]
    fn split_sql_comment_only_dropped() {
        assert!(split_sql("-- only a comment\n").is_empty());
        assert!(split_sql("/* block only */").is_empty());
    }

    #[test]
    fn split_sql_block_comment() {
        assert_eq!(
            split_sql("/* c */ SELECT 1; SELECT 2;"),
            vec!["/* c */ SELECT 1", "SELECT 2"],
        );
        // ';' inside a block comment must not split.
        assert_eq!(split_sql("/* a ; b */ SELECT 1;"), vec!["/* a ; b */ SELECT 1"]);
    }

    #[test]
    fn split_sql_double_quoted_identifier() {
        // ';' inside a double-quoted identifier must not split.
        assert_eq!(
            split_sql(r#"SELECT "a;b" FROM t;"#),
            vec![r#"SELECT "a;b" FROM t"#],
        );
    }

    #[test]
    fn split_sql_dollar_quote() {
        let body = "CREATE FUNCTION f() RETURNS void AS $$ BEGIN RAISE NOTICE 'a;b'; END; $$ LANGUAGE plpgsql;";
        let expected = "CREATE FUNCTION f() RETURNS void AS $$ BEGIN RAISE NOTICE 'a;b'; END; $$ LANGUAGE plpgsql";
        let parts = split_sql(body);
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0], expected);
    }

    // ── Dialect-specific tests ──────────────────────────────────────

    #[test]
    fn mysql_dialect_handles_backslash_escape() {
        // MySQL's `\'` must not terminate the string.
        let parts = split_sql_with(
            "INSERT INTO t VALUES ('a\\';b', 'c'); SELECT 1;",
            &Dialect::mysql(),
        );
        assert_eq!(
            parts,
            vec!["INSERT INTO t VALUES ('a\\';b', 'c')", "SELECT 1"],
        );
    }

    #[test]
    fn mysql_dialect_handles_hash_comment() {
        // `# …\n` is a comment in MySQL/SQLite; the `;` after the comment
        // must split the statement.
        let parts = split_sql_with(
            "# header\nSELECT 1; SELECT 2;",
            &Dialect::mysql(),
        );
        assert_eq!(parts, vec!["# header\nSELECT 1", "SELECT 2"]);
    }

    #[test]
    fn sqlite_dialect_accepts_hash_comment_no_dollar_quote() {
        // SQLite inherits # but not dollar-quoted bodies — a lone `$` is
        // an ordinary char (so the `;` after `;` splits).
        let parts = split_sql_with("SELECT 1; SELECT '$';", &Dialect::sqlite());
        assert_eq!(parts, vec!["SELECT 1", "SELECT '$'"]);
    }

    #[test]
    fn postgres_dialect_rejects_hash_comment() {
        // In Postgres `#` is not a comment — `#foo` is just an identifier.
        // No `;` is present, so the whole input is one statement.
        let parts = split_sql_with("SELECT #foo;", &Dialect::postgres());
        assert_eq!(parts, vec!["SELECT #foo"]);
    }
}