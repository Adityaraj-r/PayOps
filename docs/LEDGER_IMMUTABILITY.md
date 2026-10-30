# Ledger Immutability Controls and Operational Follow-up

Journal entries are financial facts. A correction must be a new balanced reversal or adjustment that references the original; existing entries and their timestamps are never rewritten.

## Application safeguards implemented

`JournalEntry` Mongoose middleware rejects changes to persisted documents, query updates/replacements/deletes, document deletes, and bulk operations other than inserts. New entries still pass the existing balanced-line validator. The ledger service continues to post journal entries and account balance changes inside MongoDB transactions. Existing historical entries are not migrated or modified.

## Database boundary

Mongoose middleware is not a database security boundary. A caller using the native MongoDB collection/driver, shell, or an administrator credential can bypass it. The current integration test setup and Compose MongoDB are not evidence of restricted production roles. MongoDB collection validators can enforce document shape but cannot prohibit updates/deletes by themselves.

Before describing the production ledger as database-enforced append-only, create a dedicated application MongoDB role that can `find` and `insert` on the journal-entry collection, but cannot `update` or `remove`, and separately grant only required operations on other collections. Use a different controlled migration/admin identity for index creation and schema operations. Verify the deployed application credential's effective roles and test an update/delete denial against a disposable MongoDB replica set. Do not apply role changes to a live database until the owner confirms the existing app user, deployment credentials, access path, and rollback plan.

## Transaction and correction requirements

The ledger posting path requires MongoDB transaction support and writes the entry/account balance changes in the same transaction. A failed operation must roll back both. Reversal and adjustment entries must use normal balanced posting with a unique idempotency key and an explicit reference/reason; they must not mutate the original. Continue running integrity verification and reconciliation after any correction.

## Verification limit

Stage 4 tests exercise Mongoose update/delete paths on synthetic records in a disposable database. They do not prove that production credentials lack direct update/delete privilege. That requires an explicitly provisioned least-privilege database role and a separate disposable role test.
