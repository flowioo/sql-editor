# SQL Query Editor — Tauri v2 + CodeMirror 6

## Architecture
- Frontend: TypeScript + CodeMirror 6 (@codemirror/vim, @codemirror/lang-sql)
- Backend: Rust + Tauri v2 (sqlx for DB drivers, russh for SSH tunnel)
- Local cache: schema_cache.db (SQLite) for schema snapshots + column descriptions
- AI SQL: local CCR proxy (localhost:3456) for NL→SQL generation

## Key Conventions
- Rust: modules in src-tauri/src/ organized by domain (db/, schema/, commands/, tunnel/, crypto/)
- TypeScript: components in src/ organized by feature (editor/, result/, sidebar/, ai/, hooks/, lib/)
- Immutable data patterns (no in-place mutation)
- Files < 400 lines, functions < 50 lines
- All user-facing text in Chinese

## Commands
- `cd src-tauri && cargo build` — build Rust backend
- `cd src-tauri && cargo test` — run Rust tests
- `npm run dev` — start Tauri dev server
- `npm run build` — production build

## Design Docs
- docs/tech-proposal.html — full technical proposal (open in browser)
- docs/prototype.html — interactive UI prototype (open in browser)
