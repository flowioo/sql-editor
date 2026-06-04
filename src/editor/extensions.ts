// Re-export from schema-source
export { schemaCompletionSource, setSchema } from "../lib/schema-source";
import type { DatabaseSchema } from "../hooks/useSchema";
import { setSchema } from "../lib/schema-source";

export function updateSchemaForAutocomplete(schema: DatabaseSchema): void {
  setSchema(schema);
}
