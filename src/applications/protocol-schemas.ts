import type { SemanticValue } from "../canonical/canonical-record.ts";
import { APPLICATION_PROTOCOL_SURFACES } from "../protocol/values.generated.ts";
import { compileJSONSchema, type JSONSchemaValidator } from "../schema/json-schema-validator.ts";
import type { ApplicationProtocolDefinition } from "./types.ts";

const [, SCHEMA_KIND] = APPLICATION_PROTOCOL_SURFACES;

/** One compiled `schema` surface of an application protocol. @internal */
export type ApplicationSchemaSurface = {
    /** Surface identity. */
    readonly id: string;
    /** Validator compiled from the surface content. */
    readonly validator: JSONSchemaValidator;
};

/**
 * Compiles every `schema` surface of one protocol declaring `role`.
 *
 * Readers call this after `readApplicationProtocol`, which already refused, as
 * `ApplicationProtocolError`, every schema surface outside the supported JSON Schema subset.
 * @internal
 */
export function compileApplicationSchemaSurfaces(
    definition: ApplicationProtocolDefinition,
    role: string,
): readonly ApplicationSchemaSurface[] {
    return Object.freeze(
        definition.surfaces
            .filter((surface) => surface.kind === SCHEMA_KIND && surface.role === role)
            .map((surface) =>
                Object.freeze({ id: surface.id, validator: compileJSONSchema(surface.content) }),
            ),
    );
}

/**
 * Validates one application protocol message against every compiled surface of its role.
 *
 * @throws {JSONSchemaValidationError} Naming the subject and surface, with every path-level issue.
 * @internal
 */
export function assertApplicationMessage(
    surfaces: readonly ApplicationSchemaSurface[],
    message: SemanticValue,
    subject: string,
): void {
    for (const surface of surfaces) {
        surface.validator.parse(message, `${subject} violates schema surface ${surface.id}`);
    }
}
