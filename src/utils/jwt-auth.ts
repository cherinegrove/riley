import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface ServiceAccountKey {
  private_key: string;
  client_email: string;
  token_uri: string;
}

export class JWTAuth {
  private serviceAccount: ServiceAccountKey;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor() {
    let credentialsJson: string | null = null;

    // Try base64-encoded credentials first (for Railway)
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64) {
      const decoded = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64, 'base64').toString('utf-8');
      credentialsJson = decoded;
    }
    // Try plain JSON credentials
    else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    }
    // Fall back to file (for local development)
    else {
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        path.join(process.cwd(), 'credentials.json');
      credentialsJson = fs.readFileSync(credentialsPath, 'utf-8');
    }

    this.serviceAccount = JSON.parse(credentialsJson);
  }

  async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    // Create JWT
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.serviceAccount.client_email,
      sub: this.serviceAccount.client_email,
      aud: 'https://chat.googleapis.com/',
      iat: now,
      exp: now + 3600, // 1 hour
    };

    const token = this.signJWT(payload);

    this.tokenCache = {
      token,
      expiresAt: (now + 3600) * 1000,
    };

    return token;
  }

  private signJWT(payload: any): string {
    // Create header
    const header = {
      alg: 'RS256',
      typ: 'JWT',
    };

    // Encode header and payload
    const headerEncoded = this.base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = this.base64UrlEncode(JSON.stringify(payload));

    // Create signature
    const signatureInput = `${headerEncoded}.${payloadEncoded}`;
    const signature = this.signRS256(signatureInput);

    return `${signatureInput}.${signature}`;
  }

  private signRS256(data: string): string {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data);
    const signature = sign.sign(this.serviceAccount.private_key, 'base64');
    return this.base64UrlEscape(signature);
  }

  private base64UrlEncode(str: string): string {
    return this.base64UrlEscape(Buffer.from(str).toString('base64'));
  }

  private base64UrlEscape(str: string): string {
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}

// Singleton instance
let jwtAuth: JWTAuth | null = null;

export function getJWTAuth(): JWTAuth {
  if (!jwtAuth) {
    jwtAuth = new JWTAuth();
  }
  return jwtAuth;
}
