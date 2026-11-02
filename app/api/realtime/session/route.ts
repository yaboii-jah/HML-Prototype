import { foundationResponse } from "@/src/server/realtime/foundation";
export async function GET(request: Request) {
  return foundationResponse(request, true);
}
