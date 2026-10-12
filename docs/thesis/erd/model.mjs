// Core business view; detailed line, document and history structures remain outside the figure.
const field = (name, type, key = "", reference = "", nullable = false) => ({ name, type, key, reference, nullable, unique: false });
const pk = name => field(name, "uuid", "PK");
const fk = (name, target, nullable = false) => field(name, "uuid", "FK", target, nullable);
const col = (name, type = "string") => field(name, type);
const entity = (name, title, color, position, purpose, fields) => ({ name, title, color, position, purpose, fields });

export const model = {
  title: "ConstructSync Core Entity Relationship Diagram",
  version: "6.0",
  verifiedDate: "2026-10-11",
  width: 960,
  height: 860,
  printWidthMm: 160,
  fontSize: 17.2,
  headerFontSize: 18.4,
  entities: [
    entity("APP_USER", "User", "#BCD8F7", [20,20], "A named user with one of the seven roles; Administrator is a role, not a separate entity.", [pk("user_id"),col("name"),col("email"),col("role"),col("active","boolean"),col("created_at","datetime")]),
    entity("PROJECT", "Project", "#FFDD8A", [260,20], "A construction project with its allocated budget, site location and Drive archive folder.", [pk("project_id"),col("name"),col("location"),col("budget","decimal"),col("drive_folder_id")]),
    entity("SUPPLIER", "Supplier", "#BBE6CC", [740,20], "Supplier contact and business details used by quotations and POs.", [pk("supplier_id"),col("name"),col("contact"),col("email"),col("phone"),col("tin"),col("address")]),
    entity("MRF", "MRF", "#DAC8F1", [260,300], "A project material request created by Site Personnel and reviewed by the Project Manager.", [pk("mrf_id"),fk("project_id","PROJECT.project_id"),fk("requested_by","APP_USER.user_id"),col("reference"),col("request_date","date"),col("status"),col("instructions")]),
    entity("MRF_ITEM", "MRF Item", "#F5C3D6", [20,300], "One requested material, quantity, unit, required date and delivery location.", [pk("item_id"),fk("mrf_id","MRF.mrf_id"),col("material_name"),col("quantity","decimal"),col("unit"),col("needed_date","date"),col("location"),col("remarks")]),
    entity("QUOTATION", "Quotation", "#BAE8E7", [740,300], "A dated supplier offer for an MRF with its currency, review status and source reference.", [pk("quotation_id"),fk("mrf_id","MRF.mrf_id"),fk("supplier_id","SUPPLIER.supplier_id"),col("reference"),col("quote_date","date"),col("currency"),col("review_status"),col("source_reference")]),
    entity("PURCHASE_ORDER", "Purchase Order", "#BBC5F4", [500,20], "An order sourced from a quotation, with the actual supplier, reviewed amounts, payment mode and Finance scheduling fields.", [pk("po_id"),fk("mrf_id","MRF.mrf_id"),fk("quotation_id","QUOTATION.quotation_id"),fk("supplier_id","SUPPLIER.supplier_id"),col("reference"),col("payment_mode"),col("status"),col("gross_amount","decimal"),col("net_payable","decimal"),col("priority"),col("planned_date","date"),col("due_date","date")]),
    entity("PAYMENT", "Verified Payment", "#F7C99E", [500,430], "Accounting's verification of an external supplier payment using archived proof.", [pk("payment_id"),fk("po_id","PURCHASE_ORDER.po_id"),col("amount","decimal"),col("method"),col("reference"),col("payment_date","date"),col("verified_at","datetime"),col("proof_reference")]),
    entity("DELIVERY", "Delivery", "#DCEB9F", [740,600], "One scheduled supplier-to-site, supplier-to-warehouse or warehouse-to-site batch with its receipt milestone.", [pk("delivery_id"),fk("po_id","PURCHASE_ORDER.po_id"),col("reference"),col("leg"),col("scheduled_date","date"),col("received_at","datetime"),col("status"),col("destination")]),
    entity("INVENTORY_MOVEMENT", "Inventory Movement", "#D2D9E0", [260,600], "A material-specific project stock receipt, usage or adjustment; balances are derived from movements.", [pk("movement_id"),fk("project_id","PROJECT.project_id"),fk("delivery_id","DELIVERY.delivery_id",true),col("material_name"),col("unit"),col("kind"),col("quantity","decimal"),col("occurred_at","datetime")]),
  ],
  relationships: [
    { parent:"APP_USER",child:"MRF",field:"requested_by",label:"creates",points:[[220,70],[240,70],[240,340],[260,340]] },
    { parent:"PROJECT",child:"MRF",field:"project_id",label:"contains",points:[[360,170],[360,300]] },
    { parent:"MRF",child:"MRF_ITEM",field:"mrf_id",label:"contains",points:[[260,450],[220,450]] },
    { parent:"MRF",child:"QUOTATION",field:"mrf_id",label:"receives",points:[[460,380],[740,380]] },
    { parent:"SUPPLIER",child:"QUOTATION",field:"supplier_id",label:"offers",points:[[840,218],[840,300]] },
    { parent:"MRF",child:"PURCHASE_ORDER",field:"mrf_id",label:"produces",points:[[460,320],[500,320]] },
    { parent:"QUOTATION",child:"PURCHASE_ORDER",field:"quotation_id",label:"sources",points:[[740,410],[710,410],[710,358],[670,358],[670,338]] },
    { parent:"SUPPLIER",child:"PURCHASE_ORDER",field:"supplier_id",label:"fulfills",points:[[740,80],[700,80]] },
    { parent:"PURCHASE_ORDER",child:"PAYMENT",field:"po_id",label:"has",points:[[600,338],[600,430]] },
    { parent:"PURCHASE_ORDER",child:"DELIVERY",field:"po_id",label:"has",points:[[700,300],[720,300],[720,650],[740,650]] },
    { parent:"PROJECT",child:"INVENTORY_MOVEMENT",field:"project_id",label:"tracks",points:[[330,20],[330,6],[8,6],[8,730],[260,730]] },
    { parent:"DELIVERY",child:"INVENTORY_MOVEMENT",field:"delivery_id",label:"supplies receipts",points:[[740,730],[460,730]] },
  ],
};

export const boxWidth = 200;
export const headerHeight = 30;
export const rowHeight = 24;
export const boxHeight = entity => headerHeight + entity.fields.length * rowHeight;
export const cardinality = link => `${model.entities.find(entity => entity.name === link.child).fields.find(field => field.name === link.field).nullable ? "0..1" : "1"}:${link.single ? "0..1" : "N"}`;
