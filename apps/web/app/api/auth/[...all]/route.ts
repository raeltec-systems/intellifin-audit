import { handleAuthRequest } from '../../../../src/sign-in-route';

/** Credentials and sessions are never cached, and never prerendered. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}

export function POST(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}
