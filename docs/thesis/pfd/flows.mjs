// Active six-figure business flowcharts; earlier exports are archived separately.
const portrait = { width:1100,height:1380,fontSize:24,printWidthMm:190,minimumPoints:10,orientation:"portrait" };
const landscape = { width:1960,height:1340,fontSize:26,printWidthMm:277,minimumPoints:10,orientation:"landscape" };
const node = (id,type,x,y,w,h,lines,role,reference) => ({id,type,x,y,w,h,lines,role,reference});
const activity = (id,x,y,w,h,role,lines) => node(id,"activity",x,y,w,h,lines,role);
const decision = (id,x,y,w,h,lines,role) => node(id,"decision",x,y,w,h,lines,role);
const terminal = (id,x,y,w,h,lines) => node(id,"terminal",x,y,w,h,lines);
const subprocess = (id,x,y,w,h,lines,target) => node(id,"subprocess",x,y,w,h,lines,undefined,target);
const reference = (id,x,y,w,h,lines,target) => node(id,"reference",x,y,w,h,lines,undefined,target);
const connector = (id,x,y,size,label) => node(id,"connector",x,y,size,size,[label]);
const edge = (from,to,points,label="",labelAt) => ({from,to,points,label,labelAt});

const overview = {
  id:"overview",key:"A",name:"Request and fulfillment overview",page:portrait,direction:"TB",entryIds:["start"],
  explanation:"The overview begins with an existing project and shows MRF submission, Project Manager review, and Procurement allocation of requested quantities. Supplier purchasing and site transfers may fulfill the same request independently. Cleared supplier deliveries and dispatched transfers proceed to receiving and stock posting, while receipt evidence proceeds to documentation and review. These milestones do not establish automatic MRF closure.",
  notes:["Project setup is a prerequisite, not an activity repeated for each MRF.","Use purchase quantities, transfer quantities, or both; one item may be split across sources.","Cleared supplier deliveries and dispatched site transfers enter receiving independently. Warehouse or site receipt evidence proceeds to receipt review as it becomes available.","Stock posting, payment settlement and document review are separate milestones; none automatically closes the MRF."],
  nodes:[
    terminal("start",370,20,360,60,["Project ready"]),
    activity("submitMrf",370,150,360,80,"Site Personnel",["Submit MRF"]),
    decision("mrfDecision",340,290,420,150,["MRF decision?"],"Project Manager"),
    terminal("mrfRejected",830,342,230,55,["MRF rejected"]),
    activity("sourceMaterials",370,510,360,100,"Procurement",["Check stock & allocate","MRF quantities"]),
    subprocess("purchase",90,700,340,100,["Supplier purchasing"],"B"),
    subprocess("transfer",670,700,340,100,["Site stock transfer"],"D"),
    subprocess("receiving",340,950,420,100,["Delivery & inventory"],"E"),
    terminal("inventoryPosted",80,1220,360,60,["Site stock updated"]),
    subprocess("documentation",690,1130,300,90,["Receipt review"],"F"),
    terminal("documentsReviewed",690,1290,300,60,["Documents reviewed"]),
  ],
  edges:[
    edge("start","submitMrf",[[550,80],[550,150]]),
    edge("submitMrf","mrfDecision",[[550,230],[550,290]]),
    edge("mrfDecision","submitMrf",[[340,365],[255,365],[255,190],[370,190]],"Return",[160,285,130]),
    edge("mrfDecision","mrfRejected",[[760,365],[830,365]],"Reject",[895,300,100]),
    edge("mrfDecision","sourceMaterials",[[550,440],[550,510]],"Approve",[650,475,130]),
    edge("sourceMaterials","purchase",[[460,610],[460,650],[260,650],[260,700]],"Purchase qty, if any",[240,620,230]),
    edge("sourceMaterials","transfer",[[640,610],[640,650],[840,650],[840,700]],"Transfer qty, if any",[860,620,230]),
    edge("purchase","receiving",[[260,800],[260,1000],[340,1000]],"Supplier delivery cleared",[130,900,200]),
    edge("transfer","receiving",[[840,800],[840,1000],[760,1000]],"Transfer dispatched",[970,900,210]),
    edge("receiving","inventoryPosted",[[465,1050],[465,1140],[260,1140],[260,1220]],"Accepted quantities",[250,1090,260]),
    edge("receiving","documentation",[[635,1050],[635,1175],[690,1175]],"Receipt evidence",[810,1080,240]),
    edge("documentation","documentsReviewed",[[840,1220],[840,1290]]),
  ],
};

const purchasing = {
  id:"purchasing",key:"B",name:"Supplier purchasing and PO approval",page:{...portrait,height:1440},direction:"TB",entryIds:["purchaseQuantities"],
  explanation:"The purchasing flow begins with materials allocated for purchase and covers supplier quotation evaluation, material awards, PO preparation, and Accounting review of costs, budget and terms. Returned POs go back for correction, held reviews remain pending, and rejected POs end that purchasing path. Approved POs are archived and issued to suppliers before payment coordination begins.",
  notes:["Repeat for each supplier PO; only the allocated purchasing quantities enter this flow.","Accounting reviews costs, taxes, adjustments and budget, agrees the credit due date when applicable, and archives the approved PO.","Hold preserves pending review; Return requires PO correction; Reject does not close the entire MRF.","Supplier quotation and PO exchanges are handled by Procurement. Issued supplier POs proceed to payment coordination; actual payments occur outside the application."],
  nodes:[
    terminal("purchaseQuantities",370,20,360,80,["Materials allocated","for purchase"]),
    activity("quotations",370,130,360,100,"Procurement",["Review offers","Select suppliers"]),
    activity("draftPo",370,290,360,90,"Procurement",["Prepare & submit PO"]),
    activity("reviewPo",370,450,360,100,"Accounting",["Review costs & budget"]),
    decision("poDecision",340,650,420,170,["PO decision?"],"Accounting"),
    terminal("poRejected",830,708,230,55,["PO rejected"]),
    activity("approvePo",370,920,360,100,"Accounting",["Approve terms","Archive PO"]),
    activity("issuePo",370,1100,360,90,"Procurement",["Issue PO to supplier"]),
    reference("paymentHandling",370,1290,360,110,["Proceed to payment","coordination"],"C"),
  ],
  edges:[
    edge("purchaseQuantities","quotations",[[550,100],[550,130]]),
    edge("quotations","draftPo",[[550,230],[550,290]]),
    edge("draftPo","reviewPo",[[550,380],[550,450]]),
    edge("reviewPo","poDecision",[[550,550],[550,650]]),
    edge("reviewPo","reviewPo",[[730,500],[790,500],[790,420],[700,420],[700,450]],"Hold",[880,440,100]),
    edge("poDecision","draftPo",[[340,735],[240,735],[240,335],[370,335]],"Return",[150,650,100]),
    edge("poDecision","poRejected",[[760,735],[830,735]],"Reject",[900,650,100]),
    edge("poDecision","approvePo",[[550,820],[550,920]],"Approve",[650,865,130]),
    edge("approvePo","issuePo",[[550,1020],[550,1100]]),
    edge("issuePo","paymentHandling",[[550,1190],[550,1290]]),
  ],
};

const payments = {
  id:"payments",key:"C",name:"Payment coordination and delivery clearance",page:landscape,direction:"TB",entryIds:["issuedPo"],
  explanation:"The payment flow separates upfront and credit arrangements after PO issuance. Upfront deliveries require full verified net payment and Accounting clearance. Under credit terms, delivery clearance and payment coordination proceed independently; partial payments retain the outstanding balance and payment settlement does not trigger another delivery.",
  notes:["Finance coordinates actual payments outside the application; Accounting archives proof and verifies paid amounts.","Upfront requires full verified net payment followed by separate Accounting delivery clearance.","The Credit connector routes two independent paths. Cleared supplier deliveries proceed to Logistics while Finance follows outstanding balances.","Finance's planned payment date differs from the agreed credit due date. Settlement never retriggers delivery; site transfers bypass payment coordination."],
  nodes:[
    terminal("issuedPo",800,30,360,60,["Supplier PO issued"]),
    decision("paymentMode",800,180,360,180,["Payment","arrangement?"]),
    activity("upfrontFinance",295,450,270,100,"Finance",["Coordinate payment","outside app"]),
    activity("upfrontVerify",295,650,270,100,"Accounting",["Archive proof &","verify payment"]),
    decision("fullPaymentVerified",280,825,300,160,["Full net payment","verified?"]),
    activity("upfrontClearance",295,1090,270,100,"Accounting",["Clear delivery"]),
    reference("upfrontDelivery",295,1220,270,100,["Proceed to","supplier delivery"],"E"),
    connector("creditPaths",1260,380,120,"Credit"),
    activity("creditClearance",970,640,270,100,"Accounting",["Clear credit delivery"]),
    reference("creditDelivery",970,870,270,100,["Proceed to","supplier delivery"],"E"),
    activity("creditFinance",1440,640,270,100,"Finance",["Coordinate payment","outside app"]),
    activity("creditVerify",1440,840,270,100,"Accounting",["Archive proof &","verify payment"]),
    decision("balanceSettled",1420,1020,300,150,["Balance settled?"]),
    terminal("creditSettled",1440,1250,260,60,["Credit settled"]),
  ],
  edges:[
    edge("issuedPo","paymentMode",[[980,90],[980,180]]),
    edge("paymentMode","upfrontFinance",[[800,270],[430,270],[430,450]],"Upfront",[600,230,120]),
    edge("paymentMode","creditPaths",[[1160,270],[1320,270],[1320,380]],"Credit / terms",[1420,230,200]),
    edge("upfrontFinance","upfrontVerify",[[430,550],[430,650]]),
    edge("upfrontVerify","fullPaymentVerified",[[430,750],[430,825]]),
    edge("fullPaymentVerified","upfrontFinance",[[280,905],[215,905],[215,500],[295,500]],"No / resolve",[110,800,180]),
    edge("fullPaymentVerified","upfrontClearance",[[430,985],[430,1090]],"Yes",[500,1030,60]),
    edge("upfrontClearance","upfrontDelivery",[[430,1190],[430,1220]]),
    edge("creditPaths","creditClearance",[[1260,440],[1105,440],[1105,640]],"Delivery",[1195,550,130]),
    edge("creditPaths","creditFinance",[[1380,440],[1575,440],[1575,640]],"Payment",[1490,550,130]),
    edge("creditClearance","creditDelivery",[[1105,740],[1105,870]]),
    edge("creditFinance","creditVerify",[[1575,740],[1575,840]]),
    edge("creditVerify","balanceSettled",[[1575,940],[1575,970],[1570,970],[1570,1020]]),
    edge("balanceSettled","creditFinance",[[1420,1095],[1375,1095],[1375,690],[1440,690]],"No / follow up",[1290,1005,140]),
    edge("balanceSettled","creditSettled",[[1570,1170],[1570,1250]],"Yes",[1640,1200,60]),
  ],
};

const transfer = {
  id:"stock-transfer",key:"D",name:"Inter-site stock transfer",page:portrait,direction:"TB",entryIds:["transferQuantities"],
  explanation:"The transfer flow begins with materials allocated for site transfer. Procurement verifies matching material descriptions and units, rechecks available quantities, and requests release directly from the source project. Source Site Personnel authorize the quantities their project can spare. Approved quantities proceed to Logistics for scheduling and dispatch, while rejected or unreleased quantities return to material sourcing. Dispatch deducts source stock before the trip proceeds to destination receiving and inventory posting.",
  notes:["Procurement verifies matching descriptions and units before requesting source release. Destination suitability reviews retained for previously submitted requests are outside this current workflow figure.","Source proposals reserve stock and MRF demand. Only confirmed release quantities continue to Logistics; unreleased quantities return to material sourcing.","No supplier quotation, PO, payment, budget charge or purchase delivery clearance applies.","Repeat for multiple sites and trips. Dispatch deducts source stock once; destination receiving posts accepted site stock once. Cancellation of undispatched allocations remains in the workflow notes."],
  nodes:[
    terminal("transferQuantities",320,20,420,80,["Materials allocated","for site transfer"]),
    activity("confirmSuitability",320,145,420,110,"Procurement",["Verify matching","descriptions & units"]),
    activity("proposeTransfer",320,300,420,110,"Procurement",["Recheck availability","Request source release"]),
    decision("sourceRelease",300,475,460,210,["Release decision?"],["Source Site","Personnel"]),
    activity("recordRelease",320,765,420,110,"Source Site Personnel",["Record released /","unreleased quantities"]),
    reference("resourcing",830,750,260,160,["Unreleased quantities","Return to material","sourcing"],"A"),
    activity("scheduleTransfer",320,950,420,100,"Logistics",["Schedule transfer trip"]),
    activity("dispatchTransfer",320,1100,420,110,"Logistics",["Dispatch & deduct","source stock"]),
    reference("transferReceiving",320,1260,420,90,["Proceed to","destination receiving"],"E"),
  ],
  edges:[
    edge("transferQuantities","confirmSuitability",[[530,100],[530,145]]),
    edge("confirmSuitability","proposeTransfer",[[530,255],[530,300]]),
    edge("proposeTransfer","sourceRelease",[[530,410],[530,475]]),
    edge("sourceRelease","resourcing",[[760,580],[960,580],[960,750]],"Reject",[850,620,140]),
    edge("sourceRelease","recordRelease",[[530,685],[530,765]],"Approve full / part",[680,725,240]),
    edge("recordRelease","resourcing",[[740,820],[830,820]],"If any",[785,860,80]),
    edge("recordRelease","scheduleTransfer",[[530,875],[530,950]],"Released qty",[660,912.5,200]),
    edge("scheduleTransfer","dispatchTransfer",[[530,1050],[530,1100]]),
    edge("dispatchTransfer","transferReceiving",[[530,1210],[530,1260]],"Dispatched trip",[760,1235,230]),
  ],
};

const receiving = {
  id:"delivery-receiving",key:"E",name:"Delivery, receiving and inventory",page:landscape,direction:"TB",entryIds:["supplierReady","transferDispatched"],
  explanation:"The receiving flow begins with either a cleared supplier delivery or a dispatched site transfer. Supplier deliveries may travel directly to the project or through the warehouse, while dispatched transfers enter at destination receiving. Site personnel record accepted quantities and post stock independently of receipt review. Warehouse receipts produce evidence without adding site stock. Missing transfer quantities return to material sourcing without restoring dispatched source stock.",
  notes:["Supplier deliveries enter before scheduling; site transfers enter after their trip has been dispatched.","Warehouse receipt alone does not post site stock. Warehouse and site evidence each proceed to receipt review immediately.","Only accepted site quantities are posted. Posting and document review do not depend on one another.","Transfer shortages return to material sourcing. Supplier discrepancies remain associated with their PO and delivery records; further batches may still be pending.","Repeat for partial deliveries. Neither posting nor document completion automatically closes an MRF."],
  nodes:[
    terminal("supplierReady",80,35,320,80,["Supplier delivery","cleared"]),
    activity("scheduleDelivery",80,170,320,100,"Logistics",["Schedule delivery","& dispatch"]),
    decision("deliveryRoute",70,365,340,165,["Delivery","destination?"]),
    activity("warehouseReceipt",80,650,320,110,"Procurement",["Receive at warehouse"]),
    reference("warehouseDocuments",500,650,320,130,["Warehouse receipts","Proceed to","receipt review"],"F"),
    activity("warehouseTransfer",80,860,320,100,"Logistics",["Forward to original site"]),
    terminal("transferDispatched",1160,35,340,80,["Site transfer dispatched"]),
    activity("siteReceipt",690,860,340,100,"Site Personnel",["Record accepted qty","and discrepancies"]),
    activity("postInventory",600,1040,320,100,"Site Personnel",["Post accepted site stock"]),
    reference("siteDocuments",1190,1040,320,130,["Site receipts","Proceed to","receipt review"],"F"),
    terminal("inventoryPosted",600,1230,320,60,["Site stock updated"]),
    decision("transferShortage",1540,820,340,180,["Transfer qty missing?"]),
    terminal("noResourcing",1550,650,320,60,["No resourcing needed"]),
    reference("shortageResourcing",1540,1100,340,150,["Missing transfer quantities","Return to material","sourcing"],"A"),
  ],
  edges:[
    edge("supplierReady","scheduleDelivery",[[240,115],[240,170]]),
    edge("scheduleDelivery","deliveryRoute",[[240,270],[240,365]]),
    edge("deliveryRoute","siteReceipt",[[410,447.5],[860,447.5],[860,860]],"Direct to site",[600,410,200]),
    edge("deliveryRoute","warehouseReceipt",[[240,530],[240,650]],"Warehouse",[350,580,180]),
    edge("warehouseReceipt","warehouseTransfer",[[240,760],[240,860]]),
    edge("warehouseReceipt","warehouseDocuments",[[400,705],[500,705]]),
    edge("warehouseTransfer","siteReceipt",[[400,910],[690,910]]),
    edge("transferDispatched","siteReceipt",[[1330,115],[1330,910],[1030,910]]),
    edge("siteReceipt","postInventory",[[760,960],[760,1040]]),
    edge("siteReceipt","siteDocuments",[[960,960],[960,995],[1350,995],[1350,1040]]),
    edge("siteReceipt","transferShortage",[[1030,940],[1470,940],[1470,910],[1540,910]]),
    edge("transferShortage","noResourcing",[[1710,820],[1710,710]],"No",[1770,760,80]),
    edge("transferShortage","shortageResourcing",[[1710,1000],[1710,1100]],"Yes",[1800,1050,80]),
    edge("postInventory","inventoryPosted",[[760,1140],[760,1230]]),
  ],
};

const documentation = {
  id:"document-review",key:"F",name:"Receipt documentation and review",page:{...portrait,height:1120},direction:"TB",entryIds:["receiptEvidence"],
  explanation:"Warehouse and site receipt evidence enter the documentation flow independently of stock posting. Receiving teams archive generated and current signed receipts, and Accounting checks the required evidence. Missing or unacceptable documents return for completion and re-archiving before review is completed. Transfers require no supplier invoice or payment proof.",
  notes:["Run for each received warehouse or site batch; receipt evidence becomes available without waiting for stock posting or site arrival.","Archive generated and current signed receipts. Corrected quantities require evidence for the current version.","Accounting checks applicable purchasing evidence; transfer receipts require no supplier invoice or payment proof. Payment verification remains in the payment coordination process.","Archive failures and missing evidence are resolved without undoing receiving or stock posting. Document review does not close the MRF."],
  nodes:[
    terminal("receiptEvidence",370,30,360,90,["Warehouse or site","receipt evidence available"]),
    activity("archiveReceipts",370,190,360,100,"Receiving teams",["Archive generated","and signed receipts"]),
    activity("reviewDocuments",370,400,360,110,"Accounting",["Review required evidence"]),
    decision("evidenceAccepted",340,620,420,180,["Evidence complete","and acceptable?"]),
    activity("completeEvidence",30,640,270,130,"Receiving teams",["Complete or correct","receipt evidence"]),
    terminal("documentsReviewed",370,1000,360,60,["Documents reviewed"]),
  ],
  edges:[
    edge("receiptEvidence","archiveReceipts",[[550,120],[550,190]]),
    edge("archiveReceipts","reviewDocuments",[[550,290],[550,400]]),
    edge("reviewDocuments","evidenceAccepted",[[550,510],[550,620]]),
    edge("evidenceAccepted","completeEvidence",[[340,710],[300,710]],"No",[320,680,32]),
    edge("completeEvidence","archiveReceipts",[[165,640],[165,240],[370,240]]),
    edge("evidenceAccepted","documentsReviewed",[[550,800],[550,1000]],"Yes",[640,900,80]),
  ],
};

export const diagrams = [overview,purchasing,payments,transfer,receiving,documentation];

// Non-visual handoffs make every subprocess/off-page destination explicit.
export const handoffs = [
  {from:"A",node:"purchase",to:"B",entry:"purchaseQuantities"},
  {from:"A",node:"transfer",to:"D",entry:"transferQuantities"},
  {from:"A",node:"receiving",to:"E",entry:"supplierReady"},
  {from:"A",node:"receiving",to:"E",entry:"transferDispatched"},
  {from:"A",node:"documentation",to:"F",entry:"receiptEvidence"},
  {from:"B",node:"paymentHandling",to:"C",entry:"issuedPo"},
  {from:"C",node:"upfrontDelivery",to:"E",entry:"supplierReady"},
  {from:"C",node:"creditDelivery",to:"E",entry:"supplierReady"},
  {from:"D",node:"resourcing",to:"A",entry:"sourceMaterials"},
  {from:"D",node:"transferReceiving",to:"E",entry:"transferDispatched"},
  {from:"E",node:"warehouseDocuments",to:"F",entry:"receiptEvidence"},
  {from:"E",node:"siteDocuments",to:"F",entry:"receiptEvidence"},
  {from:"E",node:"shortageResourcing",to:"A",entry:"sourceMaterials"},
];
