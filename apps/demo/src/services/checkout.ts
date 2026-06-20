import { acquireConnection } from "../db/pool.js";
import { breadcrumb, withSpan } from "../lib/telemetry.js";
import { reserveInventory } from "./inventory.js";
import { createPaymentIntent } from "./payments.js";
import { getCustomerProfile } from "./users.js";

export interface CheckoutInput {
  customerId: string;
  sku: string;
  quantity: number;
  couponCode?: string;
  scenario: string;
}

export interface CheckoutResult {
  orderId: string;
  customerId: string;
  sku: string;
  amountCents: number;
  paymentIntentId: string;
  status: "confirmed";
}

const PRICE_CENTS: Record<string, number> = {
  pro_monthly: 4900,
  team_seats_10: 19000,
};

export async function createCheckout(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  breadcrumb("checkout", "Starting checkout", {
    customerId: input.customerId,
    sku: input.sku,
    quantity: input.quantity,
    couponCode: input.couponCode,
    scenario: input.scenario,
  });

  return withSpan(
    "checkout.create",
    "business",
    { sku: input.sku, scenario: input.scenario },
    async () => {
      const customer = await getCustomerProfile(input.customerId, input.scenario);
      const item = await reserveInventory(input.sku, input.quantity, input.scenario);
      const connection = await acquireConnection(
        input.scenario === "db-pool" ? "db-pool" : "success",
      );

      try {
        const paymentIntent = await createPaymentIntent({
          amountCents: calculateTotal(input.sku, input.quantity),
          customerId: customer.id,
          couponCode: input.couponCode,
          scenario: input.scenario,
        });

        breadcrumb("checkout", "Persisting order", {
          connectionId: connection.id,
          paymentIntentId: paymentIntent.id,
        });

        return {
          orderId: `ord_${Math.random().toString(16).slice(2, 10)}`,
          customerId: customer.id,
          sku: item.sku,
          amountCents: paymentIntent.amountCents,
          paymentIntentId: paymentIntent.id,
          status: "confirmed",
        };
      } finally {
        connection.release();
      }
    },
  );
}

function calculateTotal(sku: string, quantity: number): number {
  const price = PRICE_CENTS[sku];
  if (!price) throw new Error(`No price configured for sku ${sku}`);
  return price * quantity;
}
