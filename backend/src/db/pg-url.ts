/**
 * Neon's pooled endpoint (PgBouncer, transaction mode) doesn't support COPY or
 * server-side cursors, which the bulk paths (graph streaming load + the importers)
 * rely on. Rewrite a pooled connection string to the direct endpoint. No-op if the
 * URL is already direct. Lets every pg path work whether given the pooled or direct
 * Neon URL (e.g. a production `.env` that holds the pooled one).
 */
export function directUrl(url: string): string {
  try {
    const u = new URL(url);
    u.host = u.host.replace("-pooler.", ".");
    u.searchParams.delete("channel_binding");
    return u.toString();
  } catch {
    return url.replace("-pooler.", ".");
  }
}
