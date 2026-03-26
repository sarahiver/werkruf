import { useState, useCallback } from 'react';
import supabase from '../supabaseClient';

/**
 * useCheckout — calls create-checkout-session Edge Function
 * and redirects to Stripe Checkout.
 *
 * Usage:
 *   const { startCheckout, loading, error } = useCheckout();
 *   await startCheckout({ plan: 'monthly', path: 'optimisation', companyName, industryKey });
 */
export function useCheckout() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const startCheckout = useCallback(async ({
    plan,         // 'monthly' | 'quarterly' | 'annual'
    path,         // 'optimisation' | 'setup'
    companyName,
    industryKey,
  }) => {
    setLoading(true);
    setError(null);

    try {
      // Get current session for auth header
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Nicht eingeloggt');

      const { data, error: fnError } = await supabase.functions.invoke(
        'create-checkout-session',
        {
          body: { plan, path, companyName, industryKey },
        }
      );

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error('Keine Checkout-URL erhalten');

      // Redirect to Stripe Checkout
      window.location.href = data.url;

    } catch (err) {
      console.error('[useCheckout] Error:', err);
      setError(err.message || 'Checkout fehlgeschlagen. Bitte nochmal versuchen.');
      setLoading(false);
    }
    // Don't setLoading(false) on success — page will redirect
  }, []);

  return { startCheckout, loading, error };
}
