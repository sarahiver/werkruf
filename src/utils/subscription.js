const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Product access must follow Stripe's latest status, not only the denormalized
 * plan label. Legacy trial profiles without a Stripe subscription remain
 * valid only until their recorded trial end.
 */
export function hasPaidAccess(profile, now = new Date()) {
  if (!profile) return false;

  if (profile.stripe_subscription_id || profile.stripe_subscription_status) {
    return PAID_STATUSES.has(profile.stripe_subscription_status);
  }

  if (profile.plan === 'trial') {
    const trialEnd = profile.trial_ends_at && new Date(profile.trial_ends_at);
    return Boolean(trialEnd && !Number.isNaN(trialEnd.getTime()) && trialEnd > now);
  }

  return profile.plan === 'pro';
}

export function isCancellationScheduled(profile) {
  return hasPaidAccess(profile) && profile?.stripe_cancel_at_period_end === true;
}
