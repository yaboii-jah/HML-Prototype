export async function deliveryReceiptWorkflow(fileId: string) {
  'use workflow';
  await archiveReceiptFile(fileId);
}

async function archiveReceiptFile(fileId: string) {
  'use step';
  const { processDeliveryReceiptFile } = await import('../deliveries/receipt-files');
  await processDeliveryReceiptFile(fileId);
}

export async function transferReceiptWorkflow(fileId: string) {
  'use workflow';
  await archiveTransferReceiptFile(fileId);
}

async function archiveTransferReceiptFile(fileId: string) {
  'use step';
  const { processDeliveryReceiptFile } = await import('../deliveries/receipt-files');
  await processDeliveryReceiptFile(fileId, true);
}
