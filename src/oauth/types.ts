/** OAuth client registered via POST /oauth/register (RFC 7591). */
export interface OAuthClientRecord {
  client_id: string;
  client_secret_hash?: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope?: string;
  is_disabled: boolean;
}

export interface OAuthAuthorizationCodeRecord {
  code: string;
  client_id: string;
  user_id: string;
  organisation_id?: string;
  building_ids: string[];
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: Date;
  consumed: boolean;
}

export interface OAuthTokenRecord {
  refresh_token_hash: string;
  client_id: string;
  user_id: string;
  organisation_id?: string;
  building_ids: string[];
  scope: string;
  last_access_jti: string;
  expires_at: Date;
  revoked_at?: Date;
  replaced_by?: string;
}
