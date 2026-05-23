use std::fs;
use std::path::Path;
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone)]
struct ParsedField {
    name: String,
    description: String,
}

#[derive(Debug, Clone)]
struct ParsedModel {
    name: String,
    fields: Vec<ParsedField>,
    file_path: String,
}

#[derive(Serialize, Clone)]
pub struct ColumnDescription {
    pub table_name: String,
    pub column_name: String,
    pub description: String,
    pub source: String,
    pub file_path: String,
}

#[derive(Serialize)]
pub struct ScanResult {
    pub models_found: usize,
    pub columns_matched: usize,
    pub columns_unmatched: usize,
    pub descriptions: Vec<ColumnDescription>,
}

pub fn scan_directory(
    dir_path: &str,
    table_names: &[String],
) -> Result<ScanResult, String> {
    let dir = Path::new(dir_path);
    if !dir.is_dir() {
        return Err(format!("目录不存在: {}", dir_path));
    }

    let mut models: Vec<ParsedModel> = Vec::new();
    collect_models(dir, &mut models)?;

    let table_names_lower: Vec<String> =
        table_names.iter().map(|t| t.to_lowercase()).collect();

    let mut descriptions: Vec<ColumnDescription> = Vec::new();
    let mut matched = 0usize;
    let mut unmatched = 0usize;

    for model in &models {
        let model_lower = model.name.to_lowercase();
        let table_idx = table_names_lower.iter().position(|t| t == &model_lower);

        match table_idx {
            Some(idx) => {
                let table_name = &table_names[idx];
                for field in &model.fields {
                    if !field.description.is_empty() {
                        descriptions.push(ColumnDescription {
                            table_name: table_name.clone(),
                            column_name: field.name.clone(),
                            description: field.description.clone(),
                            source: model.file_path.clone(),
                            file_path: model.file_path.clone(),
                        });
                        matched += 1;
                    } else {
                        unmatched += 1;
                    }
                }
            }
            None => {
                unmatched += model.fields.len();
            }
        }
    }

    Ok(ScanResult {
        models_found: models.len(),
        columns_matched: matched,
        columns_unmatched: unmatched,
        descriptions,
    })
}

fn collect_models(dir: &Path, models: &mut Vec<ParsedModel>) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("无法读取目录 {:?}: {}", dir, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录条目失败: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if should_skip_dir(name) {
                continue;
            }
            collect_models(&path, models)?;
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            match ext {
                "go" => parse_go_file(&path, models)?,
                "ts" | "tsx" => parse_ts_file(&path, models)?,
                "prisma" => parse_prisma_file(&path, models)?,
                _ => {}
            }
        }
    }

    Ok(())
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "dist"
            | "build"
            | "target"
            | "vendor"
            | "__pycache__"
    )
}

fn extract_brace_block(content: &str, start: usize) -> &str {
    let mut depth = 0u32;
    let bytes = content.as_bytes();
    let mut end = start;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    end = i;
                    break;
                }
            }
            _ => {}
        }
    }
    if end == start {
        end = content.len();
    }
    &content[start..end]
}

// ── Go parser ──────────────────────────────────────────────────────

fn parse_go_file(path: &Path, models: &mut Vec<ParsedModel>) -> Result<(), String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("无法读取文件 {:?}: {}", path, e))?;
    let file_path = path.to_string_lossy().to_string();

    let struct_re = Regex::new(r"(?m)^type\s+(\w+)\s+struct\s*\{")
        .map_err(|e| format!("正则编译失败: {}", e))?;

    // Matches: FieldName Type `db:"col" ...` // description
    let tagged_field_re = Regex::new(
        r#"^\s+(\w+)\s+\S+\s+`[^`]*db:"([^"]+)"[^`]*`(?:\s*//\s*(.+))?$"#,
    )
    .map_err(|e| format!("正则编译失败: {}", e))?;

    // Matches: FieldName Type `db:"col" ...`
    let tagged_no_comment_re = Regex::new(
        r#"^\s+(\w+)\s+\S+\s+`[^`]*db:"([^"]+)"[^`]*`\s*$"#,
    )
    .map_err(|e| format!("正则编译失败: {}", e))?;

    let comment_re =
        Regex::new(r"^\s*//\s*(.+)$").map_err(|e| format!("正则编译失败: {}", e))?;

    for cap in struct_re.captures_iter(&content) {
        let struct_name = cap[1].to_string();
        let brace_start = cap.get(0).unwrap().end() - 1; // position of '{'
        let body = extract_brace_block(&content, brace_start);

        let mut fields: Vec<ParsedField> = Vec::new();
        let mut pending_comment: Option<String> = None;

        for line in body.lines() {
            // Try tagged field with inline comment
            if let Some(fc) = tagged_field_re.captures(line) {
                let col = fc[2].to_string();
                let desc = fc
                    .get(3)
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default();
                fields.push(ParsedField {
                    name: col,
                    description: desc,
                });
                pending_comment = None;
                continue;
            }

            // Try tagged field without comment — use pending comment
            if let Some(fc) = tagged_no_comment_re.captures(line) {
                let col = fc[2].to_string();
                let desc = pending_comment.take().unwrap_or_default();
                fields.push(ParsedField {
                    name: col,
                    description: desc,
                });
                continue;
            }

            // Accumulate standalone comment
            if let Some(cc) = comment_re.captures(line) {
                pending_comment = Some(cc[1].trim().to_string());
            } else if !line.trim().is_empty() {
                pending_comment = None;
            }
        }

        if !fields.is_empty() {
            models.push(ParsedModel {
                name: struct_name,
                fields,
                file_path: file_path.clone(),
            });
        }
    }

    Ok(())
}

// ── TypeScript parser ──────────────────────────────────────────────

fn parse_ts_file(path: &Path, models: &mut Vec<ParsedModel>) -> Result<(), String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("无法读取文件 {:?}: {}", path, e))?;
    let file_path = path.to_string_lossy().to_string();

    let block_re = Regex::new(
        r"(?ms)(?:export\s+)?(?:interface|type)\s+(\w+)[^{]*\{",
    )
    .map_err(|e| format!("正则编译失败: {}", e))?;

    let jsdoc_re =
        Regex::new(r"/\*\*\s*(.+?)\s*\*/").map_err(|e| format!("正则编译失败: {}", e))?;

    let field_re =
        Regex::new(r"^\s*(\w+)\??\s*:\s*").map_err(|e| format!("正则编译失败: {}", e))?;

    let line_comment_re =
        Regex::new(r"^\s*//\s*(.+)$").map_err(|e| format!("正则编译失败: {}", e))?;

    let inline_comment_re =
        Regex::new(r"//\s*(.+)$").map_err(|e| format!("正则编译失败: {}", e))?;

    for cap in block_re.captures_iter(&content) {
        let type_name = cap[1].to_string();
        let brace_start = cap.get(0).unwrap().end() - 1;
        let body = extract_brace_block(&content, brace_start);

        let mut fields: Vec<ParsedField> = Vec::new();
        let lines: Vec<&str> = body.lines().collect();
        let mut i = 0;

        while i < lines.len() {
            let line = lines[i];

            // JSDoc: /** description */
            if let Some(jc) = jsdoc_re.captures(line) {
                let desc = jc[1].trim().to_string();
                i += 1;
                if i < lines.len() {
                    if let Some(fc) = field_re.captures(lines[i]) {
                        let name = fc[1].to_string();
                        if is_valid_ts_field(&name) {
                            fields.push(ParsedField {
                                name,
                                description: desc,
                            });
                        }
                    }
                }
            }
            // Line comment above field
            else if let Some(lc) = line_comment_re.captures(line) {
                let desc = lc[1].trim().to_string();
                i += 1;
                if i < lines.len() {
                    if let Some(fc) = field_re.captures(lines[i]) {
                        let name = fc[1].to_string();
                        if is_valid_ts_field(&name) {
                            fields.push(ParsedField {
                                name,
                                description: desc,
                            });
                        }
                    }
                }
            }
            // Field with inline comment: name: type; // description
            else if let Some(fc) = field_re.captures(line) {
                let name = fc[1].to_string();
                if is_valid_ts_field(&name) {
                    let desc = inline_comment_re
                        .captures(line)
                        .map(|ic| ic[1].trim().to_string())
                        .unwrap_or_default();
                    fields.push(ParsedField { name, description: desc });
                }
            }

            i += 1;
        }

        if !fields.is_empty() {
            models.push(ParsedModel {
                name: type_name,
                fields,
                file_path: file_path.clone(),
            });
        }
    }

    Ok(())
}

fn is_valid_ts_field(name: &str) -> bool {
    !name.starts_with('_') && name != "constructor"
}

// ── Prisma parser ──────────────────────────────────────────────────

fn parse_prisma_file(path: &Path, models: &mut Vec<ParsedModel>) -> Result<(), String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("无法读取文件 {:?}: {}", path, e))?;
    let file_path = path.to_string_lossy().to_string();

    let model_re = Regex::new(r"(?m)^model\s+(\w+)\s*\{")
        .map_err(|e| format!("正则编译失败: {}", e))?;

    let field_name_re =
        Regex::new(r"^(\w+)\s+").map_err(|e| format!("正则编译失败: {}", e))?;

    let inline_comment_re =
        Regex::new(r"//\s*(.+)$").map_err(|e| format!("正则编译失败: {}", e))?;

    for cap in model_re.captures_iter(&content) {
        let model_name = cap[1].to_string();
        let brace_start = cap.get(0).unwrap().end() - 1;
        let body = extract_brace_block(&content, brace_start);

        let mut fields: Vec<ParsedField> = Vec::new();
        let lines: Vec<&str> = body.lines().collect();
        let mut i = 0;

        while i < lines.len() {
            let trimmed = lines[i].trim();

            if trimmed.starts_with("///") {
                let desc = trimmed.trim_start_matches('/').trim().to_string();
                // Skip blank lines between /// and field
                i += 1;
                while i < lines.len() && lines[i].trim().is_empty() {
                    i += 1;
                }
                if i < lines.len() {
                    let field_line = lines[i].trim();
                    if is_prisma_field_line(field_line) {
                        if let Some(fc) = field_name_re.captures(field_line) {
                            fields.push(ParsedField {
                                name: fc[1].to_string(),
                                description: desc,
                            });
                        }
                    }
                }
            } else if is_prisma_field_line(trimmed) {
                // Field with inline // comment
                if let Some(ic) = inline_comment_re.captures(trimmed) {
                    if let Some(fc) = field_name_re.captures(trimmed) {
                        fields.push(ParsedField {
                            name: fc[1].to_string(),
                            description: ic[1].trim().to_string(),
                        });
                    }
                }
            }

            i += 1;
        }

        if !fields.is_empty() {
            models.push(ParsedModel {
                name: model_name,
                fields,
                file_path: file_path.clone(),
            });
        }
    }

    Ok(())
}

fn is_prisma_field_line(line: &str) -> bool {
    !line.is_empty()
        && !line.starts_with("///")
        && !line.starts_with("//")
        && !line.starts_with("@@")
        && !line.starts_with('@')
}
