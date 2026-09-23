export const formatAdminDate = (value, includeTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('de-DE', includeTime
    ? { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: '2-digit' });
};

export const getSubscriptionLabel = (customer, now = Date.now()) => {
  const stripe = customer.stripeStatus;
  if (stripe) return stripe;
  if (customer.trialEndsAt) return new Date(customer.trialEndsAt).getTime() >= now ? 'Trial aktiv' : 'Trial abgelaufen';
  return customer.plan === 'free' ? 'Kostenlos' : 'Kein Stripe-Status';
};

export const getCustomerProblem = (customer) => {
  if (['needs_reauth', 'revoked'].includes(customer.googleStatus)) return 'Google muss neu verbunden werden';
  if (customer.googleStatus === 'disconnected') return 'Google-Verbindung wurde getrennt';
  if (customer.lastSyncError) return `${customer.lastSyncError.jobType || 'Sync'}: ${customer.lastSyncError.message || customer.lastSyncError.code}`;
  if (customer.lastMail?.status === 'failed') return `Mail fehlgeschlagen: ${customer.lastMail.error_message || customer.lastMail.error_code || 'unbekannt'}`;
  if (customer.lastMail?.status === 'queued' && new Date(customer.lastMail.scheduled_for).getTime() < Date.now() - 3600000) return 'E-Mail seit über 1 Stunde in der Queue';
  if (customer.googleStatus === 'not_connected') return 'Google wurde noch nicht verbunden';
  return 'Kein akutes Problem erkannt';
};
