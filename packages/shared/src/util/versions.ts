/**
 * Version stamps that participate in cache keys and provenance records.
 *
 * Any change to parsing, adaptation or validation semantics MUST bump the
 * corresponding constant, otherwise cached artefacts produced by the old
 * implementation will be silently reused (spec section 24).
 */
export const PARSER_VERSION = '1.0.0';
export const DESIGN_IR_VERSION = '1.0.0';
export const ADAPTATION_ENGINE_VERSION = '1.0.0';
export const VALIDATION_ENGINE_VERSION = '1.0.0';
export const DEVICE_CATALOG_SCHEMA_VERSION = '1.0.0';
