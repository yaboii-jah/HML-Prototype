// Core business view; detailed line, document and history structures remain outside the figure.
const field = (name, type, key = "", reference = "", nullable = false) => ({ name, type, key, reference, nullable, unique: false });
const pk = name => field(name, "uuid", "PK");
const fk = (name, target, nullable = false) => field(name, "uuid", "FK", target, nullable);
const col = (name, type = "string") => field(name, type);
const entity = (name, title, color, position, purpose, fields) => ({ name, title, color, position, purpose, fields });

export const model = {
  title: "ConstructSync Core Entity Relationship Diagram",
  version: "7.1",
  verifiedDate: "2026-10-13",
  width: 1260,
  height: 1280,
  printWidthMm: 160,
  fontSize: 22.7,
  headerFontSize: 23.4,
  entities: [
    entity("APP_USER", "User", "#BCD8F7", [350,20], "A named user with one of the seven roles; Administrator is a role, not a separate entity.", [pk("user_id"),col("name"),col("email"),col("role"),col("active","boolean"),col("created_at","datetime")]),
    entity("PROJECT", "Project", "#FFDD8A", [30,450], "A construction project with its allocated budget, site location and Drive archive folder.", [pk("project_id"),col("name"),col("location"),col("budget","decimal"),col("drive_folder_id")]),
    entity("SUPPLIER", "Supplier", "#BBE6CC", [990,20], "Supplier contact and business details used by quotations and POs.", [pk("supplier_id"),col("name"),col("contact"),col("email"),col("phone"),col("tin"),col("address")]),
    entity("MRF", "MRF", "#DAC8F1", [350,350], "A project material request created by Site Personnel and reviewed by the Project Manager.", [pk("mrf_id"),fk("project_id","PROJECT.project_id"),fk("requested_by","APP_USER.user_id"),col("reference"),col("request_date","date"),col("status"),col("instructions")]),
    entity("MRF_ITEM", "MRF Item", "#F5C3D6", [30,60], "One requested material, quantity, unit, required date and delivery location.", [pk("item_id"),fk("mrf_id","MRF.mrf_id"),col("material_name"),col("quantity","decimal"),col("unit"),col("needed_date","date"),col("location"),col("remarks")]),
    entity("QUOTATION", "Quotation", "#BAE8E7", [670,20], "A dated supplier offer for an MRF with its currency, review status and source reference.", [pk("quotation_id"),fk("mrf_id","MRF.mrf_id"),fk("supplier_id","SUPPLIER.supplier_id"),col("reference"),col("quote_date","date"),col("currency"),col("review_status"),col("source_reference")]),
    entity("PURCHASE_ORDER", "Purchase Order", "#BBC5F4", [670,410], "An order sourced from a quotation, with the actual supplier, reviewed amounts, payment mode and Finance scheduling fields.", [pk("po_id"),fk("mrf_id","MRF.mrf_id"),fk("quotation_id","QUOTATION.quotation_id"),fk("supplier_id","SUPPLIER.supplier_id"),col("reference"),col("payment_mode"),col("status"),col("gross_amount","decimal"),col("net_payable","decimal"),col("priority"),col("planned_date","date"),col("due_date","date")]),
    entity("PAYMENT", "Verified Payment", "#F7C99E", [990,450], "Accounting's verification of an external supplier payment using archived proof.", [pk("payment_id"),fk("po_id","PURCHASE_ORDER.po_id"),col("amount","decimal"),col("method"),col("reference"),col("payment_date","date"),col("verified_at","datetime"),col("proof_reference")]),
    { ...entity("DELIVERY", "Delivery", "#DCEB9F", [670,900], "One scheduled purchasing or site-transfer trip. Exactly one PO or Stock Transfer owns it; the common entity abstracts the prototype's two delivery record types.", [pk("delivery_id"),fk("po_id","PURCHASE_ORDER.po_id",true),fk("transfer_id","STOCK_TRANSFER.transfer_id",true),col("reference"),col("leg"),col("scheduled_date","date"),col("received_at","datetime"),col("status"),col("destination")]), constraint: "PO XOR transfer" },
    entity("INVENTORY_MOVEMENT", "Inventory Movement", "#D2D9E0", [30,900], "A material-specific project receipt, transfer-out, transfer-in, usage or adjustment; balances are derived from movements.", [pk("movement_id"),fk("project_id","PROJECT.project_id"),fk("delivery_id","DELIVERY.delivery_id",true),col("material_name"),col("unit"),col("kind"),col("quantity","decimal"),col("occurred_at","datetime")]),
    entity("STOCK_TRANSFER", "Stock Transfer", "#F2D4DC", [350,900], "An internal sourcing record for one MRF, identifying different source and destination projects. It has no supplier PO or payment obligation.", [pk("transfer_id"),fk("mrf_id","MRF.mrf_id"),fk("source_id","PROJECT.project_id"),fk("destination_id","PROJECT.project_id"),col("reference"),col("status"),col("created_at","datetime")]),
  ],
  exclusiveParents: [{ entity: "DELIVERY", fields: ["po_id", "transfer_id"], mandatory: true }],
  relationships: [
    { parent:"APP_USER",child:"MRF",field:"requested_by",label:"creates",points:[[470,222],[470,350]] },
    { parent:"PROJECT",child:"MRF",field:"project_id",label:"contains",points:[[270,500],[350,500]] },
    { parent:"MRF",child:"MRF_ITEM",field:"mrf_id",label:"contains",points:[[350,400],[310,400],[310,220],[270,220]] },
    { parent:"MRF",child:"QUOTATION",field:"mrf_id",label:"receives",points:[[590,390],[630,390],[630,200],[670,200]] },
    { parent:"SUPPLIER",child:"QUOTATION",field:"supplier_id",label:"offers",points:[[990,150],[910,150]] },
    { parent:"MRF",child:"PURCHASE_ORDER",field:"mrf_id",label:"produces",points:[[590,500],[670,500]] },
    { parent:"QUOTATION",child:"PURCHASE_ORDER",field:"quotation_id",label:"sources",points:[[790,278],[790,410]] },
    { parent:"SUPPLIER",child:"PURCHASE_ORDER",field:"supplier_id",label:"fulfills",points:[[1110,250],[1110,340],[870,340],[870,410]] },
    { parent:"PURCHASE_ORDER",child:"PAYMENT",field:"po_id",label:"has",points:[[910,600],[990,600]] },
    { parent:"PURCHASE_ORDER",child:"DELIVERY",field:"po_id",label:"has",points:[[800,780],[800,900]] },
    { parent:"PROJECT",child:"INVENTORY_MOVEMENT",field:"project_id",label:"tracks",points:[[150,624],[150,900]] },
    { parent:"DELIVERY",child:"INVENTORY_MOVEMENT",field:"delivery_id",label:"supplies receipts",points:[[670,1160],[630,1160],[630,1240],[150,1240],[150,1158]] },
    { parent:"MRF",child:"STOCK_TRANSFER",field:"mrf_id",label:"fulfilled by",points:[[470,580],[470,900]] },
    { parent:"PROJECT",child:"STOCK_TRANSFER",field:"source_id",label:"releases stock",points:[[270,570],[320,570],[320,1010],[350,1010]] },
    { parent:"PROJECT",child:"STOCK_TRANSFER",field:"destination_id",label:"receives stock",points:[[270,610],[300,610],[300,1038],[350,1038]] },
    { parent:"STOCK_TRANSFER",child:"DELIVERY",field:"transfer_id",label:"has trips",points:[[590,1000],[670,1000]] },
  ],
};

export const boxWidth = 240;
export const headerHeight = 34;
export const rowHeight = 28;
export const boxHeight = entity => headerHeight + (entity.fields.length + (entity.constraint ? 1 : 0)) * rowHeight;
export const cardinality = link => `${model.entities.find(entity => entity.name === link.child).fields.find(field => field.name === link.field).nullable ? "0..1" : "1"}:${link.single ? "0..1" : "N"}`;
