'use server';
import { runDeliveryCommand } from '@/src/server/deliveries/deliveries';
export async function deliveryCommandAction(input: unknown) {
  return runDeliveryCommand(input);
}
