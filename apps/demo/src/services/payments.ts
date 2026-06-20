import { breadcrumb, withSpan } from "../lib/telemetry.js";

interface Coupon {
  code: string;
  discountPercent: number;
}

export class PaymentProviderTimeoutError extends Error {
  constructor(public readonly provider: string) {
    super(`Payment provider ${provider} timed out while creating payment intent`);
    this.name = "PaymentProviderTimeoutError";
  }
}

export async function createPaymentIntent(input: {
  amountCents: number;
  customerId: string;
  couponCode?: string;
  scenario: string;
}): Promise<{ id: string; amountCents: number; status: "requires_capture" }> {
  breadcrumb("payments", "Creating payment intent", {
    amountCents: input.amountCents,
    customerId: input.customerId,
    scenario: input.scenario,
  });

  return withSpan(
    "payments.create_intent",
    "http.client",
    {
      provider: "stripe",
      amountCents: input.amountCents,
      scenario: input.scenario,
    },
    async () => {
      await sleep(25);

      if (input.scenario === "payment-timeout") {
        throw new PaymentProviderTimeoutError("stripe");
      }

      const discountPercent =
        input.scenario === "coupon-null"
          ? readDiscountPercentUnsafely(input.couponCode)
          : readDiscountPercent(input.couponCode);

      const discountedAmount = Math.round(
        input.amountCents * (1 - discountPercent / 100),
      );

      return {
        id: `pi_${Math.random().toString(16).slice(2, 10)}`,
        amountCents: discountedAmount,
        status: "requires_capture",
      };
    },
  );
}

function readDiscountPercent(code: string | undefined): number {
  return findCoupon(code)?.discountPercent ?? 0;
}

function readDiscountPercentUnsafely(code: string | undefined): number {
  const coupon = findCoupon(code);
  return coupon!.discountPercent;
}

function findCoupon(code: string | undefined): Coupon | undefined {
  if (!code) return undefined;
  if (code === "FOUNDERS10") return { code, discountPercent: 10 };
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
