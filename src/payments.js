// Payment provider boundary.
//
// FitPot never touches card/UPI data. A provider tells a member how to pay and, for gateway
// providers, notifies us when money has arrived. The "manual" provider is the launch-day default:
// the organiser receives money outside the app and confirms it.
//
// To add Stripe Connect / Razorpay Route:
//   - implement `instructions()` to return a hosted-checkout URL for the payment row,
//   - add a webhook route that verifies the provider signature and calls
//     service.confirmPayment(..., { actor: 'provider', providerRef }),
//   - make payouts go through the provider's transfer API instead of "mark sent".
export const manualProvider = {
  name: 'manual',
  instructions: (challenge) => ({
    kind: 'manual',
    text: challenge.pay_info ? `Pay ${challenge.pay_info}, then ask the organiser to confirm.` : 'Pay the organiser, then ask them to confirm.',
  }),
};
