'use strict';
const fs = require('node:fs');
const { X509Certificate } = require('node:crypto');
const fingerprint = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';
function verifyRoot(pem) {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  if (blocks.length !== 1 || /PRIVATE KEY/.test(pem)) throw new Error('CA_FILE_REJECTED');
  const cert = new X509Certificate(blocks[0]);
  const now = Date.now();
  if (!cert.ca || cert.fingerprint256 !== fingerprint || cert.subject !== cert.issuer ||
      !cert.verify(cert.publicKey) || now < Date.parse(cert.validFrom) || now >= Date.parse(cert.validTo)) {
    throw new Error('CA_IDENTITY_REJECTED');
  }
  return cert.fingerprint256;
}
module.exports = { verifyRoot };
if (require.main === module) {
  try { console.log(`CA_IDENTITY_PASS SHA256=${verifyRoot(fs.readFileSync(process.argv[2], 'utf8'))}`); }
  catch { console.error('CA_VALIDATION_BLOCKED: missing, invalid, expired or unexpected root.'); process.exitCode = 1; }
}
