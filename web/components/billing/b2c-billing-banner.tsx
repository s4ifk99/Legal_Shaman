"use client";

/**
 * Weekly £3.49 unlimited upsell is paused for the November privacy pilot.
 * Sole paid offer on Ask is the 99p privacy card — keep this component as a no-op
 * so call sites do not break, without pushing a second paid model.
 */
export function B2CBillingBanner() {
  return null;
}
