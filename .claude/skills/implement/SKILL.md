---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /preserve-capabilities before editing to inventory affected and adjacent
behavior. Use /tdd at pre-agreed seams for every changed behavior. When no correct
automated seam exists, document the gap and define a repeatable verification before
proceeding.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /preserve-capabilities to close the capability matrix, then use
/code-review to review the work.

Commit your work to the current branch.
