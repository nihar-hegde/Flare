import { breadcrumb, withSpan } from "../lib/telemetry.js";

export interface CustomerProfile {
  id: string;
  email: string;
  plan: "starter" | "growth" | "enterprise";
  riskScore: number;
}

const CUSTOMERS: Record<string, CustomerProfile> = {
  cus_founder: {
    id: "cus_founder",
    email: "founder@example.com",
    plan: "growth",
    riskScore: 12,
  },
  cus_startup: {
    id: "cus_startup",
    email: "ops@example.com",
    plan: "starter",
    riskScore: 27,
  },
};

export class CustomerProfileNotFoundError extends Error {
  constructor(customerId: string) {
    super(`Customer profile ${customerId} was not found in the billing cache`);
    this.name = "CustomerProfileNotFoundError";
  }
}

export async function getCustomerProfile(
  customerId: string,
  scenario: string,
): Promise<CustomerProfile> {
  breadcrumb("customers", "Loading customer profile", { customerId, scenario });

  return withSpan(
    "customers.lookup",
    "cache",
    { customerId, scenario },
    async () => {
      await sleep(12);

      if (scenario === "missing-profile") {
        throw new CustomerProfileNotFoundError(customerId);
      }

      const profile = CUSTOMERS[customerId];
      if (!profile) throw new CustomerProfileNotFoundError(customerId);

      return profile;
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
