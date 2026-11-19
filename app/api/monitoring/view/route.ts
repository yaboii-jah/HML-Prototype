import { monitoringResponse } from "@/src/server/monitoring/response";

export async function GET(request: Request) {
  return monitoringResponse(request);
}
