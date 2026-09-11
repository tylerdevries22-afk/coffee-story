/**
 * Facade over the connector OAuth runtime. Routes and readiness checks import
 * from here so provider-specific quirks stay in the focused modules.
 */
export {
  OAUTH_CONNECTOR_KEYS,
  connectorAuthorizationUrl,
  connectorCallbackUrl,
  connectorScopeSource,
  isOAuthConnectorKey,
  connectorProviderReady,
  connectorProviderScopes,
  type OAuthConnectorKey,
} from './connector-oauth-config';

export {
  connectorCredentialEnvKeys,
  visibleCredentialEnvKeys,
} from './connector-credential-env';

export {
  ConnectorExchangeError,
  exchangeConnectorCode,
  type ConnectorToken,
} from './connector-oauth-exchange';

export {
  grantedConnectorScopes,
  resolveGrantedScopes,
} from './connector-oauth-scopes';

export {
  ConnectorIdentityError,
  verifyConnectorIdentity,
  type ConnectorIdentity,
} from './connector-oauth-identity';
