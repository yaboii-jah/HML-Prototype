# Basis for the ConstructSync UML class diagram description

Research checked: 2026-10-14. This note supports an academic description of the current class diagram. External sources establish UML conventions; the class specification and local workflow establish ConstructSync's modeled responsibilities and relationships. These methodological references are not additional empirical findings or entries in the recent RRL list.

## General conventions from primary sources

- A class diagram presents a static model of classes, their attributes, supported behavior, and relationships. It does not specify the sequence of workflow activities or the algorithms implementing operations. Class rectangles may contain separate name, attribute, and operation compartments. See [Sparx Systems, Class Diagram](https://sparxsystems.com/resources/tutorials/uml2/class-diagram.html), sections Class Diagrams and Class Notation.
- An association expresses a structural connection. Named association ends and multiplicities describe related objects; `1` means exactly one, `0..1` means zero or one, and `0..*` means zero or more. See [Sparx Systems, Cardinality](https://www.sparxsystems.com/enterprise_architect_user_guide/17.2/the_model_repository/cardinality.html).
- Composition is indicated by a filled diamond at the whole. A part can belong to at most one composite at a time. See [Sparx Systems, Class Diagram](https://sparxsystems.com/resources/tutorials/uml2/class-diagram.html), section Aggregations. This domain ownership notation does not independently establish a database deletion policy.
- Cornell University's CS 5150 teaching material explains that diagrams provide an overview of principal design elements and their relationships, while specifications supply detail. Its class notation distinguishes class names, attributes, and supported operations, and its class-selection guidance starts with terms and responsibilities used in the domain. See [William Y. Arms, Object Oriented Program Design](https://www.cs.cornell.edu/courses/cs5150/2014fa/slides/E3-OOdesign.pdf), PDF pages 4, 7, 14, and 22. This is an academic teaching reference, rather than an evaluation of ConstructSync.

## Local facts to describe

The [class specification](../uml/CLASS_MODEL.md) supplies class meanings and association constraints. The [diagram README](../uml/README.md) identifies the exported figure and notation. [WORKFLOW.md](../../WORKFLOW.md) and [the production design basis](../PRODUCTION_DESIGN.md) establish the intended operating context.

| Aspect | Accurate content for the description |
|---|---|
| Overview | The figure contains 11 core classes, 53 selected attributes, 24 conceptual operations, and 17 associations. Supporting item, scope, document, and history structures are outside this view. |
| Accounts and projects | User represents an account with a department role; Project represents project details and budget. User-Project assignments apply to Site Personnel. Departments are role values, not User subclasses. |
| Requests and purchasing | A Project has MRFs; each MRF contains MRFItems through composition. A request can have multiple supplier Quotations, PurchaseOrders, and StockTransfers. Supplier relates independently to quotations and orders. |
| Payment records | A PurchaseOrder can have several VerifiedPayments, including partial credit payments. Payment verification and supplier delivery clearance are distinct responsibilities. |
| Deliveries and transfers | A Delivery belongs exclusively to one PurchaseOrder or one StockTransfer. Transfers identify distinct source and destination projects; the destination is the MRF's project. |
| Inventory | Each InventoryMovement belongs to a Project and records a stock effect. Its Delivery link is optional, allowing usage and adjustments without a delivery. Balances are derived from movements. |
| Operations | Selected operations express domain responsibilities. The application mainly uses TypeScript records and command functions; the diagram is not a claim that these are implemented instance methods. |

## Wording and factual pitfalls

- Describe structure and responsibilities, avoiding chronological language that treats association lines as control flow.
- Refer to selected or conceptual operations; do not invent additional methods or imply a refactor into implemented classes.
- Explain that exactly one Delivery owner is required. Two individually optional links do not permit both owners or neither.
- MRFItem composition describes domain ownership. Drafts may have no items; submission requires at least one valid item. Do not infer a cascade-delete rule.
- Keep payment verification, delivery clearance, receipt confirmation, and inventory posting distinct. Credit delivery may proceed with an unpaid balance; receiving alone does not post site stock.
- Do not claim automatic MRF closure, efficiency gains, stronger security, or successful production deployment from the figure.

For the paper, use a short description of the principal classes and structural relationships. Retain the primary-source links in this supporting note when a figure description does not require in-text methodological citations.
