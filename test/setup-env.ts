import 'dotenv/config';

/**
 * Redirects e2e runs to a SEPARATE database.
 *
 * The suite creates users, orgs and invites as fixtures. Pointed at the real
 * database those fixtures accumulate in production data — so we rewrite the
 * database name in MONGO_URI to `<name>_test` before Nest (and therefore Prisma)
 * ever reads it.
 */
const uri = process.env.MONGO_URI;

if (uri) {
  const url = new URL(uri);
  const dbName = url.pathname.replace(/^\//, '') || 'keystone';

  if (!dbName.endsWith('_test')) {
    url.pathname = `/${dbName}_test`;
    process.env.MONGO_URI = url.toString();
  }
}
