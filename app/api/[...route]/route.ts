import { handleApi } from "../../../lib/server";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleApi(request, process.env);
export const POST = GET;
