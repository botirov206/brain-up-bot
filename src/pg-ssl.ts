/**
 * pg turns `sslmode` in the URL into its own TLS config and that parsed
 * value overwrites an explicit `ssl` option. When the URL already names an
 * sslmode, leave it alone. Otherwise verify certificates for Neon.
 */
export function sslFor(databaseUrl: string): { rejectUnauthorized: boolean } | undefined {
  if (/[?&]sslmode=/i.test(databaseUrl)) return undefined;
  if (/\.neon\.tech/i.test(databaseUrl)) return { rejectUnauthorized: true };
  return undefined;
}
