pub mod cache;
pub mod introspect;
pub mod persist;
pub mod scanner;

use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Table {
    pub name: String,
    pub columns: Vec<Column>,
    #[serde(default)]
    pub indexes: Vec<Index>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DatabaseSchema {
    pub database_name: String,
    pub tables: Vec<Table>,
    pub captured_at: String,
}
