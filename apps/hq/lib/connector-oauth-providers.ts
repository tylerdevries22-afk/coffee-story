/**
 * Facade over the connector OAuth runtime. Routes and readiness checks import
 * from here so provider-specific quirks stay in the focused modules.
 */
export {
  OAUTH_CONNECTOR_KEYS,
  connectorAuthorizationUrl,
  connectorCallbackUrl,
  connectorProviderReady,
  connectorProviderScopes,
  isOAuthConnectorKey,
  type OAuthConnectorKey,
} from './connector-oauth-config';

export {
  exchangeConnectorCode,
  grantedConnectorScopes,
  type ConnectorToken,
} from './connector-oauth-exchange';

export {
  verifyConnectorIdentity,
  type ConnectorIdentity,
} from './connector-oauth-identity';
