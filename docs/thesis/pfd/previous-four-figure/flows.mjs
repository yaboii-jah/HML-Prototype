// Active business flowcharts. model.mjs retains the former charts as historical definitions.
const portrait = { width: 1100, height: 1320, fontSize: 24, printWidthMm: 190, minimumPoints: 10, orientation: "portrait" };
const landscape = { width: 1960, height: 1340, fontSize: 26, printWidthMm: 277, minimumPoints: 10, orientation: "landscape" };
const node = (id,type,x,y,w,h,lines,role,reference) => ({ id,type,x,y,w,h,lines,role,reference });
const activity = (id,x,y,w,h,role,lines) => node(id,"activity",x,y,w,h,lines,role);
const decision = (id,x,y,w,h,lines,role) => node(id,"decision",x,y,w,h,lines,role);
const terminal = (id,x,y,w,h,lines) => node(id,"terminal",x,y,w,h,lines);
const subprocess = (id,x,y,w,h,lines,target) => node(id,"subprocess",x,y,w,h,lines,undefined,target);
const reference = (id,x,y,w,h,lines,target) => node(id,"reference",x,y,w,h,lines,undefined,target);
const connector = (id,x,y,size,label) => node(id,"connector",x,y,size,size,[label]);
const edge = (from,to,points,label="",labelAt) => ({ from,to,points,label,labelAt });

const overview = {
  id:"overview",key:"A",name:"Request and fulfillment overview",page:portrait,direction:"TB",entryIds:["start"],
  notes:["Allocate quantities to purchases, transfers, or both, including splitting one MRF item.","Each cleared purchase delivery or dispatched transfer enters D independently; there is no wait-for-both merge.","Stock posting and document review are separate milestones; neither automatically closes the MRF."],
  nodes:[
    terminal("start",500,10,100,46,["Start"]),
    activity("projectSetup",370,100,360,78,"Administrator / PM",["Set up project"]),
    activity("submitMrf",370,220,360,78,"Site Personnel",["Submit MRF"]),
    decision("mrfDecision",340,345,420,150,["MRF decision?"],"Project Manager"),
    terminal("mrfRejected",830,397,230,55,["MRF rejected"]),
    activity("sourceMaterials",370,565,360,100,"Procurement",["Check stock & allocate","MRF quantities"]),
    subprocess("purchase",90,765,340,100,["Supplier purchasing","& payment (B)"],"B"),
    subprocess("transfer",670,765,340,100,["Site stock transfer (C)"],"C"),
    subprocess("receiving",340,1000,420,100,["Delivery, receiving","& records (D)"],"D"),
    terminal("inventoryPosted",80,1220,360,60,["Site stock updated"]),
    terminal("documentsReviewed",660,1220,360,60,["Documents reviewed"]),
  ],
  edges:[
    edge("start","projectSetup",[[550,56],[550,100]]),
    edge("projectSetup","submitMrf",[[550,178],[550,220]]),
    edge("submitMrf","mrfDecision",[[550,298],[550,345]]),
    edge("mrfDecision","submitMrf",[[340,420],[255,420],[255,259],[370,259]],"Return",[175,340,130]),
    edge("mrfDecision","mrfRejected",[[760,420],[830,420]],"Reject",[805,370,80]),
    edge("mrfDecision","sourceMaterials",[[550,495],[550,565]],"Approve",[630,530,110]),
    edge("sourceMaterials","purchase",[[460,665],[460,715],[260,715],[260,765]],"Purchase qty",[260,680,200]),
    edge("sourceMaterials","transfer",[[640,665],[640,715],[840,715],[840,765]],"Transfer qty",[840,680,200]),
    edge("purchase","receiving",[[260,865],[260,1050],[340,1050]],"PO cleared",[140,950,180]),
    edge("transfer","receiving",[[840,865],[840,1050],[760,1050]],"Transfer dispatched",[970,950,210]),
    edge("receiving","inventoryPosted",[[465,1100],[465,1150],[260,1150],[260,1220]]),
    edge("receiving","documentsReviewed",[[635,1100],[635,1150],[840,1150],[840,1220]]),
  ],
};

const purchasing = {
  id:"purchasing",key:"B",name:"Supplier purchasing and payment",page:landscape,direction:"TB",entryIds:["purchaseQuantities"],
  notes:["Repeat for each supplier PO. Accounting means Accounting / Auditing.","CR routes both independent credit paths. Credit clearance can precede payment; settlement does not retrigger delivery.","Upfront clearance requires full verified net supplier payment with archived proof. Finance coordinates payment outside the app.","Accounting agrees the credit due date before issuance; Finance's planned date is separate."],
  nodes:[
    terminal("purchaseQuantities",20,10,245,45,["Purchases from A"]),
    activity("quotations",20,80,245,110,"Procurement",["Review offers","Select suppliers"]),
    activity("draftPo",310,80,245,110,"Procurement",["Prepare & submit PO"]),
    activity("reviewPo",600,80,245,110,"Accounting",["Review costs","& budget"]),
    decision("poDecision",900,60,240,150,["PO decision?"]),
    activity("approvePo",1280,80,245,110,"Accounting",["Approve terms","& archive PO"]),
    activity("issuePo",1580,80,270,110,"Procurement",["Issue PO to supplier"]),
    terminal("poRejected",905,280,230,50,["PO rejected"]),
    decision("paymentMode",720,400,300,150,["Payment","arrangement?"]),
    activity("upfrontFinance",295,560,270,100,"Finance",["Coordinate payment","outside app"]),
    activity("upfrontVerify",295,720,270,100,"Accounting",["Archive proof &","verify payment"]),
    decision("fullPaymentVerified",280,875,300,160,["Full net payment","verified?"]),
    activity("upfrontClearance",295,1110,270,100,"Accounting",["Clear delivery"]),
    reference("upfrontDelivery",295,1250,270,65,["Delivery in D"],"D"),
    connector("creditPaths",1280,590,80,"CR"),
    activity("creditClearance",970,750,270,100,"Accounting",["Clear credit delivery"]),
    reference("creditDelivery",970,920,270,70,["Delivery in D"],"D"),
    activity("creditFinance",1440,750,270,100,"Finance",["Coordinate payment","outside app"]),
    activity("creditVerify",1440,910,270,100,"Accounting",["Archive proof &","verify payment"]),
    decision("balanceSettled",1420,1070,300,150,["Balance settled?"]),
    terminal("creditSettled",1440,1270,260,55,["Credit settled"]),
  ],
  edges:[
    edge("purchaseQuantities","quotations",[[142.5,55],[142.5,80]]),
    edge("quotations","draftPo",[[265,135],[310,135]]),
    edge("draftPo","reviewPo",[[555,135],[600,135]]),
    edge("reviewPo","poDecision",[[845,135],[900,135]]),
    edge("reviewPo","reviewPo",[[720,190],[720,225],[865,225],[865,160],[845,160]],"Hold",[790,260,80]),
    edge("poDecision","draftPo",[[1020,60],[1020,15],[432,15],[432,80]],"Return",[710,40,100]),
    edge("poDecision","poRejected",[[1020,210],[1020,280]],"Reject",[1100,245,100]),
    edge("poDecision","approvePo",[[1140,135],[1280,135]],"Approve",[1210,100,120]),
    edge("approvePo","issuePo",[[1525,135],[1580,135]]),
    edge("issuePo","paymentMode",[[1715,190],[1715,350],[870,350],[870,400]]),
    edge("paymentMode","upfrontFinance",[[720,475],[430,475],[430,560]],"Upfront",[580,440,130]),
    edge("paymentMode","creditPaths",[[1020,475],[1320,475],[1320,590]],"Credit / terms",[1190,440,200]),
    edge("upfrontFinance","upfrontVerify",[[430,660],[430,720]]),
    edge("upfrontVerify","fullPaymentVerified",[[430,820],[430,875]]),
    edge("fullPaymentVerified","upfrontFinance",[[280,955],[215,955],[215,610],[295,610]],"No / resolve",[110,850,180]),
    edge("fullPaymentVerified","upfrontClearance",[[430,1035],[430,1110]],"Yes",[500,1070,60]),
    edge("upfrontClearance","upfrontDelivery",[[430,1210],[430,1250]]),
    edge("creditPaths","creditClearance",[[1280,630],[1105,630],[1105,750]],"Delivery",[1195,690,130]),
    edge("creditPaths","creditFinance",[[1360,630],[1575,630],[1575,750]],"Payment",[1475,690,130]),
    edge("creditClearance","creditDelivery",[[1105,850],[1105,920]]),
    edge("creditFinance","creditVerify",[[1575,850],[1575,910]]),
    edge("creditVerify","balanceSettled",[[1575,1010],[1575,1040],[1570,1040],[1570,1070]]),
    edge("balanceSettled","creditFinance",[[1420,1145],[1375,1145],[1375,800],[1440,800]],"No / follow up",[1290,1050,140]),
    edge("balanceSettled","creditSettled",[[1570,1220],[1570,1270]],"Yes",[1640,1245,60]),
  ],
};

const transfer = {
  id:"stock-transfer",key:"C",name:"Site stock transfer",page:{...portrait,height:1180},direction:"TB",entryIds:["transferQuantities"],
  notes:["Proposals reserve stock and MRF demand. Source-assigned Site Personnel confirm quantities; reduced release leaves the balance for sourcing in A.","No supplier quotation, PO, payment, budget charge or purchase delivery-clearance step applies.","Repeat for multiple source sites and trips. Dispatch deducts source stock once; D posts accepted destination quantities once.","Undispatched allocations can be cancelled explicitly. Shortages reopen demand without restoring dispatched stock."],
  nodes:[
    terminal("transferQuantities",370,30,360,64,["Transfer quantities from A"]),
    activity("proposeTransfer",370,150,360,90,"Procurement",["Propose site transfer"]),
    decision("sourceRelease",340,310,420,210,["Release decision?"],["Source Site","Personnel"]),
    reference("resourcing",810,365,280,140,["Unreleased quantities","Return to sourcing in A"],"A"),
    activity("scheduleTransfer",370,620,360,90,"Logistics",["Schedule transfer trip"]),
    activity("dispatchTransfer",370,800,360,110,"Logistics",["Dispatch & deduct","source stock"]),
    reference("transferReceiving",370,1000,360,100,["Destination receiving","& records in D"],"D"),
  ],
  edges:[
    edge("transferQuantities","proposeTransfer",[[550,94],[550,150]]),
    edge("proposeTransfer","sourceRelease",[[550,240],[550,310]]),
    edge("sourceRelease","resourcing",[[760,415],[810,415]],"Reject",[845,330,90]),
    edge("sourceRelease","scheduleTransfer",[[550,520],[550,620]],"Approve full / part",[720,565,240]),
    edge("scheduleTransfer","dispatchTransfer",[[550,710],[550,800]]),
    edge("dispatchTransfer","transferReceiving",[[550,910],[550,1000]],"Dispatched trip",[700,950,230]),
  ],
};

const receiving = {
  id:"delivery-receiving",key:"D",name:"Delivery, receiving and records",page:landscape,direction:"TB",entryIds:["supplierReady","transferDispatched"],
  continuations:[{from:"warehouseEvidenceOut",to:"warehouseEvidenceIn",label:"W"}],
  notes:["B enters at supplier scheduling; C enters at destination receiving after transfer dispatch.","Matching W connectors carry warehouse receipt evidence to the document path without waiting for site arrival.","Only accepted site quantities post to destination stock. Warehouse receipt alone does not post site inventory.","Archive generated and current signed receipts for every received batch. Stock posting and Accounting document review proceed independently.","Repeat receiving for partial deliveries. Shortages reopen sourcing in A; separate milestones do not automatically close requests."],
  nodes:[
    terminal("supplierReady",80,35,320,70,["PO cleared in B"]),
    activity("scheduleDelivery",80,170,320,100,"Logistics",["Schedule delivery","& dispatch"]),
    decision("deliveryRoute",70,365,340,165,["Delivery","destination?"]),
    activity("warehouseReceipt",80,650,320,110,"Procurement",["Receive at warehouse"]),
    activity("warehouseTransfer",80,860,320,100,"Logistics",["Forward to original site"]),
    terminal("transferDispatched",1160,35,340,70,["Transfer dispatched in C"]),
    activity("siteReceipt",690,860,340,100,"Site Personnel",["Receive at destination","Record accepted qty"]),
    activity("postInventory",600,1040,320,100,"Site Personnel",["Post accepted site stock"]),
    activity("archiveReceipts",1190,1040,320,100,"Receiving teams",["Archive receipts"]),
    activity("reviewDocuments",1600,1040,320,100,"Accounting",["Review receipt evidence"]),
    terminal("inventoryPosted",600,1230,320,60,["Site stock updated"]),
    terminal("documentsReviewed",1600,1230,320,60,["Documents reviewed"]),
    connector("warehouseEvidenceOut",10,680,50,"W"),
    connector("warehouseEvidenceIn",1430,910,60,"W"),
  ],
  edges:[
    edge("supplierReady","scheduleDelivery",[[240,105],[240,170]]),
    edge("scheduleDelivery","deliveryRoute",[[240,270],[240,365]]),
    edge("deliveryRoute","siteReceipt",[[410,447.5],[860,447.5],[860,860]],"Direct to site",[600,410,200]),
    edge("deliveryRoute","warehouseReceipt",[[240,530],[240,650]],"Warehouse",[350,580,180]),
    edge("warehouseReceipt","warehouseTransfer",[[240,760],[240,860]]),
    edge("warehouseTransfer","siteReceipt",[[400,910],[690,910]]),
    edge("transferDispatched","siteReceipt",[[1330,105],[1330,910],[1030,910]]),
    edge("siteReceipt","postInventory",[[760,960],[760,1040]]),
    edge("siteReceipt","archiveReceipts",[[960,960],[960,995],[1350,995],[1350,1040]]),
    edge("warehouseReceipt","warehouseEvidenceOut",[[80,705],[60,705]]),
    edge("warehouseEvidenceIn","archiveReceipts",[[1460,970],[1460,1040]]),
    edge("archiveReceipts","reviewDocuments",[[1510,1090],[1600,1090]]),
    edge("postInventory","inventoryPosted",[[760,1140],[760,1230]]),
    edge("reviewDocuments","documentsReviewed",[[1760,1140],[1760,1230]]),
  ],
};

export const diagrams = [overview,purchasing,transfer,receiving];
