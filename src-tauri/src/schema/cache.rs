use std::collections::HashMap;
use crate::schema::DatabaseSchema;

pub struct SchemaCache {
    schemas: HashMap<String, DatabaseSchema>,
}

impl SchemaCache {
    pub fn new() -> Self {
        Self {
            schemas: HashMap::new(),
        }
    }

    pub fn get(&self, connection_key: &str) -> Option<&DatabaseSchema> {
        self.schemas.get(connection_key)
    }

    pub fn set(&mut self, connection_key: String, schema: DatabaseSchema) {
        self.schemas.insert(connection_key, schema);
    }

    pub fn remove(&mut self, connection_key: &str) {
        self.schemas.remove(connection_key);
    }

    pub fn clear(&mut self) {
        self.schemas.clear();
    }
}
