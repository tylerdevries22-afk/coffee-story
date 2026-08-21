/**
 * Stripe access point for the app.
 *
 * Everything imports Stripe through here rather than from
 * `@stripe/stripe-react-native` directly, so the web build can swap in
 * `stripe.web.ts`. The native SDK reaches into React Native internals that do
 * not exist on web, and importing it there fails the bundle outright.
 */
export { StripeProvider, useStripe } from '@stripe/stripe-react-native';
