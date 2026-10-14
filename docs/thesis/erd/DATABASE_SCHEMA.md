# ConstructSync Core Database Schema

These tables describe the 11 entities shown in the current [core ERD](README.md). Field names, ordering, keys, and foreign-key references follow the [ERD model](model.mjs) and [data dictionary](DATA_DICTIONARY.md). Supporting item, scope, assignment, document, and history tables remain outside this core view.

Data types use SQL-style names: UUID, TEXT, DECIMAL, BOOLEAN, DATE, and TIMESTAMP. A database engine, text lengths, decimal precision, defaults, and additional required-field rules have not been selected here.

**Legend:** PK = primary key; FK = foreign key referencing the specified table and field; nullable = the foreign key may be empty, subject to any stated table constraint; — = no additional constraint specified in the core ERD.

## User

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| user_id | UUID | PK |
| name | TEXT | — |
| email | TEXT | — |
| role | TEXT | — |
| active | BOOLEAN | — |
| created_at | TIMESTAMP | — |

**Table 1. User (APP_USER)**

## Project

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| project_id | UUID | PK |
| name | TEXT | — |
| location | TEXT | — |
| budget | DECIMAL | — |
| drive_folder_id | TEXT | — |

**Table 2. Project (PROJECT)**

## Supplier

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| supplier_id | UUID | PK |
| name | TEXT | — |
| contact | TEXT | — |
| email | TEXT | — |
| phone | TEXT | — |
| tin | TEXT | — |
| address | TEXT | — |

**Table 3. Supplier (SUPPLIER)**

## MRF

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| mrf_id | UUID | PK |
| project_id | UUID | FK → PROJECT.project_id |
| requested_by | UUID | FK → APP_USER.user_id |
| reference | TEXT | — |
| request_date | DATE | — |
| status | TEXT | — |
| instructions | TEXT | — |

**Table 4. MRF (MRF)**

## MRF Item

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| item_id | UUID | PK |
| mrf_id | UUID | FK → MRF.mrf_id |
| material_name | TEXT | — |
| quantity | DECIMAL | — |
| unit | TEXT | — |
| needed_date | DATE | — |
| location | TEXT | — |
| remarks | TEXT | — |

**Table 5. MRF Item (MRF_ITEM)**

## Quotation

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| quotation_id | UUID | PK |
| mrf_id | UUID | FK → MRF.mrf_id |
| supplier_id | UUID | FK → SUPPLIER.supplier_id |
| reference | TEXT | — |
| quote_date | DATE | — |
| currency | TEXT | — |
| review_status | TEXT | — |
| source_reference | TEXT | — |

**Table 6. Quotation (QUOTATION)**

## Purchase Order

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| po_id | UUID | PK |
| mrf_id | UUID | FK → MRF.mrf_id |
| quotation_id | UUID | FK → QUOTATION.quotation_id |
| supplier_id | UUID | FK → SUPPLIER.supplier_id |
| reference | TEXT | — |
| payment_mode | TEXT | — |
| status | TEXT | — |
| gross_amount | DECIMAL | — |
| net_payable | DECIMAL | — |
| priority | TEXT | — |
| planned_date | DATE | — |
| due_date | DATE | — |

**Table 7. Purchase Order (PURCHASE_ORDER)**

## Verified Payment

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| payment_id | UUID | PK |
| po_id | UUID | FK → PURCHASE_ORDER.po_id |
| amount | DECIMAL | — |
| method | TEXT | — |
| reference | TEXT | — |
| payment_date | DATE | — |
| verified_at | TIMESTAMP | — |
| proof_reference | TEXT | — |

**Table 8. Verified Payment (PAYMENT)**

## Delivery

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| delivery_id | UUID | PK |
| po_id | UUID | FK → PURCHASE_ORDER.po_id; nullable |
| transfer_id | UUID | FK → STOCK_TRANSFER.transfer_id; nullable |
| reference | TEXT | — |
| leg | TEXT | — |
| scheduled_date | DATE | — |
| received_at | TIMESTAMP | — |
| status | TEXT | — |
| destination | TEXT | — |

**Table 9. Delivery (DELIVERY)**

**Table constraint:** Exactly one of po_id or transfer_id must be populated (PO XOR transfer). Both populated and both empty are invalid. This is a constraint, not an additional stored field.

## Inventory Movement

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| movement_id | UUID | PK |
| project_id | UUID | FK → PROJECT.project_id |
| delivery_id | UUID | FK → DELIVERY.delivery_id; nullable |
| material_name | TEXT | — |
| unit | TEXT | — |
| kind | TEXT | — |
| quantity | DECIMAL | — |
| occurred_at | TIMESTAMP | — |

**Table 10. Inventory Movement (INVENTORY_MOVEMENT)**

## Stock Transfer

| Field Name | Data Type | Key/Constraint |
|---|---|---|
| transfer_id | UUID | PK |
| mrf_id | UUID | FK → MRF.mrf_id |
| source_id | UUID | FK → PROJECT.project_id |
| destination_id | UUID | FK → PROJECT.project_id |
| reference | TEXT | — |
| status | TEXT | — |
| created_at | TIMESTAMP | — |

**Table 11. Stock Transfer (STOCK_TRANSFER)**
