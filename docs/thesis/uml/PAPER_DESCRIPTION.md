# UML Class Diagram Description

**Figure X. Core UML Class Diagram**

Figure X presents the system's core UML class diagram, describing its principal domain classes, essential attributes, selected conceptual operations, and relationships. The User and Project classes establish the account and project context, including the assignment of Site Personnel to project sites. MRF and MRFItem represent material requests and their constituent items, with composition indicating that each requested item belongs to one MRF. Supplier, Quotation, and PurchaseOrder represent purchasing information, allowing a material request to be associated with multiple supplier offers and purchase orders. The supplier associated with a purchase order is represented separately from the supplier of its source quotation. All monetary amounts in this model are expressed in Philippine pesos (PHP).

VerifiedPayment represents Accounting's verification of external supplier payments, including partial settlements under credit terms. Delivery represents an individual purchasing or site-transfer trip and must be associated with exactly one PurchaseOrder or StockTransfer. StockTransfer identifies the source and destination projects for internal material fulfillment, while InventoryMovement records receipts, usage, adjustments, and transfer-related stock changes. Project stock balances are derived from these movements. Association multiplicities specify the permitted number of related objects, and the selected operations summarize the business responsibilities of each class. The model maintains the distinction between payment verification, delivery clearance, receiving, and inventory posting.

## Basis

The description follows the [approved class specification](CLASS_MODEL.md), [exported diagram](README.md), and [current application workflow](../../WORKFLOW.md). [Research notes](../research/uml-description-basis.md) distinguish published UML conventions from the application-specific relationships. Replace Figure X with the paper's assigned figure number.
