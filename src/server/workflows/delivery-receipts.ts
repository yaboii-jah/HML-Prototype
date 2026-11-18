export async function deliveryReceiptWorkflow(fileId: string) {
  'use workflow';
  await archiveReceiptFile(fileId);
}

async function archiveReceiptFile(fileId: string) {
  'use step';
  const { processDeliveryReceiptFile } = await import('../deliveries/receipt-files');
  await processDeliveryReceiptFile(fileId);
}
