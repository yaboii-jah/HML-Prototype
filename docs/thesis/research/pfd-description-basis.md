# Basis for the six process flowchart descriptions

Research checked: 2026-10-13. This note supports concise academic descriptions of the active diagrams. The external sources establish general flowchart conventions; project sequences and rules come from local workflow documentation. These sources are methodological guidance, not additions to the recent RRL list.

## General conventions from primary sources

- A flowchart depicts a sequence of activities, decisions, inputs/outputs and involved personnel. Its scope, starting point, ending point and level of detail should be defined before the activities are arranged and connected. This supports describing each figure through its entry event, responsible roles, material decisions and outcome. See [ASQ, Flowchart](https://asq.org/quality-resources/flowchart), sections Overview and Flowchart Basic Procedure; the page reports review in June 2025.
- Activity boxes, decision diamonds, start/end shapes and directional connectors have common uses, but symbol meanings are not universally fixed. Subprocess shapes can refer to details defined elsewhere, and references can connect parts of a larger flow. Describe the figures as ordinary process flowcharts rather than assuming formal BPMN execution semantics. See [Microsoft, Create a basic flowchart in Visio](https://support.microsoft.com/en-us/visio/create-a-basic-flowchart-in-visio), section What the flowchart shapes represent.
- A complex process may be represented by an overview and separate subprocess diagrams. This supports the current presentation of one overview followed by five focused figures; it does not establish a universal requirement to use six figures. See [Microsoft, Create subprocesses and reuse them in a process diagram](https://support.microsoft.com/en-gb/visio/create-subprocesses-and-reuse-them-in-a-process-diagram).

## Local facts to describe

The active figure definitions in [flows.mjs](../pfd/flows.mjs) and explanations in [the PFD README](../pfd/README.md) determine what each figure shows. [WORKFLOW.md](../../WORKFLOW.md) establishes the operating rules. [The production design basis](../PRODUCTION_DESIGN.md) identifies the diagrams as the intended production design, rather than evidence that production infrastructure is already deployed.

| Order and figure | Accurate content for the description |
|---|---|
| 1. Request and fulfillment overview | Begins with a ready project. Site Personnel submit a material request form (MRF); the Project Manager approves, returns or rejects it. Procurement checks stock and allocates approved quantities to purchasing, site transfer or both. Supplier clearance and transfer dispatch lead to receiving; accepted stock and reviewed documents are separate milestones. |
| 2. Supplier purchasing and PO approval | Begins with quantities allocated for purchase. Procurement evaluates offers, selects suppliers, and prepares and submits purchase orders (POs). Accounting reviews costs, budget and terms, with hold, return, rejection or approval outcomes. Approved POs are archived and issued by Procurement before payment coordination starts. |
| 3. Payment coordination and delivery clearance | Begins with supplier PO issuance. Finance coordinates payments made outside the application; Accounting archives proof and verifies paid amounts. Upfront delivery requires full verified net payment followed by Accounting clearance. Under credit terms, delivery clearance and payment coordination proceed independently; outstanding balances receive follow-up until settlement. |
| 4. Inter-site stock transfer | Begins with quantities allocated for transfer. Procurement confirms suitability and rechecks stock; destination suitability review occurs when required. Source Site Personnel authorize all or part of the release. Unreleased quantities return to sourcing; Logistics schedules and dispatches released quantities. Dispatch deducts source stock before destination receiving. Transfers require no supplier PO, purchasing payment or budget charge. |
| 5. Delivery, receiving and inventory | Begins with a cleared supplier delivery or an already dispatched site transfer. Logistics schedules supplier delivery directly to the site or through a warehouse. Procurement records warehouse receipt; Logistics forwards those materials to the original destination. Site Personnel record accepted quantities and discrepancies and post accepted site stock. Receipt evidence proceeds independently to review. Missing transfer quantities return to sourcing without restoring dispatched source stock. |
| 6. Receipt documentation and review | Begins when warehouse or site receipt evidence becomes available. Receiving teams archive generated and current signed receipts. Accounting checks applicable evidence; incomplete or unacceptable evidence returns for correction and re-archiving. Review completion remains independent of inventory posting and payment settlement. Transfer receipts do not require a supplier invoice or payment proof. |

## Wording and factual pitfalls

- Use “process flow diagram” or “process flowchart” consistently. These figures describe activities and decisions, unlike DFDs, which describe information flows.
- Do not imply that the six figures form one mandatory consecutive path. Purchasing and transfer quantities may fulfill one MRF independently.
- Do not describe PO approval alone as the entry to payment coordination: the chart starts with PO issuance to the supplier.
- Destination suitability review is conditional. Current new matching selections proceed to source release after Procurement confirmation; existing submitted reviews remain actionable. Suitability approval does not authorize source release. See WORKFLOW.md, Site Stock Transfers.
- Finance coordinates external payment; Accounting verifies payment and grants supplier delivery clearance. Finance status alone grants neither verified payment nor clearance. See WORKFLOW.md, Full Disbursement / Upfront, Credit / Terms and Finance Follow-up.
- Credit settlement does not trigger another delivery. Avoid depicting the Credit connector as a synchronization gateway or a payment prerequisite for delivery.
- Warehouse receipt does not post destination site stock. Site stock posting and receipt review do not wait for one another. See WORKFLOW.md, Delivery, Inventory and Documents.
- Apply the return-to-sourcing shortage branch to transfers. Supplier discrepancies remain associated with their PO and delivery records; additional supplier batches may be pending.
- Do not conclude every paragraph with a claim of automatic MRF closure, efficiency improvement or successful implementation. The local workflow states that payment, delivery, inventory and document completion are separate milestones with no single automatic MRF closure rule.

For the paper, one concise paragraph per figure can explain these local facts without in-text references. Keep the primary-source links in this supporting note.
