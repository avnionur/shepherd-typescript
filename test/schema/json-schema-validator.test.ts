import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
    CanonicalNestingLimitError,
    compileJSONSchema,
    isPublicError,
    JSON_SCHEMA_SUPPORTED_KEYWORDS,
    JSONSchemaValidationError,
} from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";

const researchApplications = JSON.parse(
    readFileSync(
        new URL("../../config/research-applications.config.json", import.meta.url),
        "utf8",
    ),
) as Readonly<Record<string, { readonly surfaces: readonly Record<string, unknown>[] }>>;

/** Every pinned schema surface and tool input schema of the repository protocols. */
const pinnedSchemas = Object.values(researchApplications).flatMap((section) =>
    (section.surfaces ?? []).flatMap((surface) => {
        if (surface.kind === "schema") return [[String(surface.id), surface.content] as const];
        if (surface.kind === "tool") {
            return [
                [
                    String(surface.id),
                    (surface.content as { readonly inputSchema: unknown }).inputSchema,
                ] as const,
            ];
        }
        return [];
    }),
);

function nested(depth: number): unknown {
    let value: unknown = null;
    for (let level = 0; level < depth; level += 1) value = [value];
    return value;
}

test("the supported keyword list is closed and every pinned repository schema compiles", () => {
    assert.equal(Object.isFrozen(JSON_SCHEMA_SUPPORTED_KEYWORDS), true);
    assert.ok(pinnedSchemas.length >= 10);
    for (const [id, document] of pinnedSchemas) {
        const validator = compileJSONSchema(document);
        assert.equal(Object.isFrozen(validator), true, id);
        assert.equal(Object.isFrozen(validator.document), true, id);
    }
});

test("documents outside the supported subset are refused at compile time", () => {
    const refused: readonly unknown[] = [
        null,
        1,
        "string",
        [],
        { format: "email" },
        { $ref: "#/x" },
        { $defs: {} },
        { not: {} },
        { type: "decimal" },
        { type: [] },
        { type: ["string", "string"] },
        { type: 1 },
        { enum: [] },
        { enum: "a" },
        { minimum: "1" },
        { maximum: null },
        { exclusiveMinimum: true },
        { minLength: -1 },
        { maxLength: 1.5 },
        { minItems: "1" },
        { pattern: 1 },
        { pattern: "(" },
        { properties: [] },
        { properties: null },
        { properties: { a: 1 } },
        { required: ["a", "a"] },
        { required: [1] },
        { required: "a" },
        { uniqueItems: "yes" },
        { items: [] },
        { additionalProperties: "no" },
        { oneOf: [] },
        { anyOf: {} },
        { allOf: [1] },
        { title: 1 },
        { description: false },
        { $comment: [] },
        { $schema: "https://json-schema.org/draft-07/schema" },
        { items: { $schema: kernelProtocolConfig.schemas.dialect } },
        { minimum: Number.NaN },
    ];
    for (const document of refused) {
        assert.throws(
            () => compileJSONSchema(document),
            (error: unknown) => error instanceof TypeError && !isPublicError(error),
            JSON.stringify(document),
        );
    }
    let accessed = false;
    assert.throws(
        () =>
            compileJSONSchema({
                get type() {
                    accessed = true;
                    return "string";
                },
            }),
        TypeError,
    );
    assert.equal(accessed, false);
    const cyclic: Record<string, unknown> = {};
    cyclic.items = cyclic;
    assert.throws(() => compileJSONSchema(cyclic), TypeError);
    assert.throws(
        () => compileJSONSchema(nested(kernelProtocolConfig.canonicalization.maxNestingDepth + 1)),
        CanonicalNestingLimitError,
    );
    assert.deepEqual(
        compileJSONSchema({
            $comment: "c",
            $schema: kernelProtocolConfig.schemas.dialect,
            description: "d",
            title: "t",
        }).validate(1),
        [],
    );
});

test("every keyword reports path-level issues with keyword and schema location", () => {
    const validator = compileJSONSchema({
        type: "object",
        additionalProperties: false,
        properties: {
            count: { type: "integer", minimum: 1, maximum: 3 },
            ratio: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
            name: { type: "string", minLength: 2, maxLength: 3, pattern: "^[a-z]+$" },
            tags: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 2,
                uniqueItems: true,
            },
            mode: { enum: ["a", null, { x: 1 }] },
            fixed: { const: { b: 1, a: [2] } },
            "odd key": { type: "boolean" },
            "a/b~c": false,
        },
        required: ["count", "missing"],
    });
    assert.deepEqual(validator.validate({ count: 2, mode: { x: 1 }, fixed: { a: [2], b: 1 } }), [
        {
            keyword: "required",
            message: "is required",
            path: "$.missing",
            schemaPath: "#/required",
        },
    ]);
    const issues = validator.validate({
        count: 1.5,
        ratio: 1,
        name: "ABCD",
        tags: ["x", "x", 3],
        mode: "b",
        fixed: { a: [3], b: 1 },
        "odd key": "no",
        "a/b~c": 1,
        extra: true,
        missing: null,
    });
    assert.deepEqual(
        issues.map((issue) => [issue.path, issue.keyword, issue.schemaPath]),
        [
            ['$["a/b~c"]', "false", "#/properties/a~1b~0c"],
            ["$.count", "type", "#/properties/count/type"],
            ["$.extra", "additionalProperties", "#/additionalProperties"],
            ["$.fixed", "const", "#/properties/fixed/const"],
            ["$.missing", "additionalProperties", "#/additionalProperties"],
            ["$.mode", "enum", "#/properties/mode/enum"],
            ["$.name", "maxLength", "#/properties/name/maxLength"],
            ["$.name", "pattern", "#/properties/name/pattern"],
            ['$["odd key"]', "type", "#/properties/odd key/type"],
            ["$.ratio", "exclusiveMaximum", "#/properties/ratio/exclusiveMaximum"],
            ["$.tags", "maxItems", "#/properties/tags/maxItems"],
            ["$.tags[1]", "uniqueItems", "#/properties/tags/uniqueItems"],
            ["$.tags[2]", "type", "#/properties/tags/items/type"],
        ],
    );
    assert.deepEqual(
        compileJSONSchema({
            type: "object",
            properties: {
                count: { minimum: 1, exclusiveMinimum: 1, maximum: 0 },
                name: { minLength: 2 },
                tags: { minItems: 1 },
            },
        })
            .validate({ count: 1, name: "é", tags: [] })
            .map((issue) => `${issue.path} ${issue.keyword} ${issue.message}`),
        [
            "$.count maximum must be <= 0",
            "$.count exclusiveMinimum must be > 1",
            "$.name minLength must contain at least 2 character(s)",
            "$.tags minItems must contain at least 1 item(s)",
        ],
    );
    // Lengths count code points, and open objects validate declared members only.
    assert.deepEqual(compileJSONSchema({ maxLength: 1 }).validate("😀"), []);
    assert.deepEqual(compileJSONSchema({ type: "object" }).validate({ any: [1, { x: null }] }), []);
    assert.deepEqual(
        compileJSONSchema({ type: "object", additionalProperties: { type: "number" } }).validate({
            a: 1,
            b: "x",
        }),
        [
            {
                keyword: "type",
                message: "must be number",
                path: "$.b",
                schemaPath: "#/additionalProperties/type",
            },
        ],
    );
});

test("type unions, integers, and boolean schemas follow JSON Schema semantics", () => {
    const nullable = compileJSONSchema({ type: ["string", "null"] });
    assert.deepEqual(nullable.validate(null), []);
    assert.deepEqual(nullable.validate("x"), []);
    assert.equal(nullable.validate(1)[0]?.message, "must be string or null");
    const integer = compileJSONSchema({ type: "integer" });
    assert.deepEqual(integer.validate(2), []);
    assert.deepEqual(integer.validate(1e21), []);
    assert.equal(integer.validate(2.5).length, 1);
    assert.equal(integer.validate("2").length, 1);
    for (const [name, valid, invalid] of [
        ["array", [], {}],
        ["boolean", false, 0],
        ["number", 0.5, "0.5"],
        ["object", {}, []],
        ["null", null, 0],
        ["string", "", null],
    ] as const) {
        assert.deepEqual(compileJSONSchema({ type: name }).validate(valid), [], name);
        assert.equal(compileJSONSchema({ type: name }).validate(invalid).length, 1, name);
    }
    assert.deepEqual(compileJSONSchema(true).validate({ anything: [1] }), []);
    assert.deepEqual(compileJSONSchema(false).validate(null), [
        { keyword: "false", message: "is not allowed", path: "$", schemaPath: "#" },
    ]);
});

test("combinators report none, ambiguous, and every branch issue", () => {
    const forkPoint = compileJSONSchema({
        oneOf: [
            { type: "null" },
            {
                type: "object",
                properties: { step_index: { type: "integer", minimum: 1 } },
                required: ["step_index"],
            },
        ],
    });
    assert.deepEqual(forkPoint.validate(null), []);
    assert.deepEqual(forkPoint.validate({ step_index: 2 }), []);
    assert.deepEqual(
        forkPoint.validate({ step_index: 0 }).map((issue) => [issue.path, issue.schemaPath]),
        [
            ["$", "#/oneOf"],
            ["$", "#/oneOf/0/type"],
            ["$.step_index", "#/oneOf/1/properties/step_index/minimum"],
        ],
    );
    const ambiguous = compileJSONSchema({ oneOf: [{ type: "number" }, { type: "integer" }] });
    assert.deepEqual(ambiguous.validate(0.5), []);
    assert.deepEqual(ambiguous.validate(1), [
        {
            keyword: "oneOf",
            message: "must match exactly one oneOf member; it matches members 0, 1",
            path: "$",
            schemaPath: "#/oneOf",
        },
    ]);
    const any = compileJSONSchema({ anyOf: [{ type: "number" }, { type: "integer" }] });
    assert.deepEqual(any.validate(1), []);
    assert.deepEqual(
        any.validate("x").map((issue) => issue.schemaPath),
        ["#/anyOf", "#/anyOf/0/type", "#/anyOf/1/type"],
    );
    const all = compileJSONSchema({ allOf: [{ type: "string" }, { minLength: 2 }] });
    assert.deepEqual(all.validate("ab"), []);
    assert.deepEqual(
        all.validate("a").map((issue) => issue.schemaPath),
        ["#/allOf/1/minLength"],
    );
});

test("values must be canonical JSON data and parse returns a frozen snapshot", () => {
    const validator = compileJSONSchema({ type: "object", properties: { a: { type: "number" } } });
    const nonJson: readonly unknown[] = [
        undefined,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "\uD800",
        () => 1,
        new Date(0),
        Object.defineProperty({}, "a", { enumerable: true, get: () => 1 }),
    ];
    for (const value of nonJson) {
        assert.deepEqual(validator.validate(value), [
            { keyword: "json", message: "must be canonical JSON data", path: "$", schemaPath: "#" },
        ]);
    }
    assert.throws(
        () => validator.validate(nested(kernelProtocolConfig.canonicalization.maxNestingDepth + 1)),
        CanonicalNestingLimitError,
    );
    assert.throws(
        () => validator.parse(nested(kernelProtocolConfig.canonicalization.maxNestingDepth + 1)),
        CanonicalNestingLimitError,
    );
    const parsed = validator.parse({ b: [1], a: 2 }) as Readonly<Record<string, unknown>>;
    assert.deepEqual(parsed, { a: 2, b: [1] });
    assert.deepEqual(Object.keys(parsed), ["a", "b"]);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.b), true);
    assert.throws(
        () => validator.parse({ a: "x" }, "tool input"),
        (error: unknown) =>
            error instanceof JSONSchemaValidationError &&
            error instanceof TypeError &&
            isPublicError(error) &&
            error.code === "SCHEMA_VALIDATION_FAILED" &&
            error.message === "tool input: $.a must be number" &&
            Object.isFrozen(error.issues) &&
            Object.isFrozen(error.issues[0]),
    );
    assert.throws(
        () => validator.parse(undefined),
        (error: unknown) =>
            error instanceof JSONSchemaValidationError &&
            error.message === "$ must be canonical JSON data",
    );
});

test("validity agrees with an independent 2020-12 validator on pinned repository schemas", () => {
    const ajv = new Ajv2020({ allowUnionTypes: true, strict: false });
    const samples: readonly unknown[] = [
        null,
        0,
        -1,
        1.5,
        "",
        "x",
        true,
        [],
        [1, 1],
        ["a", "b"],
        {},
        { kind: "observe", reason: null, worker_id: null },
        { kind: "inject", reason: "r", worker_id: "a" },
        { kind: "merge", reason: null, worker_id: null },
        { kind: "observe", reason: 1, worker_id: null },
        { kind: "observe", reason: null, worker_id: null, extra: 1 },
        { conflict: "none", round: 1, workers: [] },
        { conflict: "none", round: 0, workers: [] },
        {
            conflict: "path_overlap",
            round: 2,
            workers: [
                { changed_paths: ["a"], completion_status: null, status: "ready", worker_id: "a" },
            ],
        },
        {
            conflict: "none",
            round: 1,
            workers: [
                { changed_paths: [1], completion_status: "done", status: "ready", worker_id: "a" },
            ],
        },
        { fork_point: null, hint: null },
        { fork_point: { prefix_id: "p", session_id: "s", step_index: 1 }, hint: null },
        { fork_point: { prefix_id: "p", session_id: "s", step_index: 0 }, hint: null },
        {
            fork_point: { prefix_id: "p", session_id: "s", step_index: 2 },
            hint: { cited_step_indices: [1, 1], text: "t" },
        },
        {
            fork_point: { prefix_id: "p", session_id: "s", step_index: 2 },
            hint: { cited_step_indices: [0, 1], text: "" },
        },
        { candidates: [], promoted_candidate_id: null },
        {
            candidates: [{ candidate_id: "c", parent_candidate_id: null, status: "promoted" }],
            promoted_candidate_id: "c",
        },
        {
            candidates: [{ candidate_id: "c", parent_candidate_id: null, status: "merged" }],
            promoted_candidate_id: "c",
        },
        { fix_set: [], guard_set: [], observations: ["o"], parent: null },
        { changes: ["task"], name: "n", parent: null, step_index: 0 },
        { changes: [], name: "n", parent: null, step_index: 0 },
        { changes: ["task", "task"], name: "n", parent: "p", step_index: 0 },
        { cited_record_ids: [], data: {}, worker_id: "a" },
        { cited_record_ids: [], data: [], worker_id: "a" },
        { application_id: "x" },
        {
            fork_point: { prefix_id: null, step_index: 0 },
            inter_branch_advantage: 0.5,
            intra_branch_advantage: -1,
            replay_session_id: "r",
            reward: 1,
            rollout_id: "o",
            seed: 3,
            session_id: "s",
            step_count: 2,
        },
        {
            fork_point: { prefix_id: 1, step_index: -1 },
            inter_branch_advantage: 0.5,
            intra_branch_advantage: -1,
            replay_session_id: "r",
            reward: 1,
            rollout_id: "o",
            seed: 3.5,
            session_id: "s",
            step_count: 2,
        },
    ];
    for (const [id, document] of pinnedSchemas) {
        const validator = compileJSONSchema(document);
        const reference = ajv.compile(document as object);
        for (const sample of samples) {
            assert.equal(
                validator.validate(sample).length === 0,
                reference(sample),
                `${id}: ${JSON.stringify(sample)}`,
            );
        }
    }
});
