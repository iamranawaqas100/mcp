require('dotenv').config({ path: require('path').join(__dirname, '.env') });

/**
 * Dev-only script to mint a test MCP bearer token, signed with MCP_JWT_SECRET
 * so that the connector listener at :3050 will accept it for /mcp tool calls
 * WITHOUT having to drive the OAuth UI flow (login → consent → callback).
 *
 * Why this exists:
 *   The OAuth-2.1 / RFC 8252 dance is the right path for the human-facing
 *   experience (Cursor pops a browser, user logs in, etc.). For automated
 *   tests, the MCP Inspector, or hooking the connector to a curl loop, the
 *   dance is overhead. bearerAuth accepts any JWT with valid HMAC + iss/aud
 *   + claims unless that jti was revoked via /oauth/revoke or refresh rotation.
 *
 * Usage:
 *   # Bypass-mode test (uses the synthetic user from cookieBridge.ts):
 *   MCP_JWT_SECRET=$(grep ^MCP_JWT_SECRET .env | cut -d= -f2) node services/user-service/mint-mcp-token.js
 *
 *   # Real-data test:
 *   MCP_JWT_SECRET=... node services/user-service/mint-mcp-token.js \
 *     --userId=<real-leni-user-uuid> \
 *     --orgId=<real-organization_id-string> \
 *     --buildingIds="<prop-uuid-1>,<prop-uuid-2>"
 *
 *   # Org-wide admin (no building filter):
 *   --buildingIds="*"
 *
 * Then drop the printed token into either:
 *   - MCP Inspector: paste as the Authorization header for <MCP_ISSUER>/mcp (use gateway URL)
 *   - Cursor user-leni: add as a static Authorization header in mcp.json
 *   - curl: -H "Authorization: Bearer <token>"
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const secret = process.env.MCP_JWT_SECRET;
if (!secret) {
  console.error('ERROR: MCP_JWT_SECRET env var is required.');
  console.error('       grep ^MCP_JWT_SECRET ../../.env | cut -d= -f2');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.join('=')];
    }),
);

const issuer = process.env.MCP_ISSUER || 'http://localhost:3050';

const userId = args.userId || '00000000-0000-0000-0000-000000000001';
const orgId = args.orgId || 'org-test';
const rawBids = args.buildingIds;
const buildingIds =
  rawBids === '*' ? '*' : rawBids ? rawBids.split(',').map((s) => s.trim()) : ['bld-1'];

const jti = crypto.randomBytes(16).toString('hex');

const payload = {
  sub: userId,
  org: orgId,
  bids: buildingIds,
  scope: 'udm:read udm:query',
  client_id: 'mint-script-local',
  jti,
};

const ttl = args.ttl || '8h';

const token = jwt.sign(payload, secret, {
  issuer,
  audience: issuer,
  expiresIn: ttl,
});

console.log('');
console.log(`=== MCP Bearer Token (valid ${ttl}) ===`);
console.log('');
console.log(token);
console.log('');
console.log('=== Claims ===');
console.log(JSON.stringify({ ...payload, iss: issuer, aud: issuer, exp: `+${ttl}` }, null, 2));
console.log('');
console.log('=== Drop into MCP Inspector ===');
console.log(`  URL:   ${issuer}/mcp`);
console.log(`  Header: Authorization: Bearer ${token}`);
console.log('');
console.log('=== Or test directly with curl ===');
console.log(
  `  curl -s -X POST ${issuer}/mcp -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
);
console.log('');
console.log('=== Cursor ===');
console.log('  Use OAuth via http://localhost:8088/mcp (see README) — not this minted token.');
console.log('');
